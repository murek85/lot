// Detale krajobrazu z OpenStreetMap: aleje drzew (szpalery z OSM i – jak to na Pomorzu – część dróg lokalnych
// poza zabudową i lasem), linie energetyczne ze słupami i zwisającymi przewodami.
import { InstancedMesh, Vector3, Mesh, LineSegments, BufferGeometry, BufferAttribute, Float32BufferAttribute, LineBasicNodeMaterial, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';
import { Fn, vec3, float, attribute, varying, positionLocal, positionWorld, normalWorld, uniform, max, dot, normalize, mix, instanceIndex, cameraPosition, pow, step, fract } from 'three/tsl';
import { onGround, cityLight, bareTrees, BARE, SEASON } from './gfx/ground.js';
import { treeGeometry } from './forest.js';
import { makeLitMaterial, litGeometry } from './gfx/lit.js';
import { alongLine, detailArrays } from './objgeo.js';
import { COL } from './gfx/palette.js';
import { CASTER_LAYER } from './shadows.js';

const EARTH_R = 6371000;

export { alongLine };

/**
 * opts (kafle otwartego świata): { coverAt(x, z) → klasa COVER albo −1, classes, shared – wspólne materiały
 * (obiekt wypełniany przy pierwszym użyciu: rows, rowShadow, pylons, pylonShadow, wires), seed }.
 */
export function createDetails(osm, region, terrain, atmo, clouds, plane, worldShadow, opts = {}) {
	let coverAt = opts.coverAt, cls = opts.classes;
	if (!coverAt) {
		const cover = region.coverTex.image.data, cn = region.meta.cover.res;
		cls = region.meta.cover.classes;
		coverAt = (x, z) => {
			const i = Math.floor((x / region.size + 0.5) * cn), j = Math.floor((z / region.size + 0.5) * cn);
			return i < 0 || j < 0 || i >= cn || j >= cn ? -1 : cover[j * cn + i];
		};
	}
	const a = detailArrays(osm, (x, z) => terrain.meshHeightAt(x, z), coverAt, cls, region.size / 2 - 40, opts.seed ?? 4242);
	return detailsFromArrays(a, atmo, clouds, plane, worldShadow, opts.shared);
}

/** Siatki alej i linii energetycznych z tablic (detailArrays – w wątku głównym albo w wątku kafli). */
export function detailsFromArrays(a, atmo, clouds, plane, worldShadow, shared = null) {
	const sh = shared ?? {};
	const objects = [], shadowCasters = [], updatable = [];
	if (a.treeCount) {
		const geo = treeGeometry(6);
		geo.setAttribute('position', geo.getAttribute('aRound').clone()); // kuliste korony drzew przydrożnych
		// normalne korony (spłaszczona kula) w atrybucie normal – macierz instancji obraca je razem z drzewem
		const rnd = geo.getAttribute('aRound'), prt = geo.getAttribute('aPart'), nrm = new Float32Array(rnd.count * 3), v = new Vector3();
		for (let i = 0; i < rnd.count; i++) {
			if (prt.getX(i) > 0.5) v.set(rnd.getX(i), (rnd.getY(i) - 0.65) * 0.7, rnd.getZ(i)).normalize();
			else v.set(0, 1, 0);
			nrm.set([v.x, v.y, v.z], i * 3);
		}
		geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
		const mat = (sh.rows ??= makeRowMaterial(atmo, clouds, plane, worldShadow));
		const mesh = new InstancedMesh(geo, mat, a.treeCount);
		const smesh = new InstancedMesh(geo, (sh.rowShadow ??= new MeshBasicNodeMaterial({ color: 0 })), a.treeCount);
		// macierze z tablicy (wspólna – obie siatki tylko je czytają)
		mesh.instanceMatrix.array.set(a.trees);
		smesh.instanceMatrix.array.set(a.trees);
		mesh.frustumCulled = smesh.frustumCulled = false;
		smesh.layers.set(CASTER_LAYER);
		objects.push(mesh);
		shadowCasters.push(smesh);
		updatable.push(mat);
	}
	if (a.pylons.count) {
		const mat = (sh.pylons ??= makeLitMaterial({ atmo, clouds, plane, worldShadow }));
		const geo = litGeometry(a.pylons);
		const m = new Mesh(geo, mat);
		m.frustumCulled = false;
		objects.push(m);
		updatable.push(mat);
		const smat = (sh.pylonShadow ??= makeLitMaterial({ atmo, clouds, plane, worldShadow: null }));
		const s = new Mesh(geo, smat);
		s.layers.set(CASTER_LAYER);
		s.frustumCulled = false;
		shadowCasters.push(s);
		updatable.push(smat);
	}
	if (a.wires.length) {
		const g = new BufferGeometry();
		g.setAttribute('position', new BufferAttribute(a.wires, 3));
		const mat = (sh.wires ??= wireMaterial(atmo));
		const lines = new LineSegments(g, mat);
		lines.frustumCulled = false;
		objects.push(lines);
		updatable.push(mat);
	}
	return {
		objects, shadowCasters, treeCount: a.treeCount,
		update(camera) { for (const m of updatable) m.userData.camXZ.value.set(camera.position.x, camera.position.z); },
	};
}

/** Przewody linii energetycznych: oświetlone jak otoczenie (słońce/księżyc + niebo) – nocą nie świecą. */
function wireMaterial(atmo) {
	const mat = new LineBasicNodeMaterial({ transparent: true, opacity: 0.8 });
	mat.colorNode = vec3(0.1, 0.105, 0.11).mul(atmo.sunLight(float(150)).mul(max(0, atmo.u.lightDir.y)).add(atmo.skyIrradiance())).div(Math.PI);
	const camXZ = uniform(new Vector2());
	mat.userData.camXZ = camXZ;
	mat.positionNode = Fn(() => onGround(positionLocal, camXZ))();
	return mat;
}

/** Materiał drzew przydrożnych (instancje z macierzami) – to samo światło co las 3D. */
function makeRowMaterial(atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial();
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(positionWorld, 'vRowWorld');
	const vInfo = varying(vec3(0), 'vRowInfo');
	// pozycja w shaderze to współrzędne drzewa przed macierzą instancji – miejsce w świecie bierzemy z positionWorld
	m.positionNode = Fn(() => {
		const local = positionLocal;
		const part = attribute('aPart', 'float');
		vInfo.assign(vec3(part, attribute('aRel', 'float'), float(instanceIndex).mul(0.618).fract()));
		return local;
	})();
	m.colorNode = Fn(() => {
		const part = vInfo.x, rel = vInfo.y, tint = vInfo.z;
		const albedo = mix(vec3(0.09, 0.06, 0.04), mix(mix(SEASON.leaf, SEASON.autumnLeaf, step(fract(tint.mul(7.31)), SEASON.autumn)), vec3(...BARE), bareTrees).mul(1.7).mul(mix(float(0.8), float(1.2), tint)), part);
		const N = normalize(normalWorld);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(mix(float(0.4), float(1), worldShadow.visibility(vWorld.add(sun.mul(2)), 1.2)));
		const ndl = max(0, dot(N, sun).mul(0.6).add(0.4));
		const V = normalize(cameraPosition.sub(vWorld));
		const back = pow(max(0, dot(V.negate(), sun)), 5).mul(0.5).mul(part);
		const ao = mix(float(0.6), float(1), rel);
		return albedo.div(Math.PI).mul(sunE.mul(ndl.add(back)).mul(shadow).add(atmo.skyIrradiance().mul(N.y.mul(0.5).add(0.5)).mul(ao)).add(plane.lights.landingLight(vWorld, N)).add(cityLight(vWorld).mul(0.6)));
	})();
	return m;
}

