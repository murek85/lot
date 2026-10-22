// Las 3D: pojedyncze drzewa wokół kamery, rozstawiane w całości na GPU. Siatka komórek co 5 m jest stała w świecie
// (przesuwa się skokowo z kamerą), w każdej komórce co najwyżej jedno drzewo – tam, gdzie mapa lasu i drzewostan
// (ta sama logika co tekstura koron) mówią „las”, poza duktami i zrębami. Trzy kształty w jednej geometrii:
// dojrzała sosna (wysoki pień, parasol korony), młoda sosna (stożek) i drzewo liściaste (kula); dwa poziomy
// szczegółów (blisko 7 boków, dalej 4). Na skraju zasięgu drzewa znikają rozpraszaniem pikseli (wygładza je TAA).
import { InstancedMesh, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Vector2, Matrix4 } from 'three/webgpu';
import {
	Fn, float, int, vec2, vec3, vec4, uniform, attribute, varying, instanceIndex, floor, max, min, mix, smoothstep, step, fract, length,
	normalize, dot, select, cos, sin, pow, cameraPosition, Discard, If, screenCoordinate, interleavedGradientNoise, mrt, texture, abs, positionLocal,
} from 'three/tsl';
import { hash12, hash22, valueNoise } from './gfx/noise.js';
import { forestStand, forestCover, aboveTreeline } from './gfx/stand.js';
import { COL } from './gfx/palette.js';
import { CASTER_LAYER, CASTER_NEAR } from './shadows.js';
import { reliefShadow } from './world/reliefshade.js';
import { cityLight, snowCover, bareTrees, BARE, SEASON, worldOffset } from './gfx/ground.js';

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

/**
 * win – zamiast tekstur regionu (otwarty świat): { tex (R – gęstość lasu, G – wysokość − base, B – maska dróg),
 * size (bok okna, adresowanie w kółko), base (uniform) }.
 */
/**
 * Wiatr dla drzew 3D (ustawia src/main.js co klatkę): v – wiatr przy ziemi (m/s, x – wschód, y – południe),
 * t – czas gry (s), dt – długość klatki (s; położenie z poprzedniej klatki do wektorów ruchu TAA).
 */
export const TREE_WIND = { v: uniform(new Vector2()), t: uniform(0), dt: uniform(0) };

/**
 * Wychylenie wierzchołka korony (m, w poziomie) w chwili time: pochylenie z wiatrem i kołysanie (faza i częstotliwość
 * z losu drzewa), fale porywów przesuwające się z wiatrem; bend – ugięcie (0 u podstawy, 1 na wierzchołku).
 */
function sway(pxz, r1, r2, H, time) {
	const v = TREE_WIND.v, speed = length(v);
	const dir = v.div(max(speed, 0.01)), cross = vec2(dir.y.negate(), dir.x);
	const amp = min(float(0.7), speed.mul(0.012).add(speed.mul(speed).mul(0.0022))).mul(H.div(20));
	const gust = valueNoise(pxz.div(90).sub(v.mul(time).mul(0.06))).mul(0.9).add(0.35);
	const w = mix(float(1.6), float(2.6), r2), ph = r1.mul(6.283);
	const along = gust.mul(float(0.55).add(sin(time.mul(w).add(ph)).mul(0.45)));
	const side = sin(time.mul(w.mul(1.37)).add(ph.mul(1.7))).mul(0.22);
	return dir.mul(along).add(cross.mul(side)).mul(amp);
}

export function createForest(region, atmo, clouds, terrain, roadMask = null, worldShadow = null, plane = null, win = null) {
	const size = region.size;
	const forestTex = texture(win ? win.tex : region.forestTex);
	const hTex = win ? null : texture(region.heightTex);
	const maskTex = roadMask ? texture(roadMask) : null;
	const U = {
		cam: uniform(new Vector2()),
		curVP: uniform(new Matrix4()),
		prevVP: uniform(new Matrix4()),
		near: uniform(380), // granica bliskiego poziomu szczegółów
		far: uniform(1500), // zasięg drzew 3D
		mid: uniform(2600), // granica pasm odległych drzew (co 10 m – bliżej, co 20 m – dalej)
		dist: uniform(5000), // zasięg odległych drzew (czworokąty zwrócone do kamery); dalej – korony w terenie
	};
	const regionUv = win ? (xz) => xz.div(win.size) : (xz) => xz.div(size).add(0.5);
	const heightAt = win ? (xz) => forestTex.sample(regionUv(xz)).level(0).g.add(win.base) : (xz) => {
		const uvR = regionUv(xz);
		const e = terrain.uniforms.edgeH, rl = terrain.uniforms.relief;
		const edge = min(min(uvR.x, float(1).sub(uvR.x)), min(uvR.y, float(1).sub(uvR.y))).mul(size);
		return mix(e, e.add(hTex.sample(uvR).level(0).r.sub(e).mul(rl)), smoothstep(0, 800, edge));
	};

	/** Rozmieszczenie drzewa (wspólne dla materiału oświetlonego i dla przebiegu cienia). */
	const placement = (n, isNear, withRelief = false) => {
		const vWorld = varying(vec3(0), 'vTreeWorld');
		const vNormal = varying(vec3(0), 'vTreeNormal');
		const vInfo = varying(vec4(0), 'vTreeInfo'); // część, wysokość w koronie, typ (0 sosna, 1 młoda, 2 liściaste), odcień
		const vFade = varying(float(0), 'vTreeFade');
		const vRelief = varying(float(1), 'vTreeRelief');
		const vPrev = varying(vec3(0), 'vTreePrev'); // położenie w poprzedniej klatce (kołysanie) – wektory ruchu
		const position = Fn(() => {
			const i = int(instanceIndex);
			const gx = float(i.mod(n)), gz = float(i.div(n));
			const base = floor(U.cam.div(SPACING)).sub(n / 2);
			const cell = base.add(vec2(gx, gz));
			// losowanie z komórki w układzie stałym względem Ziemi (przesunięcie początku – wielokrotność SPACING)
			const gcell = cell.add(worldOffset.div(SPACING));
			const h2 = hash22(gcell);
			const xz = cell.add(0.15).add(h2.mul(0.7)).mul(SPACING);
			const uvR = regionUv(xz);
			const inside = win ? float(1) : step(0.002, uvR.x).mul(step(uvR.x, 0.998)).mul(step(0.002, uvR.y)).mul(step(uvR.y, 0.998));
			const pxz = xz.add(worldOffset);
			const fw = forestCover(forestTex, uvR, pxz);
			const gh = heightAt(xz); // wysokość n.p.m. – w górach drzewostany nieregularne (src/gfx/stand.js)
			const st = forestStand(pxz, gh);
			// z danymi OSM drzewa omijają prawdziwe drogi (maska), bez nich – wymyślone dukty na granicach oddziałów
			const notLane = win ? step(forestTex.sample(uvR).level(0).b, 0.4) : maskTex ? step(maskTex.sample(uvR).level(0).r, 0.4) : step(4, st.toEdge);
			const keep = step(hash12(gcell.add(3.7)), fw.mul(0.97)).mul(st.clear.oneMinus()).mul(notLane).mul(inside);
			// zasięg: bliski poziom do `near`, daleki od `near` do `far` (te same komórki – bez przeskoków drzew)
			const d = length(xz.sub(U.cam));
			const band = isNear ? step(d, U.near) : step(U.near, d).mul(step(d, U.far));
			vFade.assign(isNear ? float(1) : float(1).sub(smoothstep(U.far.mul(0.86), U.far, d)));
			// typ i wielkość
			const r1 = hash12(gcell.add(11.1)), r2 = hash12(gcell.add(23.3));
			const young = st.young, leafy = st.leafy.mul(young.oneMinus()).max(step(0.93, r1).mul(young.oneMinus()));
			// nad górną granicą lasu (src/gfx/stand.js) kosodrzewina: drzewa maleją do ~2–3 m, powyżej ~1750 m – brak
			const ab = aboveTreeline(pxz, gh);
			const dwarfK = smoothstep(-60, 40, ab), alpineGap = float(1).sub(smoothstep(250, 330, ab));
			const H = select(young.greaterThan(0.5), mix(float(6), float(11), r2), select(leafy.greaterThan(0.5), mix(float(16), float(22), r2), mix(float(18), float(25), r2)))
				.mul(mix(float(1), float(0.13), dwarfK));
			const shape = mix(mix(attribute('position', 'vec3'), attribute('aCone', 'vec3'), young), attribute('aRound', 'vec3'), leafy);
			// lekki obrót i nieregularność korony
			const a = r1.mul(6.283);
			const ca = cos(a), sa = sin(a);
			const local = vec3(shape.x.mul(ca).sub(shape.z.mul(sa)), shape.y, shape.x.mul(sa).add(shape.z.mul(ca)))
				.mul(vec3(mix(float(0.85), float(1.2), r2), 1, mix(float(0.85), float(1.2), r1))).mul(H);
			const ground = gh.sub(H.mul(0.22)); // DSM ma już część koron w rzeźbie – drzewo „siada” niżej
			// otwarty świat: cień gór i zboczy (zgrubne okno rzeźby, src/world/reliefshade.js) – raz na drzewo, od wierzchołka
			// korony lasu; cienie sąsiednich koron drzewo liczy samo (worldShadow)
			if (withRelief && win?.relief) vRelief.assign(reliefShadow(win.relief, atmo, float(17), xz, gh, float(1), float(100), true));
			// kołysanie na wietrze: ugięcie rośnie z kwadratem wysokości nad ziemią (pień u podstawy stoi)
			const bend = max(0, local.y).div(H).pow(2);
			const s0 = sway(pxz, r1, r2, H, TREE_WIND.t).mul(bend), s1 = sway(pxz, r1, r2, H, TREE_WIND.t.sub(TREE_WIND.dt)).mul(bend);
			const rest = vec3(xz.x, ground, xz.y).add(local);
			const world = rest.add(vec3(s0.x, 0, s0.y));
			vPrev.assign(rest.add(vec3(s1.x, 0, s1.y)));
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
			const scale = keep.mul(band).mul(alpineGap);
			// odrzucone drzewo zapada się do punktu (zdegenerowane trójkąty nie dają pikseli)
			return mix(vec3(xz.x, ground, xz.y), curved, scale);
		})();
		return { position, vWorld, vNormal, vInfo, vFade, vRelief, vPrev };
	};

	const makeMesh = (sides, n, isNear) => {
		const geo = treeGeometry(sides);
		const mat = new MeshBasicNodeMaterial();
		const { position, vWorld, vNormal, vInfo, vFade, vRelief, vPrev } = placement(n, isNear, true);
		mat.positionNode = position;
		const sunDir = atmo.u.lightDir;
		mat.colorNode = Fn(() => {
			// rozproszone znikanie na skraju zasięgu
			If(interleavedGradientNoise(screenCoordinate.xy).greaterThan(vFade), () => { Discard(); });
			const part = vInfo.x, rel = vInfo.y, type = vInfo.z, tint = vInfo.w;
			// zima: korona liściastych z prześwitami (gałęzie zamiast liści) – plamki ~0,6 m stałe w świecie, widać przez nie
			// śnieg na ziemi
			const twig = hash12(floor(vWorld.xz.add(worldOffset).mul(1.7)).add(floor(vWorld.y.mul(1.7)).mul(17.31)));
			If(type.greaterThan(1.5).and(part.greaterThan(0.5)).and(twig.lessThan(bareTrees.mul(0.55))), () => { Discard(); });
			// sosny ciemniejsze i chłodniejsze, liściaste jaśniejsze – ale bez jaskrawości
			// liściaste: liście pory roku, jesienią część drzew (los niezależny od jasności) żółknie, zimą nagie
			const leaves = mix(SEASON.leaf, SEASON.autumnLeaf, step(fract(tint.mul(7.31)), SEASON.autumn));
			const crown = select(type.greaterThan(1.5), mix(leaves.mul(1.6), vec3(...BARE).mul(1.6), bareTrees), select(type.greaterThan(0.5), COL.pineYoung.mul(2.4), COL.pineOld.mul(2.9)))
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
			let shadow = clouds.groundShadow(vWorld).mul(vRelief);
			// cień od sąsiednich drzew i budynków; przesunięcie w stronę słońca – korona nie cieniuje sama siebie
			if (worldShadow) shadow = shadow.mul(mix(float(0.35), float(1), worldShadow.visibility(vWorld.add(sunDir.mul(2.5)), 1.5)));
			const bounce = sunE.mul(max(0, sunDir.y)).mul(vec3(0.1, 0.12, 0.07));
			// prześwit: pod słońce brzegi koron świecą (światło przechodzi przez igły i liście)
			const V = normalize(cameraPosition.sub(vWorld));
			const back = pow(max(0, dot(V.negate(), sunDir)), 5).mul(0.5).mul(part).mul(float(1).sub(N.y.mul(0.5)));
			const landing = (plane ? plane.lights.landingLight(vWorld, N).mul(0.8).add(plane.lights.landingLight(vWorld, N.negate()).mul(0.2)) : vec3(0)).add(cityLight(vWorld).mul(0.6));
			return albedo.div(Math.PI).mul(sunE.mul(ndl.add(back)).mul(shadow).mul(mix(float(0.75), float(1), rel)).add(skyE.mul(N.y.mul(0.5).add(0.5)).add(bounce).mul(ao)).add(landing));
		})();
		// wektory ruchu dla TAA: z pozycji świata i macierzy kamery – teraz i w poprzedniej klatce (kołysanie korony)
		mat.mrtNode = mrt({
			velocity: Fn(() => {
				const c = U.curVP.mul(vec4(vWorld, 1)), p = U.prevVP.mul(vec4(vPrev, 1));
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
		if (isNear) shadowMesh.layers.enable(CASTER_NEAR); // bliska kaskada – tylko bliskie drzewa
		mesh.userData.shadowMesh = shadowMesh;
		return mesh;
	};

	/**
	 * Odległe drzewa w paśmie [from, to] (uniformy, m): jedno na komórkę spacing (m; korony powiększone tak, by las był
	 * tak samo zwarty jak z drzew 3D co 5 m), korona jako czworokąt zwrócony do kamery
	 * (pionowa oś) z eliptyczną sylwetką i normalną kuli – kilka razy mniej wierzchołków niż drzewo 3D. Te same barwy
	 * (pora roku, nagie zimą, śnieg) i światło (cień rzeźby, chmur); bez cieni w mapie (poza jej zasięgiem). Na obu
	 * brzegach pasma – łagodne przenikanie (rozproszone znikanie jak u drzew 3D). Dane: w regionie – tekstury regionu,
	 * w otwartym świecie – okno gruntu, a dalej zgrubne okno rzeźby (gęstość lasu i wysokość co ~55 m).
	 */
	const makeDistant = (spacing, from, to) => {
		const DIST_SPACING = spacing;
		const crownMul = Math.sqrt(spacing / SPACING) * 1.2; // 10 m – ×1,7, 20 m – ×2,4
		const n = Math.ceil((2 * to.value) / DIST_SPACING);
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
		g.setIndex([0, 1, 2, 0, 2, 3]);
		const vWorld = varying(vec3(0), 'vDTreeWorld');
		const vQuad = varying(vec2(0), 'vDTreeQuad');
		const vInfo = varying(vec4(0), 'vDTreeInfo'); // przenikanie, typ (0 sosna, 1 młoda, 2 liściaste), odcień, cień rzeźby
		const vRight = varying(vec3(0), 'vDTreeRight');
		const R = win?.relief;
		const mat = new MeshBasicNodeMaterial();
		mat.positionNode = Fn(() => {
			const i = int(instanceIndex);
			const cell = floor(U.cam.div(DIST_SPACING)).sub(n / 2).add(vec2(float(i.mod(n)), float(i.div(n))));
			const gcell = cell.add(worldOffset.div(DIST_SPACING));
			const xz = cell.add(0.2).add(hash22(gcell.add(5.3)).mul(0.6)).mul(DIST_SPACING);
			const pxz = xz.add(worldOffset);
			const uvR = regionUv(xz);
			// gęstość lasu i wysokość: okno gruntu (blisko) albo zgrubne okno rzeźby (dalej); w regionie – jego tekstury
			let fw = forestCover(forestTex, uvR, pxz), gh = heightAt(xz), ok = float(1);
			if (R) {
				const inFine = max(abs(xz.x.sub(R.fineC.x)), abs(xz.y.sub(R.fineC.y))).lessThan(R.fineReach);
				const c = R.coarse.sample(xz.div(R.coarseSize)).level(0);
				fw = select(inFine, fw, smoothstep(0.35, 0.65, c.r));
				gh = select(inFine, gh, c.g.add(R.coarseBase));
				ok = select(inFine, float(1), c.b.mul(R.on));
			} else {
				ok = step(0.002, uvR.x).mul(step(uvR.x, 0.998)).mul(step(0.002, uvR.y)).mul(step(uvR.y, 0.998));
			}
			const st = forestStand(pxz, gh);
			const keep = step(hash12(gcell.add(3.7)), fw.mul(0.97)).mul(st.clear.oneMinus()).mul(ok);
			const d = length(xz.sub(U.cam));
			// pasmo: od 0,86 jego początku (przenikanie z bliższymi drzewami) do końca (przenikanie z dalszymi albo z koronami
			// terenu)
			const band = step(from.mul(0.86), d).mul(step(d, to));
			const fade = smoothstep(from.mul(0.86), from, d).mul(float(1).sub(smoothstep(to.mul(0.86), to, d)));
			const r1 = hash12(gcell.add(11.1)), r2 = hash12(gcell.add(23.3));
			const young = st.young, leafy = st.leafy.mul(young.oneMinus()).max(step(0.93, r1).mul(young.oneMinus()));
			// nad górną granicą lasu (src/gfx/stand.js) kosodrzewina: drzewa maleją do ~2–3 m, powyżej ~1750 m – brak
			const ab = aboveTreeline(pxz, gh);
			const dwarfK = smoothstep(-60, 40, ab), alpineGap = float(1).sub(smoothstep(250, 330, ab));
			const H = select(young.greaterThan(0.5), mix(float(6), float(11), r2), select(leafy.greaterThan(0.5), mix(float(16), float(22), r2), mix(float(18), float(25), r2)))
				.mul(mix(float(1), float(0.13), dwarfK));
			// korona: promień ~0,2 wysokości, powiększony o crownMul (jedno drzewo na kilka komórek drzew 3D), od 0,35
			// wysokości do szczytu
			const rad = H.mul(select(leafy.greaterThan(0.5), float(0.24), float(0.17))).mul(crownMul);
			const ground = gh.sub(H.mul(0.22));
			const y0 = ground.add(H.mul(0.35)), y1 = ground.add(H);
			// czworokąt zwrócony do kamery wokół pionowej osi
			const toCam = vec3(cameraPosition.x.sub(xz.x), 0, cameraPosition.z.sub(xz.y));
			const right = normalize(vec3(toCam.z, 0, toCam.x.negate()).add(vec3(1e-4, 0, 0)));
			const q = positionLocal.xy;
			const center = vec3(xz.x, 0, xz.y);
			const world = center.add(right.mul(q.x.mul(rad))).add(vec3(0, mix(y0, y1, q.y), 0));
			const dc = world.xz.sub(U.cam);
			const curved = world.sub(vec3(0, dot(dc, dc).div(2 * EARTH_R), 0));
			const relief = R ? reliefShadow(R, atmo, float(17), xz, gh, float(1), float(100), true) : float(1);
			vWorld.assign(world);
			vQuad.assign(q);
			vRight.assign(right);
			vInfo.assign(vec4(fade, young.add(leafy.mul(2)), r2, relief));
			return mix(center.add(vec3(0, ground, 0)), curved, keep.mul(band).mul(alpineGap));
		})();
		const sunDir = atmo.u.lightDir;
		mat.colorNode = Fn(() => {
			const fade = vInfo.x, type = vInfo.y, tint = vInfo.z;
			// sylwetka: elipsa (szersza nieco poniżej środka), poza nią i przy przenikaniu – rozproszone odrzucenie
			const qx = vQuad.x, qy = vQuad.y.mul(2).sub(1.1).div(0.9);
			const r2d = qx.mul(qx).add(qy.mul(qy));
			If(r2d.greaterThan(1).or(interleavedGradientNoise(screenCoordinate.xy).greaterThan(fade)), () => { Discard(); });
			const leaves = mix(SEASON.leaf, SEASON.autumnLeaf, step(fract(tint.mul(7.31)), SEASON.autumn));
			const crown = select(type.greaterThan(1.5), mix(leaves.mul(1.6), vec3(...BARE).mul(1.6), bareTrees), select(type.greaterThan(0.5), COL.pineYoung.mul(2.4), COL.pineOld.mul(2.9)))
				.mul(mix(float(0.8), float(1.2), tint));
			// normalna kuli: z boku czworokąta, z góry i ku kamerze
			const toCam = normalize(cameraPosition.sub(vWorld).mul(vec3(1, 0, 1)));
			const N = normalize(vRight.mul(qx).add(vec3(0, qy.mul(0.7).add(0.35), 0)).add(toCam.mul(float(1).sub(r2d).max(0).sqrt())));
			const snowy = snowCover.mul(smoothstep(0.25, 0.75, N.y)).mul(mix(float(0.55), float(0.95), tint));
			const albedo = mix(crown, vec3(0.8, 0.82, 0.86), snowy);
			const sunE = atmo.sunLight(vWorld.y);
			const skyE = atmo.skyIrradiance();
			const ndl = max(0, dot(N, sunDir).mul(0.7).add(0.3)).mul(smoothstep(-0.02, 0.02, sunDir.y));
			const shadow = clouds.groundShadow(vWorld).mul(vInfo.w);
			// dół korony ciemniejszy (zasłaniają go sąsiednie drzewa) – jak przesłanianie w drzewach 3D
			const ao = mix(float(0.5), float(1), vQuad.y);
			return albedo.div(Math.PI).mul(sunE.mul(ndl).mul(shadow).mul(mix(float(0.75), float(1), vQuad.y)).add(skyE.mul(N.y.mul(0.5).add(0.5)).mul(ao)).add(cityLight(vWorld).mul(0.6)));
		})();
		// wektory ruchu dla TAA: drzewa stoją w miejscu świata
		mat.mrtNode = mrt({
			velocity: Fn(() => {
				const c = U.curVP.mul(vec4(vWorld, 1)), p = U.prevVP.mul(vec4(vWorld, 1));
				return c.xy.div(c.w).sub(p.xy.div(p.w));
			})(),
		});
		mat.fog = false;
		const mesh = new InstancedMesh(g, mat, n * n);
		mesh.frustumCulled = false;
		return mesh;
	};

	const nearN = Math.ceil((2 * 380) / SPACING);
	const farN = Math.ceil((2 * U.far.value) / SPACING);
	const nearMesh = makeMesh(7, nearN, true);
	const farMesh = makeMesh(4, farN, false);
	const distMesh = makeDistant(10, U.far, U.mid);
	const distMesh2 = makeDistant(20, U.mid, U.dist);
	const prev = new Matrix4();
	let first = true;

	return {
		objects: [nearMesh, farMesh, distMesh, distMesh2],
		shadowCasters: [nearMesh.userData.shadowMesh, farMesh.userData.shadowMesh],
		uniforms: U,
		/** Przesunięcie początku układu o (dx, dz): poprzednia macierz kamery w nowym układzie (wektory ruchu bez skoku). */
		shiftOrigin(dx, dz) { prev.multiply(new Matrix4().makeTranslation(dx, 0, dz)); },
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

