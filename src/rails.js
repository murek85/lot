// Tory z OpenStreetMap: nasyp z tłuczniem, podkłady co 0,65 m i dwie szyny (rozstaw 1435 mm) rysowane w shaderze
// na wstędze położonej na terenie. Nieczynne – zarośnięte, rdzawe; rozebrane – sam nasyp z trawą. Do tego perony
// (podniesione płyty) i linie torów dla maski lasu.
import { Mesh, BufferGeometry, BufferAttribute, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';
import { Fn, float, vec3, attribute, varying, positionLocal, uniform, abs, max, min, mix, smoothstep, step, fract, fwidth, dot, select, pow, normalize, cameraPosition, clamp } from 'three/tsl';
import { onGround, cityLight, worldOffset } from './gfx/ground.js';
import { valueNoise } from './gfx/noise.js';
import { railArrays, BED } from './objgeo.js';

const EARTH_R = 6371000;

/** shared – { material } wspólny dla wielu wywołań (kafle otwartego świata). */
export function createRails(osm, region, terrain, atmo, clouds, plane, worldShadow, shared = null) {
	const a = railArrays(osm.rails, (x, z) => terrain.meshHeightAt(x, z), region.size / 2 - 30);
	return railsFromArrays(a, atmo, clouds, plane, worldShadow, shared);
}

/** Siatka torów z tablic (railArrays – w wątku głównym albo w wątku kafli). */
export function railsFromArrays(a, atmo, clouds, plane, worldShadow, shared = null) {
	const g = a.mesh;
	let mat = shared?.material ?? null;
	const objects = [];
	if (g.count) {
		const geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(g.pos, 3));
		geo.setAttribute('aSide', new BufferAttribute(g.side, 1));
		geo.setAttribute('aDist', new BufferAttribute(g.dist, 1));
		geo.setAttribute('aKind', new BufferAttribute(g.kind, 1));
		geo.setIndex(new BufferAttribute(g.idx, 1));
		const mesh = new Mesh(geo, (mat ??= makeMaterial(atmo, clouds, plane, worldShadow)));
		mesh.renderOrder = 12;
		mesh.frustumCulled = false;
		objects.push(mesh);
	}
	return {
		objects,
		lines: a.lines,
		get material() { return mat; },
		update(camera) { for (const o of objects) o.material.userData.camXZ.value.set(camera.position.x, camera.position.z); },
	};
}

function makeMaterial(atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(vec3(0), 'vRailWorld');
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	const side = varying(attribute('aSide', 'float'), 'vRailSide');
	const along = varying(attribute('aDist', 'float'), 'vRailDist');
	const kind = varying(attribute('aKind', 'float'), 'vRailKind');
	m.colorNode = Fn(() => {
		const xz = vWorld.xz.add(worldOffset);
		const fp = max(fwidth(xz.x), fwidth(xz.y)).max(0.03);
		const across = side.mul(BED / 2); // metry od osi toru
		const detail = float(1).sub(smoothstep(0.25, 1.2, fp));
		// tłuczeń, na skraju nasypu trawa i piasek
		const ballast = vec3(0.21, 0.195, 0.18).mul(mix(float(0.85), float(1.12), valueNoise(xz.div(0.6)).mul(detail).add(float(0.5).mul(detail.oneMinus()))));
		const shoulder = smoothstep(1.7, 2.2, abs(across));
		const overgrown = step(1.5, kind); // nieczynne i rozebrane
		const albedo = mix(ballast, vec3(0.12, 0.15, 0.06), max(shoulder.mul(0.7), overgrown.mul(mix(float(0.5), float(0.9), valueNoise(xz.div(4)))))).toVar();
		// podkłady (2,6 m × 0,25 m co 0,65 m) – z daleka uśrednione do ciemniejszego pasa
		const sleeperBand = smoothstep(1.25, 1.35, abs(across)).oneMinus();
		const sl = step(fract(along.div(0.65)), 0.38);
		const sleepers = sleeperBand.mul(mix(float(0.38), sl, detail)).mul(step(kind, 2.5));
		albedo.assign(mix(albedo, vec3(0.07, 0.055, 0.045), sleepers.mul(0.85)));
		// szyny: dwie linie w rozstawie 1,435 m (główki szyn 7 cm), rdzawe na torach nieczynnych
		const railW = float(0.07);
		const rd = abs(abs(across).sub(0.7525));
		const rail = smoothstep(railW.add(fp.mul(0.5)).sub(fp), railW.add(fp.mul(0.5)), rd).oneMinus().mul(min(1, railW.mul(3).div(fp))).mul(step(kind, 2.5));
		const steel = select(kind.lessThan(1.5), vec3(0.42, 0.42, 0.44), vec3(0.2, 0.1, 0.06));
		albedo.assign(mix(albedo, steel, rail));
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld, 0.3));
		// błysk wyślizganych główek szyn
		const V = normalize(cameraPosition.sub(vWorld));
		const H = normalize(V.add(sun));
		const glint = pow(max(0, H.y), 200).mul(rail).mul(step(kind, 0.5)).mul(2);
		return albedo.div(Math.PI).mul(sunE.mul(max(0, sun.y)).mul(shadow).add(atmo.skyIrradiance()).add(plane.lights.landingLight(vWorld, vec3(0, 1, 0))).add(cityLight(vWorld))).add(sunE.mul(glint).mul(shadow));
	})();
	m.opacityNode = Fn(() => {
		const fp = max(fwidth(vWorld.x), fwidth(vWorld.z)).max(0.05);
		const fromEdge = float(1).sub(abs(side)).mul(BED / 2);
		return clamp(fromEdge.div(fp).add(0.3), 0, 1).mul(min(1, float(BED).div(fp.mul(1.5))));
	})();
	return m;
}
