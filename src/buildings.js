// Budynki 3D z obrysów OpenStreetMap: ściany do wysokości z pięter (albo domyślnej dla rodzaju budynku), dachy
// dwuspadowe dla domów i budynków gospodarczych o kształcie bliskim prostokąta (kalenica wzdłuż dłuższego boku
// najmniejszego prostokąta otaczającego), płaskie dla bloków, hal i obrysów nieregularnych. Kolory dachów i elewacji
// losowane z typowych dla Pomorza, okna rysowane w shaderze z siatki pięter. Geometria scalona w kafelki 2 km.
import { Mesh, BufferGeometry, BufferAttribute, Float32BufferAttribute, Sphere, Vector3, MeshBasicNodeMaterial, ShapeUtils, Vector2, DoubleSide, SpriteNodeMaterial, Sprite, InstancedBufferAttribute, AdditiveBlending } from 'three/webgpu';
import {
	Fn, float, vec2, vec3, floor, attribute, varying, positionLocal, uniform, max, mix, smoothstep, step, fract, dot, normalize,
	cameraPosition, pow, select, fwidth, instancedBufferAttribute, uv, exp, clamp, length, time,
} from 'three/tsl';
import { onGround, cityLight, cityUniforms, worldOffset } from './gfx/ground.js';
import { hash12 } from './gfx/noise.js';
import { valueNoise } from './gfx/noise.js';
import { rng } from './clouds/noise3d.js';
import { CASTER_LAYER, CASTER_NEAR } from './shadows.js';
import { coolingProfile } from './gfx/structures.js';
import { buildBuildingTiles, minRect, polygonArea2, addBuilding, addCoolingTower } from './buildgeo.js';

export { buildBuildingTiles, minRect, polygonArea2, addBuilding, addCoolingTower };

const EARTH_R = 6371000;
export function createBuildings(osm, region, terrain, atmo, clouds, plane, worldShadow = null, shared = null) {
	const terrainH = (x, z) => terrain.meshHeightAt(x, z);
	const { tiles, count, structures, beacons } = buildBuildingTiles(osm.buildings, terrainH, region.size / 2 - 30);
	return buildingMeshes(tiles, { count, structures, beacons }, atmo, clouds, plane, worldShadow, shared);
}

/**
 * Siatki budynków z gotowych tablic (buildBuildingTiles – w wątku głównym albo w wątku kafli); shared – wspólne
 * materiały kafli otwartego świata.
 */
export function buildingMeshes(tiles, info, atmo, clouds, plane, worldShadow = null, shared = null) {
	const { count, structures, beacons } = info;
	// shared – wspólne materiały (kafle otwartego świata: jeden shader na wszystkie kafle)
	const material = shared?.material ?? makeMaterial(atmo, clouds, plane, worldShadow);
	const shadowMaterial = shared?.shadowMaterial ?? makeShadowMaterial(material.userData.camXZ);
	const meshes = [], shadowCasters = [];
	// tablice z wątku kafli (typowane) – bez kopiowania; z wątku głównego (zwykłe) – przez Float32BufferAttribute
	const attr = (a, n) => (a instanceof Float32Array ? new BufferAttribute(a, n) : new Float32BufferAttribute(a, n));
	for (const b of tiles) {
		const g = new BufferGeometry();
		g.setAttribute('position', attr(b.pos, 3));
		g.setAttribute('normal', attr(b.nrm, 3));
		g.setAttribute('aKind', attr(b.kind, 1));
		g.setAttribute('aUv', attr(b.uv, 2));
		g.setAttribute('aWall', attr(b.wall, 3));
		g.setAttribute('aRoof', attr(b.roof, 3));
		g.setAttribute('aLight', attr(b.light, 2));
		g.setIndex(Array.isArray(b.idx) ? b.idx : new BufferAttribute(b.idx, 1));
		// sfera otaczająca z wątku kafli (gotowa) albo liczona tutaj
		if (b.sphere) g.boundingSphere = new Sphere(new Vector3(b.sphere[0], b.sphere[1], b.sphere[2]), b.sphere[3]);
		else g.computeBoundingSphere();
		const m = new Mesh(g, material);
		meshes.push(m);
		const s = new Mesh(g, shadowMaterial);
		s.layers.set(CASTER_LAYER);
		s.layers.enable(CASTER_NEAR);
		shadowCasters.push(s);
	}
	return {
		objects: meshes,
		shadowCasters,
		count,
		structures,
		beacons,
		material, shadowMaterial,
		dispose() { for (const m of [...meshes, ...shadowCasters]) m.geometry.dispose(); },
		/** Czerwone światła przeszkodowe na kominach i chłodniach – nocą, migające; jeden sprite z instancjami. */
		createBeacons(pixelAngle) {
			return beacons.length ? beaconSprite(beacons, material.userData.camXZ, pixelAngle) : null;
		},
		update(camera) { material.userData.camXZ.value.set(camera.position.x, camera.position.z); },
	};
}

function beaconSprite(beacons, camXZ, pixelAngle) {
	const n = beacons.length;
	const pos = new Float32Array(n * 3), phase = new Float32Array(n);
	beacons.forEach((p, i) => { pos.set(p, i * 3); phase[i] = (Math.abs(Math.round(p[0] * 7 + p[2] * 3)) % 100) / 100; });
	const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
	const center = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3));
	const ph = instancedBufferAttribute(new InstancedBufferAttribute(phase, 1));
	const world = onGround(center, camXZ);
	m.positionNode = world;
	// z daleka nie mniejsze niż kilka pikseli – kominy widać z kilometrów jako czerwone punkty
	const dist = length(cameraPosition.sub(world));
	const sz = max(float(3), dist.mul(pixelAngle).mul(6)).min(70);
	m.scaleNode = vec2(sz, sz);
	const q = uv().sub(0.5).mul(2);
	const r2 = dot(q, q);
	const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(10).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
	// miganie ~1 Hz (każda budowla w innej fazie); świecą od zmierzchu jak latarnie
	const ft = fract(time.mul(0.9).add(ph));
	const blink = smoothstep(0.35, 0.5, ft).mul(smoothstep(0.85, 1, ft).oneMinus()).mul(0.85).add(0.15);
	const CU = cityUniforms();
	const on = CU ? CU.street : float(1);
	const glow = CU ? max(CU.glow, 0.2) : float(1);
	m.colorNode = vec3(1, 0.06, 0.03).mul(f.mul(blink).mul(on).mul(glow).mul(9));
	const sprite = new Sprite(m);
	sprite.count = n;
	sprite.frustumCulled = false;
	sprite.renderOrder = 16;
	return sprite;
}

/** Tani materiał do mapy cieni: ta sama pozycja (z krzywizną), bez oświetlenia. */
function makeShadowMaterial(camXZ) {
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	m.positionNode = Fn(() => {
		const p = positionLocal;
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	m.colorNode = vec3(0);
	return m;
}

function makeMaterial(atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(vec3(0), 'vBldWorld');
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	const kind = varying(attribute('aKind', 'float'), 'vBldKind');
	const buv = varying(attribute('aUv', 'vec2'), 'vBldUv');
	const wallC = varying(attribute('aWall', 'vec3'), 'vBldWall');
	const roofC = varying(attribute('aRoof', 'vec3'), 'vBldRoof');
	const nrm = varying(attribute('normal', 'vec3'), 'vBldNormal');
	const light = varying(attribute('aLight', 'vec2'), 'vBldLight'); // (szansa zapalonych okien, los budynku)
	m.colorNode = Fn(() => {
		const N = normalize(nrm);
		const footprint = max(fwidth(vWorld.x), fwidth(vWorld.z)).max(0.02);
		const detail = float(1).sub(smoothstep(0.4, 1.6, footprint));
		// okna: siatka co 3 m w poziomie i co piętro (3 m), od 0,9 m nad podłogą; z daleka uśrednione
		const cellU = fract(buv.x.div(3.1)), cellV = fract(buv.y.div(3));
		// budowle bez okien (kominy, chłodnie, zbiorniki): light.x < 0
		const hasWin = step(0, light.x);
		const win = step(0.3, cellU).mul(step(cellU, 0.72)).mul(step(0.3, cellV)).mul(step(cellV, 0.78)).mul(step(1, buv.y)).mul(hasWin);
		const V = normalize(cameraPosition.sub(vWorld));
		// szyby: ciemne, z odrobiną odbitego nieba (jako albedo – światło dolicza się niżej)
		const glass = vec3(0.025, 0.03, 0.036).add(atmo.skyRadiance(normalize(vec3(N.x, 0.35, N.z))).mul(0.02));
		// pasy przeszkodowe na kominach ≥ 100 m (light.x = −2, light.y = wysokość): 7 pasów w górnych 45%
		const H = light.y;
		const band = step(0.5, fract(buv.y.div(H.mul(0.45 / 7)).mul(0.5)));
		const striped = step(light.x, -1.5).mul(step(H.mul(0.55), buv.y));
		const wallBase = mix(wallC, mix(vec3(0.78, 0.78, 0.76), vec3(0.6, 0.07, 0.04), band), striped);
		const wallAlb = mix(wallBase.mul(mix(float(0.9), float(1.05), valueNoise(vWorld.xz.add(worldOffset).div(2)))), glass, win.mul(detail).add(float(0.18).mul(detail.oneMinus()).mul(hasWin)));
		// --- dachy spadziste: u – metry wzdłuż kalenicy, v – metry wzdłuż spadku od okapu; rodzaj 1 (okap) → 1,4 (kalenica)
		const onSlope = clamp(kind.sub(1).div(0.4), 0, 1);
		const seed = light.y;
		// szczegóły znikają z odległością (piksel większy od dachówki) – zostaje średnia jasność wzoru
		const fine = float(1).sub(smoothstep(0.06, 0.25, footprint));
		const mid = float(1).sub(smoothstep(0.2, 0.7, footprint));
		const coarse = float(1).sub(smoothstep(0.6, 2.5, footprint));
		// dachówka (czerwienie i brązy): rzędy co 0,32 m z cieniem pod krawędzią rzędu wyżej, styki co 0,26 m przesunięte
		// co drugi rząd, każda dachówka w trochę innym odcieniu
		const rowF = buv.y.div(0.32), row = floor(rowF), fr = fract(rowF);
		const course = mix(float(0.72), float(1.06), smoothstep(0.0, 0.3, fr));
		const colF = buv.x.div(0.26).add(fract(row.mul(0.5)));
		const cf = fract(colF);
		const joint = mix(float(0.8), float(1), smoothstep(0.0, 0.07, cf.min(float(1).sub(cf))));
		const tileVar = mix(float(0.9), float(1.1), hash12(vec2(floor(colF), row).add(seed.mul(173.1))));
		const clay = mix(float(0.93), course.mul(joint).mul(tileVar), fine);
		// blacha i papa (szarości, zielenie): przetłoczenia co 0,5 m wzdłuż spadku
		const sf = fract(buv.x.div(0.5));
		const sheet = mix(float(0.96), mix(float(0.82), float(1.02), smoothstep(0.0, 0.08, sf.min(float(1).sub(sf)))), mid);
		const isClay = step(roofC.g.mul(1.6), roofC.r);
		// kalenica (gąsiory – ciemniejszy pas), rynna przy okapie, zabrudzenia i mech nisko na połaci
		const ridgeCap = mix(float(1), float(0.72), smoothstep(0.955, 0.985, onSlope).mul(coarse));
		const gutter = mix(float(1), float(0.55), float(1).sub(smoothstep(0.0, 0.035, onSlope)).mul(coarse));
		const grime = mix(float(0.84), float(1), smoothstep(0.0, 0.4, onSlope).max(float(1).sub(coarse)));
		const weather = mix(float(0.85), float(1.1), valueNoise(vWorld.xz.add(worldOffset).div(3)));
		const moss = valueNoise(vWorld.xz.add(worldOffset).div(1.7)).mul(float(1).sub(onSlope)).mul(isClay).mul(0.35);
		const roofAlb = mix(roofC.mul(mix(sheet, clay, isClay)).mul(ridgeCap).mul(gutter).mul(grime).mul(weather), vec3(0.06, 0.07, 0.03), moss);
		// --- dachy płaskie (uv – metry w poziomie): pasy papy co 1 m, łaty i zacieki
		const pf = fract(buv.x);
		const strips = mix(float(0.95), mix(float(0.85), float(1.02), smoothstep(0.0, 0.05, pf.min(float(1).sub(pf)))), mid);
		const patches = mix(float(0.8), float(1.15), valueNoise(vWorld.xz.add(worldOffset).div(4))).mul(mix(float(0.9), float(1.05), valueNoise(vWorld.xz.add(worldOffset).div(13).add(7.1))));
		const flatAlb = roofC.mul(patches).mul(strips);
		// tylne ściany (wnętrze chłodni widziane z góry) – ciemne
		const back = select(dot(N, V).lessThan(0), float(0.12), float(1));
		const albedo = select(kind.lessThan(0.5), wallAlb, select(kind.lessThan(1.5), roofAlb, flatAlb)).mul(back);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld.add(vec3(nrm).mul(0.25)), 0.5));
		const ndl = max(0, dot(N, sun));
		const skyE = atmo.skyIrradiance();
		// ściany dostają mniej nieba (zasłania je połowa nieboskłonu) i trochę światła odbitego od ziemi
		const sky = skyE.mul(N.y.mul(0.5).add(0.5)).add(sunE.mul(max(0, sun.y)).mul(0.12).mul(float(1).sub(N.y)).mul(0.5));
		const spec = pow(max(0, dot(V.negate().sub(N.mul(dot(V.negate(), N).mul(2))), sun)), 60).mul(0.15).mul(win).mul(detail);
		// latarnie oświetlają ściany od dołu (słabnie z wysokością nad ulicą)
		const street = cityLight(vWorld).mul(float(1).sub(N.y.max(0).mul(0.3))).mul(0.35);
		const lit = albedo.div(Math.PI).mul(sunE.mul(ndl).mul(shadow).add(sky).add(plane.lights.landingLight(vWorld, N)).add(street)).add(sunE.mul(spec).mul(shadow));
		// zapalone okna: los na okno (komórka siatki + budynek), odsetek z godziny; barwa ciepła, czasem chłodna (telewizor)
		const CU = cityUniforms();
		if (!CU) return lit;
		const cellId = vec2(floor(buv.x.div(3.1)), floor(buv.y.div(3)));
		const hw = hash12(cellId.add(vec2(light.y.mul(913.7), light.y.mul(271.3))));
		const on = step(hw, CU.windows.mul(light.x)).mul(step(1, buv.y)).mul(step(kind, 0.5));
		const tone = hash12(cellId.add(vec2(light.y.mul(57.1), 3.3)));
		const wcol = mix(vec3(1.0, 0.68, 0.36), vec3(0.62, 0.72, 1.0), step(0.86, tone)).mul(mix(float(0.55), float(1.1), tone));
		// z bliska – kształt okna; z daleka – średnia (okna zajmują ~18% ściany)
		const shape = win.mul(detail).add(float(0.18).mul(detail.oneMinus()));
		return lit.add(wcol.mul(on.mul(shape).mul(1.3).mul(CU.winGlow)));
	})();
	return m;
}

