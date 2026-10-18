// Rzeki i strugi z OpenStreetMap jako wstęgi wody na terenie. Wąskie rzeki (Brda, Kiczyna) są w mapie pokrycia
// WorldCover najwyżej szczątkowo – bez tego las rósłby nad korytem, a mosty stałyby nad drzewami. Woda: ciemna
// toń, odbicie nieba z Fresnelem, drobne zmarszczki i odblask słońca; brzegi wygładzone przezroczystością.
// Do tego linie koryt (z pasem nadbrzeżnym) dla maski lasu.
import { Mesh, BufferGeometry, BufferAttribute, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';
import { Fn, float, vec2, vec3, attribute, varying, positionLocal, uniform, abs, max, min, clamp, mix, pow, dot, normalize, reflect, fwidth, cameraPosition } from 'three/tsl';
import { onGround, worldOffset } from './gfx/ground.js';
import { valueNoise } from './gfx/noise.js';
import { COL } from './gfx/palette.js';
import { riverArrays } from './objgeo.js';

/** shared – { material } wspólny dla wielu wywołań (kafle otwartego świata). */
export function createRivers(osm, region, terrain, atmo, clouds, plane, worldShadow, shared = null) {
	const a = riverArrays(osm.waterways, (x, z) => terrain.meshHeightAt(x, z), region.size / 2 - 30);
	return riversFromArrays(a, atmo, clouds, plane, worldShadow, shared);
}

/** Siatka wody z tablic (riverArrays – w wątku głównym albo w wątku kafli). */
export function riversFromArrays(a, atmo, clouds, plane, worldShadow, shared = null) {
	const g = a.mesh;
	let mat = shared?.material ?? null;
	const objects = [];
	if (g.count) {
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(g.pos, 3));
		geo.setAttribute('aSide', new BufferAttribute(g.side, 1));
		geo.setAttribute('aWidth', new BufferAttribute(g.width, 1));
		geo.setIndex(new BufferAttribute(g.idx, 1));
		const mesh = new Mesh(geo, (mat ??= makeMaterial(atmo, clouds, plane, worldShadow)));
		mesh.renderOrder = 5; // pod drogami
		mesh.frustumCulled = false;
		objects.push(mesh);
	}
	return {
		objects, lines: a.lines,
		get material() { return mat; },
		update(camera) {
			for (const o of objects) {
				o.material.userData.camXZ.value.set(camera.position.x, camera.position.z);
				o.material.userData.time.value = performance.now() / 1000;
			}
		},
	};
}

function makeMaterial(atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
	const camXZ = uniform(new Vector2());
	const time = uniform(0);
	m.userData.camXZ = camXZ;
	m.userData.time = time;
	const vWorld = varying(vec3(0), 'vRiverWorld');
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		return onGround(p, camXZ);
	})();
	const side = varying(attribute('aSide', 'float'), 'vRiverSide');
	const width = varying(attribute('aWidth', 'float'), 'vRiverWidth');
	m.colorNode = Fn(() => {
		const xz = vWorld.xz.add(worldOffset);
		const fp = max(fwidth(xz.x), fwidth(xz.y)).max(0.03);
		// zmarszczki: dwie warstwy szumu płynące w różnych kierunkach, wygaszane z daleka
		const fine = float(1).sub(clamp(fp.div(3), 0, 1));
		const nA = valueNoise(xz.div(2.3).add(vec2(time.mul(0.35), 0)));
		const nB = valueNoise(xz.div(1.4).sub(vec2(0, time.mul(0.28))));
		const wn = normalize(vec3(nA.sub(0.5).mul(0.18).mul(fine), 1, nB.sub(0.5).mul(0.18).mul(fine)));
		const V = normalize(cameraPosition.sub(vWorld));
		const R = reflect(V.negate(), wn);
		const nv = max(dot(wn, V), 0.02);
		const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(nv), 5)));
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld, 0.3));
		// przy brzegach płycej i ciemniej (cień skarpy, odbicie zarośli)
		const edge = abs(side);
		const body = mix(COL.waterShallow.mul(1.1), COL.waterDeep.mul(1.2), clamp(width.div(14), 0, 1).mul(edge.oneMinus()));
		const lit = body.mul(sunE.mul(max(0, sun.y)).mul(shadow).add(atmo.skyIrradiance()).add(plane.lights.landingLight(vWorld, wn)));
		const sky = atmo.skyRadiance(vec3(R.x, max(0.01, R.y), R.z)).mul(mix(float(1), float(0.45), edge.mul(edge)));
		const H = normalize(V.add(sun));
		const glint = pow(max(0, dot(wn, H)), 400).mul(30).mul(shadow);
		return mix(lit, sky, F).add(sunE.mul(glint).mul(F));
	})();
	m.opacityNode = Fn(() => {
		const fp = max(fwidth(vWorld.x), fwidth(vWorld.z)).max(0.05);
		const fromEdge = float(1).sub(abs(side)).mul(width.mul(0.5));
		return clamp(fromEdge.div(fp.add(0.8)), 0, 1).mul(min(1, width.div(fp.mul(1.5)))).mul(0.95);
	})();
	return m;
}
