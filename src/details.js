// Detale krajobrazu z OpenStreetMap: aleje drzew (szpalery z OSM i – jak to na Pomorzu – część dróg lokalnych
// poza zabudową i lasem), linie energetyczne ze słupami i zwisającymi przewodami.
import { InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Mesh, LineSegments, BufferGeometry, Float32BufferAttribute, LineBasicNodeMaterial, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu';
import { Fn, vec3, float, attribute, varying, positionLocal, positionWorld, normalWorld, uniform, max, dot, normalize, mix, instanceIndex, cameraPosition, pow } from 'three/tsl';
import { onGround, cityLight } from './gfx/ground.js';
import { treeGeometry } from './forest.js';
import { makeLitMaterial, GeoBuilder } from './gfx/lit.js';
import { densify } from './roads.js';
import { rng } from './clouds/noise3d.js';
import { COL } from './gfx/palette.js';
import { CASTER_LAYER } from './shadows.js';

const EARTH_R = 6371000;

/** Punkty co `step` metrów wzdłuż linii, po obu stronach (odsunięcie offset), z lekkim rozrzutem. */
export function alongLine(pts, step, offset, sides, r) {
	const out = [];
	let carry = r() * step;
	for (let i = 2; i < pts.length; i += 2) {
		const x0 = pts[i - 2], z0 = pts[i - 1], x1 = pts[i], z1 = pts[i + 1];
		const len = Math.hypot(x1 - x0, z1 - z0);
		if (len < 0.01) continue;
		const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
		let d = carry;
		while (d < len) {
			for (const s of sides) {
				const j = (r() - 0.5) * 1.2;
				out.push([x0 + tx * d - tz * (offset + j) * s, z0 + tz * d + tx * (offset + j) * s]);
			}
			d += step * (0.8 + r() * 0.4);
		}
		carry = d - len;
	}
	return out;
}

/**
 * opts (kafle otwartego świata): { coverAt(x, z) → klasa COVER albo −1, classes, shared – wspólne materiały
 * (obiekt wypełniany przy pierwszym użyciu: rows, pylons, pylonShadow, wires), seed }.
 */
export function createDetails(osm, region, terrain, atmo, clouds, plane, worldShadow, opts = {}) {
	const half = region.size / 2 - 40;
	const r = rng(opts.seed ?? 4242);
	const sh = opts.shared ?? {};
	let coverAt = opts.coverAt, cls = opts.classes;
	if (!coverAt) {
		const cover = region.coverTex.image.data, cn = region.meta.cover.res;
		cls = region.meta.cover.classes;
		coverAt = (x, z) => {
			const i = Math.floor((x / region.size + 0.5) * cn), j = Math.floor((z / region.size + 0.5) * cn);
			return i < 0 || j < 0 || i >= cn || j >= cn ? -1 : cover[j * cn + i];
		};
	}
	const inside = (pts) => pts.every((v) => Math.abs(v) < half);
	const toPts = (c) => { const p = []; for (let i = 0; i < c.length; i += 2) p.push(c[i] / 10, c[i + 1] / 10); return p; };

	// --- aleje ---
	const trees = [];
	const addRow = (pts, step, offset, sides) => {
		for (const [x, z] of alongLine(pts, step, offset, sides, r)) {
			const c = coverAt(x, z);
			if (c === cls.water || c === cls.built || c === cls.forest || c < 0) continue;
			trees.push([x, z]);
		}
	};
	for (const [c] of osm.treeRows ?? []) { const p = toPts(c); if (inside(p)) addRow(densify(p, 50), 8, 0, [1]); }
	for (const [cl, w10, surface, bridge, , c] of osm.roads) {
		if (cl < 2 || cl > 4 || bridge || surface > 2) continue;
		const p = toPts(c);
		if (!inside(p) || p.length < 4) continue;
		// mniej więcej co trzecia droga lokalna ma aleję (deterministycznie po położeniu)
		const h = Math.abs(Math.sin(p[0] * 12.9898 + p[1] * 78.233) * 43758.5453) % 1;
		if (h > 0.33) continue;
		addRow(p, 11, w10 / 20 + 2.6, [-1, 1]);
	}

	const objects = [], shadowCasters = [], updatable = [];
	if (trees.length) {
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
		const mesh = new InstancedMesh(geo, mat, trees.length);
		const smesh = new InstancedMesh(geo, (sh.rowShadow ??= new MeshBasicNodeMaterial({ color: 0 })), trees.length);
		const m4 = new Matrix4(), q = new Quaternion(), e = new Euler();
		trees.forEach(([x, z], i) => {
			const H = 13 + r() * 9;
			e.set((r() - 0.5) * 0.06, r() * Math.PI * 2, (r() - 0.5) * 0.06);
			q.setFromEuler(e);
			m4.compose(new Vector3(x, terrain.meshHeightAt(x, z) - 0.4, z), q, new Vector3(H * (0.9 + r() * 0.3), H, H * (0.9 + r() * 0.3)));
			mesh.setMatrixAt(i, m4);
			smesh.setMatrixAt(i, m4);
		});
		mesh.frustumCulled = smesh.frustumCulled = false;
		smesh.layers.set(CASTER_LAYER);
		objects.push(mesh);
		shadowCasters.push(smesh);
		updatable.push(mat);
	}

	// --- linie energetyczne: słupy w wierzchołkach linii, przewody ze zwisem ---
	const pylons = new GeoBuilder();
	const wires = [];
	for (const [minor, c] of osm.power ?? []) {
		const p = toPts(c);
		if (!inside(p)) continue;
		const H = minor ? 10 : 26, arm = minor ? 0.9 : 5.5, W = minor ? 0.35 : 3.2;
		const steel = minor ? [0.42, 0.41, 0.38] : [0.33, 0.35, 0.36];
		const n = p.length / 2;
		const tops = [];
		for (let i = 0; i < n; i++) {
			const x = p[i * 2], z = p[i * 2 + 1];
			const g = terrain.meshHeightAt(x, z);
			// kierunek linii w punkcie (średnia sąsiednich odcinków) – poprzecznik prostopadle do niego
			const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
			let tx = p[b * 2] - p[a * 2], tz = p[b * 2 + 1] - p[a * 2 + 1];
			const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
			if (minor) pylons.beam(x - tx * 0.15, z - tz * 0.15, x + tx * 0.15, z + tz * 0.15, W, g - 0.5, g + H, steel);
			else {
				// kratownica uproszczona: zwężający się trzon z dwóch belek i poprzecznik
				pylons.beam(x - tx * 1.6, z - tz * 1.6, x + tx * 1.6, z + tz * 1.6, W, g - 0.5, g + H * 0.55, steel);
				pylons.beam(x - tx * 0.8, z - tz * 0.8, x + tx * 0.8, z + tz * 0.8, W * 0.45, g + H * 0.55, g + H, steel);
			}
			pylons.beam(x - tz * arm, z + tx * arm, x + tz * arm, z - tx * arm, minor ? 0.15 : 0.6, g + H - (minor ? 0.4 : 1.4), g + H - (minor ? 0.25 : 0.9), steel);
			tops.push([x, g + H - (minor ? 0.4 : 1.4), z, -tz, tx]);
		}
		for (let i = 1; i < tops.length; i++) {
			const A = tops[i - 1], B = tops[i];
			for (const s of minor ? [-0.7, 0.7] : [-5, 0, 5]) {
				const span = Math.hypot(B[0] - A[0], B[2] - A[2]);
				const sag = span * span * (minor ? 0.00025 : 0.00018);
				let prev = null;
				for (let k = 0; k <= 10; k++) {
					const t = k / 10;
					const px = A[0] + A[3] * s + (B[0] + B[3] * s - A[0] - A[3] * s) * t;
					const pz = A[2] + A[4] * s + (B[2] + B[4] * s - A[2] - A[4] * s) * t;
					const py = A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t);
					if (prev) wires.push(...prev, px, py, pz);
					prev = [px, py, pz];
				}
			}
		}
	}
	if (pylons.count) {
		const mat = (sh.pylons ??= makeLitMaterial({ atmo, clouds, plane, worldShadow }));
		const geo = pylons.geometry();
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
	if (wires.length) {
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute(wires, 3));
		const mat = (sh.wires ??= wireMaterial(atmo));
		const lines = new LineSegments(g, mat);
		lines.frustumCulled = false;
		objects.push(lines);
		updatable.push(mat);
	}
	return {
		objects, shadowCasters, treeCount: trees.length,
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
		const albedo = mix(vec3(0.09, 0.06, 0.04), COL.leafy.mul(1.7).mul(mix(float(0.8), float(1.2), tint)), part);
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

