// Las 3D: pojedyncze drzewa wokół kamery, rozstawiane w całości na GPU. Siatka komórek co 5 m jest stała w świecie
// (przesuwa się skokowo z kamerą), w każdej komórce co najwyżej jedno drzewo – tam, gdzie mapa lasu i drzewostan
// (ta sama logika co tekstura koron) mówią „las”, poza duktami i zrębami. Trzy kształty w jednej geometrii:
// dojrzała sosna (wysoki pień, parasol korony), młoda sosna (stożek) i drzewo liściaste (kula); dwa poziomy
// szczegółów (blisko 7 boków, dalej 4). Na skraju zasięgu drzewa znikają rozpraszaniem pikseli (wygładza je TAA).
import { InstancedMesh, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Vector2, Matrix4 } from 'three/webgpu';
import {
	Fn, float, int, vec2, vec3, vec4, uniform, attribute, varying, instanceIndex, floor, max, min, mix, smoothstep, step, length,
	normalize, dot, select, cos, sin, pow, cameraPosition, Discard, If, screenCoordinate, interleavedGradientNoise, mrt, texture,
} from 'three/tsl';
import { hash12, hash22 } from './gfx/noise.js';
import { forestStand, forestCover } from './gfx/stand.js';
import { COL } from './gfx/palette.js';
import { CASTER_LAYER } from './shadows.js';
import { cityLight, snowCover } from './gfx/ground.js';

const EARTH_R = 6371000;
const SPACING = 5;

// Pierścienie korony: wysokość (ułamek wysokości drzewa) i promień – dla trzech kształtów o tej samej topologii.
const RINGS = {
	y: [0.5, 0.56, 0.66, 0.78, 0.88, 0.96, 1.0],
	umbrella: [0, 0.1, 0.15, 0.165, 0.14, 0.08, 0],
	cone: [0, 0.2, 0.17, 0.13, 0.09, 0.04, 0],
	round: [0, 0.16, 0.22, 0.23, 0.19, 0.11, 0],
};
const coneY = (y) => 0.12 + ((y - 0.5) / 0.5) * 0.88;
const roundY = (y) => 0.3 + ((y - 0.5) / 0.5) * 0.7;

/** Geometria drzewa (wysokość 1): pień + korona z pierścieni; atrybuty innych kształtów i część (0 – pień, 1 – korona). */
export function treeGeometry(sides) {
	const pos = [], cone = [], round = [], part = [], rel = [], idx = [];
	const vert = (p, c, r, pt, h) => { pos.push(...p); cone.push(...c); round.push(...r); part.push(pt); rel.push(h); return pos.length / 3 - 1; };
	// pień (kilka boków, bez denek)
	const ts = Math.max(3, sides - 2);
	for (let i = 0; i < ts; i++) {
		const a = (i / ts) * Math.PI * 2, x = Math.cos(a) * 0.014, z = Math.sin(a) * 0.014;
		vert([x, -0.05, z], [x, -0.05, z], [x, -0.05, z], 0, 0);
		vert([x * 0.7, 0.62, z * 0.7], [x * 0.7, 0.3, z * 0.7], [x * 0.7, 0.42, z * 0.7], 0, 0);
	}
	for (let i = 0; i < ts; i++) {
		const a = i * 2, b = ((i + 1) % ts) * 2;
		idx.push(a, b, a + 1, b, b + 1, a + 1);
	}
	// korona
	const base = pos.length / 3;
	const R = RINGS.y.length;
	for (let k = 0; k < R; k++) {
		const y = RINGS.y[k];
		for (let i = 0; i < sides; i++) {
			const a = (i / sides) * Math.PI * 2 + k * 0.4, c = Math.cos(a), s = Math.sin(a);
			vert([c * RINGS.umbrella[k], y, s * RINGS.umbrella[k]], [c * RINGS.cone[k], coneY(y), s * RINGS.cone[k]],
				[c * RINGS.round[k], roundY(y), s * RINGS.round[k]], 1, k / (R - 1));
		}
	}
	for (let k = 0; k < R - 1; k++) for (let i = 0; i < sides; i++) {
		const a = base + k * sides + i, b = base + k * sides + ((i + 1) % sides);
		const c = a + sides, d = b + sides;
		idx.push(a, b, c, b, d, c);
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(pos, 3));
	g.setAttribute('aCone', new Float32BufferAttribute(cone, 3));
	g.setAttribute('aRound', new Float32BufferAttribute(round, 3));
	g.setAttribute('aPart', new Float32BufferAttribute(part, 1));
	g.setAttribute('aRel', new Float32BufferAttribute(rel, 1));
	g.setIndex(idx);
	return g;
}

export function createForest(region, atmo, clouds, terrain, roadMask = null, worldShadow = null, plane = null) {
	const size = region.size;
	const forestTex = texture(region.forestTex);
	const hTex = texture(region.heightTex);
	const maskTex = roadMask ? texture(roadMask) : null;
	const U = {
		cam: uniform(new Vector2()),
		curVP: uniform(new Matrix4()),
		prevVP: uniform(new Matrix4()),
		near: uniform(380), // granica bliskiego poziomu szczegółów
		far: uniform(1100), // zasięg drzew 3D
	};
	const regionUv = (xz) => xz.div(size).add(0.5);
	const heightAt = (xz) => {
		const uvR = regionUv(xz);
		const e = terrain.uniforms.edgeH, rl = terrain.uniforms.relief;
		const edge = min(min(uvR.x, float(1).sub(uvR.x)), min(uvR.y, float(1).sub(uvR.y))).mul(size);
		return mix(e, e.add(hTex.sample(uvR).level(0).r.sub(e).mul(rl)), smoothstep(0, 800, edge));
	};

	/** Rozmieszczenie drzewa (wspólne dla materiału oświetlonego i dla przebiegu cienia). */
	const placement = (n, isNear) => {
		const vWorld = varying(vec3(0), 'vTreeWorld');
		const vNormal = varying(vec3(0), 'vTreeNormal');
		const vInfo = varying(vec4(0), 'vTreeInfo'); // część, wysokość w koronie, typ (0 sosna, 1 młoda, 2 liściaste), odcień
		const vFade = varying(float(0), 'vTreeFade');
		const position = Fn(() => {
			const i = int(instanceIndex);
			const gx = float(i.mod(n)), gz = float(i.div(n));
			const base = floor(U.cam.div(SPACING)).sub(n / 2);
			const cell = base.add(vec2(gx, gz));
			const h2 = hash22(cell);
			const xz = cell.add(0.15).add(h2.mul(0.7)).mul(SPACING);
			const uvR = regionUv(xz);
			const inside = step(0.002, uvR.x).mul(step(uvR.x, 0.998)).mul(step(0.002, uvR.y)).mul(step(uvR.y, 0.998));
			const fw = forestCover(forestTex, uvR, xz);
			const st = forestStand(xz);
			// z danymi OSM drzewa omijają prawdziwe drogi (maska), bez nich – wymyślone dukty na granicach oddziałów
			const notLane = maskTex ? step(maskTex.sample(uvR).level(0).r, 0.4) : step(4, st.toEdge);
			const keep = step(hash12(cell.add(3.7)), fw.mul(0.97)).mul(st.clear.oneMinus()).mul(notLane).mul(inside);
			// zasięg: bliski poziom do `near`, daleki od `near` do `far` (te same komórki – bez przeskoków drzew)
			const d = length(xz.sub(U.cam));
			const band = isNear ? step(d, U.near) : step(U.near, d).mul(step(d, U.far));
			vFade.assign(isNear ? float(1) : float(1).sub(smoothstep(U.far.mul(0.86), U.far, d)));
			// typ i wielkość
			const r1 = hash12(cell.add(11.1)), r2 = hash12(cell.add(23.3));
			const young = st.young, leafy = st.leafy.mul(young.oneMinus()).max(step(0.93, r1).mul(young.oneMinus()));
			const H = select(young.greaterThan(0.5), mix(float(6), float(11), r2), select(leafy.greaterThan(0.5), mix(float(16), float(22), r2), mix(float(18), float(25), r2)));
			const shape = mix(mix(attribute('position', 'vec3'), attribute('aCone', 'vec3'), young), attribute('aRound', 'vec3'), leafy);
			// lekki obrót i nieregularność korony
			const a = r1.mul(6.283);
			const ca = cos(a), sa = sin(a);
			const local = vec3(shape.x.mul(ca).sub(shape.z.mul(sa)), shape.y, shape.x.mul(sa).add(shape.z.mul(ca)))
				.mul(vec3(mix(float(0.85), float(1.2), r2), 1, mix(float(0.85), float(1.2), r1))).mul(H);
			const ground = heightAt(xz).sub(H.mul(0.22)); // DSM ma już część koron w rzeźbie – drzewo „siada” niżej
			const world = vec3(xz.x, ground, xz.y).add(local);
			const dc = world.xz.sub(U.cam);
			const curved = world.sub(vec3(0, dot(dc, dc).div(2 * EARTH_R), 0));
			// normalna korony: elipsoida wokół środka korony (miękkie światło), pień – promieniowo
			const part = attribute('aPart', 'float');
			const cy = select(young.greaterThan(0.5), float(0.5), select(leafy.greaterThan(0.5), float(0.65), float(0.8))).mul(H);
			const nCrown = normalize(local.sub(vec3(0, cy, 0)).mul(vec3(1, 0.7, 1)));
			const nTrunk = normalize(vec3(local.x, 0, local.z).add(vec3(0, 0.001, 0)));
			vNormal.assign(mix(nTrunk, nCrown, part));
			vWorld.assign(world);
			vInfo.assign(vec4(part, attribute('aRel', 'float'), young.add(leafy.mul(2)), r2));
			const scale = keep.mul(band);
			// odrzucone drzewo zapada się do punktu (zdegenerowane trójkąty nie dają pikseli)
			return mix(vec3(xz.x, ground, xz.y), curved, scale);
		})();
		return { position, vWorld, vNormal, vInfo, vFade };
	};

	const makeMesh = (sides, n, isNear) => {
		const geo = treeGeometry(sides);
		const mat = new MeshBasicNodeMaterial();
		const { position, vWorld, vNormal, vInfo, vFade } = placement(n, isNear);
		mat.positionNode = position;
		const sunDir = atmo.u.lightDir;
		mat.colorNode = Fn(() => {
			// rozproszone znikanie na skraju zasięgu
			If(interleavedGradientNoise(screenCoordinate.xy).greaterThan(vFade), () => { Discard(); });
			const part = vInfo.x, rel = vInfo.y, type = vInfo.z, tint = vInfo.w;
			// sosny ciemniejsze i chłodniejsze, liściaste jaśniejsze – ale bez jaskrawości
			const crown = select(type.greaterThan(1.5), COL.leafy.mul(1.6), select(type.greaterThan(0.5), COL.pineYoung.mul(2.4), COL.pineOld.mul(2.9)))
				.mul(mix(float(0.8), float(1.2), tint));
			const bark = vec3(0.09, 0.055, 0.035);
			const N = normalize(vNormal);
			// śnieg na koronach (pogoda): na górnych, poziomych częściach, w plamach
			const snowy = snowCover.mul(smoothstep(0.25, 0.75, N.y)).mul(part).mul(mix(float(0.55), float(0.95), tint));
			const albedo = mix(mix(bark, crown, part), vec3(0.8, 0.82, 0.86), snowy);
			const sunE = atmo.sunLight(vWorld.y);
			const skyE = atmo.skyIrradiance();
			// listowie przepuszcza i rozprasza światło – miękkie „owinięcie” zamiast twardego cosinusa
			const ndl = max(0, dot(N, sunDir).mul(0.7).add(0.3)).mul(smoothstep(-0.02, 0.02, sunDir.y));
			const ao = mix(float(0.45), float(1.0), rel).mul(mix(float(0.7), float(1), part));
			let shadow = clouds.groundShadow(vWorld);
			// cień od sąsiednich drzew i budynków; przesunięcie w stronę słońca – korona nie cieniuje sama siebie
			if (worldShadow) shadow = shadow.mul(mix(float(0.35), float(1), worldShadow.visibility(vWorld.add(sunDir.mul(2.5)), 1.5)));
			const bounce = sunE.mul(max(0, sunDir.y)).mul(vec3(0.1, 0.12, 0.07));
			// prześwit: pod słońce brzegi koron świecą (światło przechodzi przez igły i liście)
			const V = normalize(cameraPosition.sub(vWorld));
			const back = pow(max(0, dot(V.negate(), sunDir)), 5).mul(0.5).mul(part).mul(float(1).sub(N.y.mul(0.5)));
			const landing = (plane ? plane.lights.landingLight(vWorld, N).mul(0.8).add(plane.lights.landingLight(vWorld, N.negate()).mul(0.2)) : vec3(0)).add(cityLight(vWorld).mul(0.6));
			return albedo.div(Math.PI).mul(sunE.mul(ndl.add(back)).mul(shadow).mul(mix(float(0.75), float(1), rel)).add(skyE.mul(N.y.mul(0.5).add(0.5)).add(bounce).mul(ao)).add(landing));
		})();
		// wektory ruchu dla TAA: drzewa stoją w miejscu świata, więc liczymy je z pozycji świata i macierzy kamery
		mat.mrtNode = mrt({
			velocity: Fn(() => {
				const c = U.curVP.mul(vec4(vWorld, 1)), p = U.prevVP.mul(vec4(vWorld, 1));
				return c.xy.div(c.w).sub(p.xy.div(p.w));
			})(),
		});
		mat.fog = false;
		const mesh = new InstancedMesh(geo, mat, n * n);
		mesh.frustumCulled = false;
		// osobna, tania siatka tylko do mapy cieni (warstwa rzucających cień, bez oświetlenia i wektorów ruchu)
		const smat = new MeshBasicNodeMaterial();
		const sp = placement(n, isNear);
		smat.positionNode = sp.position;
		smat.colorNode = Fn(() => {
			If(interleavedGradientNoise(screenCoordinate.xy).greaterThan(sp.vFade), () => { Discard(); });
			return vec3(0);
		})();
		const shadowMesh = new InstancedMesh(geo, smat, n * n);
		shadowMesh.frustumCulled = false;
		shadowMesh.layers.set(CASTER_LAYER);
		mesh.userData.shadowMesh = shadowMesh;
		return mesh;
	};

	const nearN = Math.ceil((2 * 380) / SPACING);
	const farN = Math.ceil((2 * 1100) / SPACING);
	const nearMesh = makeMesh(7, nearN, true);
	const farMesh = makeMesh(4, farN, false);
	const prev = new Matrix4();
	let first = true;

	return {
		objects: [nearMesh, farMesh],
		shadowCasters: [nearMesh.userData.shadowMesh, farMesh.userData.shadowMesh],
		uniforms: U,
		/** Przed renderem klatki (macierze kamery bez drgania TAA). */
		update(camera) {
			U.cam.value.set(camera.position.x, camera.position.z);
			camera.updateMatrixWorld();
			const cur = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			U.prevVP.value.copy(first ? cur : prev);
			U.curVP.value.copy(cur);
			prev.copy(cur);
			first = false;
		},
	};
}

