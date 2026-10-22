// Kafle otwartego świata w scenie: teren (siatka z wysokościami i normalnymi z wątku, barwy z rastra pokrycia –
// jedna tekstura warstwowa na wszystkie kafle, jeden shader), w bliższym pierścieniu drogi (wstęgi jak w regionach)
// i budynki (te same moduły co w regionach, wspólne materiały). Do tego daleka „podłoga” pod brzegiem wczytanego
// obszaru. Geometria w metrach układu świata (początek origin) – materiały jak w regionach.
import {
	Mesh, Group, BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshBasicNodeMaterial, DataArrayTexture, RedFormat,
	UnsignedByteType, NearestFilter, Vector2, PlaneGeometry, DataTexture, RepeatWrapping, RGFormat, Sphere, Vector3,
} from 'three/webgpu';
import {
	Fn, float, vec2, vec3, vec4, int, ivec2, attribute, varying, uniform, textureLoad, max, abs, clamp, normalize, floor, fract,
	smoothstep, positionLocal, step, mix, dot, texture, If, Discard,
} from 'three/tsl';
import { onGround, worldOffset } from '../gfx/ground.js';
import { RELIEF, reliefShadow, reliefCavity, reliefReflect } from './reliefshade.js';
import { valueNoise, fbm } from '../gfx/noise.js';
import { shadeGround } from '../terrain.js';
import { GRID, COVER_RES } from './chunkdata.js';
import { gridHeightAt } from './streamer.js';
import { buildingMeshes } from '../buildings.js';
import { lonLatToLocal } from '../geo.js';
import { makeRoadMaterial, densify, ribbon } from '../roads.js';
import { riversFromArrays } from '../rivers.js';
import { railsFromArrays } from '../rails.js';
import { bridgesFromArrays } from '../bridges.js';
import { detailsFromArrays } from '../details.js';
import { COVER } from '../gen/terrain.js';

const SLOTS = 256;


/**
 * Siatka terenu kafla w metrach świata, uv kafla, numer warstwy pokrycia: ch.n² wierzchołków (65 z Terrarium, 129
 * z GUGiK), co stride-ty (dalekie kafle – mniej trójkątów). skirt – „fartuch”: pas wzdłuż brzegu opuszczony o tyle
 * metrów (na granicy z dalekim terenem o innej siatce nie widać szczelin).
 */
function terrainGeometry(ch, layer, skirt = 0, stride = 1) {
	const { x0, z0, w, h } = ch.frame;
	const N = ch.n ?? GRID, n = (N - 1) / stride + 1;
	const src = (i, j) => j * stride * N + i * stride; // indeks w danych kafla
	const ring = [];
	if (skirt) {
		for (let i = 0; i < n; i++) ring.push(i);
		for (let j = 1; j < n; j++) ring.push(j * n + n - 1);
		for (let i = n - 2; i >= 0; i--) ring.push((n - 1) * n + i);
		for (let j = n - 2; j >= 1; j--) ring.push(j * n);
	}
	const V = n * n + ring.length;
	const pos = new Float32Array(V * 3), uv = new Float32Array(V * 2), lay = new Float32Array(V).fill(layer), nrm = new Float32Array(V * 3);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		const k = j * n + i, q = src(i, j);
		pos.set([x0 + (i / (n - 1)) * w, ch.heights[q], z0 + (j / (n - 1)) * h], k * 3);
		uv.set([i / (n - 1), j / (n - 1)], k * 2);
		nrm.set([ch.normals[q * 3], ch.normals[q * 3 + 1], ch.normals[q * 3 + 2]], k * 3);
	}
	ring.forEach((k, r) => {
		const v = n * n + r;
		pos.set([pos[k * 3], pos[k * 3 + 1] - skirt, pos[k * 3 + 2]], v * 3);
		uv.set([uv[k * 2], uv[k * 2 + 1]], v * 2);
		nrm.set([nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]], v * 3);
	});
	const idx = new Uint32Array((n - 1) * (n - 1) * 6 + ring.length * 12);
	let p = 0;
	for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
		const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
		idx.set([a, c, b, b, c, d], p); p += 6;
	}
	// fartuch: obie strony (widać go od środka wczytanego obszaru)
	for (let r = 0; r < ring.length; r++) {
		const a = ring[r], b = ring[(r + 1) % ring.length], a2 = n * n + r, b2 = n * n + ((r + 1) % ring.length);
		idx.set([a, a2, b, b, a2, b2, a, b, a2, b, b2, a2], p); p += 12;
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(pos, 3));
	g.setAttribute('normal', new BufferAttribute(nrm, 3));
	g.setAttribute('uv', new BufferAttribute(uv, 2));
	g.setAttribute('aLayer', new BufferAttribute(lay, 1));
	g.setIndex(new BufferAttribute(idx, 1));
	return g;
}

/**
 * Sfera otaczająca kafel (rama, zakres wysokości) z zapasem na krzywiznę Ziemi (wierzchołki opadają o d²/2R
 * względem kamery – daleki teren o setki metrów): z nią three pomija kafle poza kadrem i poza obszarem mapy cieni,
 * zamiast wysyłać do karty wszystkie (to głównie czas procesora – ~20 µs na obiekt).
 */
function chunkSphere(ch, extra = 30) {
	const f = ch.frame;
	const lo = (ch.min ?? 0) - 60, hi = (ch.max ?? 0) + 150; // fartuchy w dół, budynki i słupy w górę
	return new Sphere(new Vector3(f.x0 + f.w / 2, (lo + hi) / 2, f.z0 + f.h / 2), Math.hypot(f.w / 2, f.h / 2, (hi - lo) / 2) + extra);
}

/** Pokrycie i odległość od brzegu kafla do warstwy tekstury RG (R – klasa, G – metry od brzegu w wodzie). */
function packCover(tex, ch, layer) {
	// R: klasa pokrycia (dolne 4 bity) i przyciemnienie przy budynkach i lesie 0–15 (górne 4 bity, chunkOcclusion),
	// G: odległość od brzegu
	const d = tex.image.data, o = layer * COVER_RES * COVER_RES * 2, c = ch.cover, sh = ch.shore, oc = ch.occ?.length ? ch.occ : null;
	for (let i = 0; i < c.length; i++) { d[o + i * 2] = (c[i] & 15) | (oc ? oc[i] << 4 : 0); d[o + i * 2 + 1] = sh ? sh[i] : 255; }
	tex.addLayerUpdate?.(layer); // tylko ta warstwa do karty (cała tekstura to ~33 MB)
	tex.needsUpdate = true;
}

// klasy pokrycia 0–3 i 4–7 jako wagi (jak w terenie regionu)
const oneHotA = (c) => max(vec4(0), vec4(1).sub(abs(vec4(c).sub(vec4(0, 1, 2, 3)))));
const oneHotB = (c) => max(vec4(0), vec4(1).sub(abs(vec4(c).sub(vec4(4, 5, 6, 7)))));
// świat zastępczy (podłoga za brzegiem wczytanego obszaru): lasy i pola z szumu
const outsideA = (xz) => {
	const fOut = smoothstep(0.50, 0.56, fbm(xz.div(4200), 4));
	const gOut = smoothstep(0.62, 0.70, valueNoise(xz.div(1300))).mul(float(1).sub(fOut));
	return vec4(gOut, fOut, 0, float(1).sub(fOut).sub(gOut));
};

/** Materiał terenu kafli: ten sam shader gruntu co w regionach (shadeGround), dane z rastra kafla i siatki. */
/** hole – maska kafli bliskich ({ tex, ref, size }): daleki teren nie rysuje się tam, gdzie leży kafel z14. */
function terrainMaterial(coverTex, U, atmo, clouds, plane, worldShadow, hole = null, lite = false) {
	const m = new MeshBasicNodeMaterial();
	const vFlat = varying(vec3(0), 'vWTerFlat');
	const vN = varying(vec3(0, 1, 0), 'vWTerN');
	const vUv = varying(vec2(0), 'vWTerUv');
	const vLayer = varying(float(0), 'vWTerLayer');
	m.positionNode = Fn(() => {
		vFlat.assign(positionLocal);
		vN.assign(attribute('normal', 'vec3'));
		vUv.assign(attribute('uv', 'vec2'));
		vLayer.assign(attribute('aLayer', 'float'));
		return onGround(positionLocal, U.cam);
	})();
	let shore = float(40);
	let occ = float(0); // przyciemnienie przy budynkach i skraju lasu 0..1 (z rastra pokrycia)
	const src = {
		U, isRing: false, hasOsm: true, lite,
		// pokrycie: cztery sąsiednie piksele rastra kafla dwuliniowo, z poszarpanym szumem brzegiem (jak w regionach)
		cover(xz) {
			const jitter = vec2(valueNoise(xz.div(38)), valueNoise(xz.div(38).add(71.3))).sub(0.5).mul(1.4)
				.add(vec2(valueNoise(xz.div(9)), valueNoise(xz.div(9).add(13.1))).sub(0.5).mul(0.5));
			const pc = vUv.mul(COVER_RES).sub(0.5).add(jitter);
			const i0 = floor(pc), f = fract(pc);
			const layer = int(vLayer.add(0.5));
			const load0 = (ij) => floor(textureLoad(coverTex, ivec2(clamp(ij, vec2(0), vec2(COVER_RES - 1))), 0).depth(layer).r.mul(255).add(0.5)).mod(16);
			const load = (o) => load0(i0.add(o));
			const c00 = load(vec2(0, 0)), c10 = load(vec2(1, 0)), c01 = load(vec2(0, 1)), c11 = load(vec2(1, 1));
			const k00 = float(1).sub(f.x).mul(float(1).sub(f.y)), k10 = f.x.mul(float(1).sub(f.y)), k01 = float(1).sub(f.x).mul(f.y), k11 = f.x.mul(f.y);
			const wA = oneHotA(c00).mul(k00).add(oneHotA(c10).mul(k10)).add(oneHotA(c01).mul(k01)).add(oneHotA(c11).mul(k11)).toVar();
			const wB = oneHotB(c00).mul(k00).add(oneHotB(c10).mul(k10)).add(oneHotB(c01).mul(k01)).add(oneHotB(c11).mul(k11)).toVar();
			// las: gęstość dwuliniowo bez szumu położenia i brzeg jak w forestCover – ta sama, z której stoją drzewa 3D
			// (src/world/window.js), więc korony z daleka i drzewa z bliska się pokrywają
			const q = vUv.mul(COVER_RES).sub(0.5);
			const q0 = floor(q), g = fract(q);
			// jeden odczyt na piksel: klasa (R) do gęstości lasu i odległość od brzegu (G, metry) do głębi wody i piany
			const tex = (o) => textureLoad(coverTex, ivec2(clamp(q0.add(o), vec2(0), vec2(COVER_RES - 1))), 0).depth(layer).rg.mul(255);
			const t00 = tex(vec2(0, 0)), t10 = tex(vec2(1, 0)), t01 = tex(vec2(0, 1)), t11 = tex(vec2(1, 1));
			const cls = (t) => floor(t.x.add(0.5)).mod(16);
			const isF = (t) => step(abs(cls(t).sub(1)), 0.5);
			const dens = mix(mix(isF(t00), isF(t10), g.x), mix(isF(t01), isF(t11), g.x), g.y);
			shore = mix(mix(t00.y, t10.y, g.x), mix(t01.y, t11.y, g.x), g.y);
			const oc = (t) => floor(floor(t.x.add(0.5)).div(16)).div(15);
			occ = mix(mix(oc(t00), oc(t10), g.x), mix(oc(t01), oc(t11), g.x), g.y);
			const edgeNoise = valueNoise(xz.div(23)).mul(0.6).add(valueNoise(xz.div(6.5)).mul(0.4)).sub(0.5).mul(0.42);
			const fw = smoothstep(0.42, 0.58, dens.add(edgeNoise));
			const others = max(1e-4, wA.x.add(wA.z).add(wA.w).add(dot(wB, vec4(1))));
			const rest = float(1).sub(fw).div(others);
			wA.assign(vec4(wA.x.mul(rest), fw, wA.z.mul(rest), wA.w.mul(rest)));
			wB.assign(wB.mul(rest));
			return { wA, wB };
		},
		shoreM: () => shore,
		occlusion: () => occ,
		// cienie rzeźby i ścian lasu, przyciemnienie zagłębień – z okien rzeźby wokół kamery
		// shadeGround podaje xz z przesunięciem worldOffset (wzory stałe względem Ziemi), a okna rzeźby są w układzie gry
		rayShadow: U.relief ? (xz, h, wForest, footprint) => reliefShadow(U.relief, atmo, U.treeH, xz.sub(worldOffset), h, wForest, footprint, lite) : null,
		cavity: U.relief ? (xz, h) => reliefCavity(U.relief, xz.sub(worldOffset), h) : null,
		// odbicie brzegu (las, zbocza) w jeziorach i rzekach – daleki teren bez (z daleka niewidoczne)
		reflectOcc: U.relief && !lite ? (xz, h, rh, tanR) => reliefReflect(U.relief, U.treeH, xz.sub(worldOffset), h, rh, tanR) : null,
		// wysokość i spadki z siatki kafla (normalne policzone w wątku – wspólne na brzegach kafli)
		ground() {
			const N = normalize(vN);
			const ny = max(N.y, 0.05);
			return { h: vFlat.y, hx: N.x.negate().div(ny), hz: N.z.negate().div(ny) };
		},
	};
	const shade = shadeGround(vFlat, src, atmo, clouds, plane, worldShadow);
	if (hole) {
		// kafel z14 pod punktem: siatka kafli w układzie świata (Mercator – równe kwadraty), maska 64² adresowana w kółko
		m.colorNode = Fn(() => {
			const t = floor(vFlat.xz.sub(hole.ref).div(hole.size)).add(0.5).div(64);
			If(hole.tex.sample(t).level(0).r.greaterThan(0.5), () => { Discard(); });
			return shade;
		})();
	} else m.colorNode = shade;
	m.fog = false;
	return m;
}

/** Daleka „podłoga”: duży kwadrat pod wczytanym obszarem (pod najniższym wczytanym terenem) – bez pustki za brzegiem. */
function farFloor(U, atmo, clouds, plane) {
	const g = new PlaneGeometry(400000, 400000, 96, 96);
	g.rotateX(-Math.PI / 2);
	const m = new MeshBasicNodeMaterial();
	const base = uniform(0);
	const vFlat = varying(vec3(0), 'vWFloorFlat');
	m.positionNode = Fn(() => {
		const p = positionLocal.add(vec3(U.cam.x, base, U.cam.y));
		vFlat.assign(p);
		return onGround(p, U.cam);
	})();
	const src = {
		U, isRing: true, hasOsm: true,
		cover: (xz) => ({ wA: outsideA(xz).toVar(), wB: vec4(0).toVar() }),
		ground: () => ({ h: base, hx: float(0), hz: float(0) }),
	};
	m.colorNode = shadeGround(vFlat, src, atmo, clouds, plane, null);
	m.fog = false;
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	mesh.renderOrder = 2; // po terenie – zasłonięte piksele odrzuca test głębi przed cieniowaniem
	return { mesh, base };
}

export class ChunkView {
	constructor(scene, atmo, clouds, plane, worldShadow) {
		this.scene = scene;
		this.atmo = atmo; this.clouds = clouds; this.plane = plane; this.worldShadow = worldShadow;
		this.camXZ = uniform(new Vector2());
		this.U = { cam: this.camXZ, time: uniform(0), treeH: uniform(17), treesFar: uniform(0), relief: RELIEF };
		this.coverTex = new DataArrayTexture(new Uint8Array(COVER_RES * COVER_RES * SLOTS * 2), COVER_RES, COVER_RES, SLOTS);
		this.coverTex.format = RGFormat;
		this.coverTex.type = UnsignedByteType;
		this.coverTex.minFilter = this.coverTex.magFilter = NearestFilter;
		this.coverTex.generateMipmaps = false;
		this.coverTex.needsUpdate = true;
		this.free = Array.from({ length: SLOTS }, (_, i) => SLOTS - 1 - i);
		this.terrainMat = terrainMaterial(this.coverTex, this.U, atmo, clouds, plane, worldShadow);
		this.roadMat = makeRoadMaterial(null, atmo, clouds, plane, worldShadow);
		this.buildingShared = null; // z pierwszego kafla z budynkami
		this.shared = { rivers: null, rails: null, bridges: null, details: {} }; // wspólne materiały – z pierwszego kafla, który ich użył
		this.floor = farFloor(this.U, atmo, clouds, plane);
		scene.add(this.floor.mesh);
		this.group = new Group();
		scene.add(this.group);
		this.objectQueue = [];
		this.inflight = 0; // zlecenia obiektów w wątkach
		this.ready = []; // [kafel, dane] – do zbudowania siatek (po jednym na klatkę)
		this.streamer = null; // ustawia createWorld
		this.loaded = new Set(); // kafle z terenem w scenie
		this.center = { x: 0, z: 0 };
		this.lodAt = 0;
		this.stats = { chunks: 0, objectChunks: 0, buildMs: 0 };
	}

	/** Nowy kafel: teren od razu (geometria gotowa z wątku), pokrycie do wolnej warstwy tekstury. */
	add(ch) {
		const layer = this.free.pop();
		if (layer === undefined) { console.warn('Brak wolnych warstw pokrycia'); return; }
		ch.layer = layer;
		packCover(this.coverTex, ch, layer);
		ch.stride = this.strideFor(ch, 1);
		ch.terrain = new Mesh(terrainGeometry(ch, layer, 40, ch.stride), this.terrainMat);
		ch.terrain.geometry.boundingSphere = chunkSphere(ch);
		this.loaded.add(ch);
		this.group.add(ch.terrain);
		this.stats.chunks++;
	}

	remove(ch) {
		this.loaded.delete(ch);
		this.objects(ch, false);
		if (ch.terrain) { this.group.remove(ch.terrain); ch.terrain.geometry.dispose(); ch.terrain = null; }
		if (ch.layer !== undefined) { this.free.push(ch.layer); ch.layer = undefined; }
		this.stats.chunks--;
	}

	/**
	 * Obiekty kafla (drogi, budynki, rzeki, tory, mosty, aleje, linie energetyczne): geometria budynków i dróg liczona
	 * w wątku kafli, tu – siatki z tablic (po jednym kaflu na klatkę); zdejmowanie od razu.
	 */
	objects(ch, on) {
		ch.wantObjs = on;
		if (on) { if (!ch.objs && !this.objectQueue.includes(ch)) this.objectQueue.push(ch); return; }
		const qi = this.objectQueue.indexOf(ch);
		if (qi >= 0) this.objectQueue.splice(qi, 1);
		if (!ch.objs) return;
		for (const o of ch.objs.list) { o.parent?.remove(o); o.geometry?.dispose(); }
		ch.objs = null;
		this.stats.objectChunks--;
	}

	/**
	 * Gęstość siatki kafla: gęste kafle (GUGiK, 129²) bliżej niż ~5 km – pełne (tam stoją obiekty, ich wysokości
	 * liczone są na pełnej siatce), dalej – co drugi wierzchołek; histereza 5–6 km.
	 */
	strideFor(ch, cur) {
		if ((ch.n ?? GRID) < 129) return 1;
		const d = Math.hypot(ch.frame.x0 + ch.frame.w / 2 - this.center.x, ch.frame.z0 + ch.frame.h / 2 - this.center.z);
		return d > 6000 ? 2 : d < 5000 ? 1 : cur;
	}

	buildObjects(ch, d) {
		const t0 = performance.now();
		const list = [];
		const hAt = (x, z) => gridHeightAt(ch, x, z);
		// dane policzone przy innym początku układu (przesunięcie w trakcie) – przesunięcie tablic
		const o = d.origin, cur = this.streamer.origin;
		if (o.lon !== cur.lon || o.lat !== cur.lat) {
			const p = lonLatToLocal(cur.lon, cur.lat, o);
			const sh = (a) => { for (let i = 0; i < a.length; i += 3) { a[i] -= p.x; a[i + 2] -= p.z; } };
			sh(d.roads.pos);
			for (const t of d.buildings.tiles) { sh(t.pos); t.sphere[0] -= p.x; t.sphere[2] -= p.z; }
			for (const a of [d.rivers.mesh.pos, d.rails.mesh.pos, d.bridges.pos, d.details.pylons.pos, d.details.wires]) sh(a);
			const m = d.details.trees;
			for (let i = 0; i < m.length; i += 16) { m[i + 12] -= p.x; m[i + 14] -= p.z; }
			for (const b of d.buildings.beacons) { b[0] -= p.x; b[2] -= p.z; }
		}
		// drogi: jedna siatka na kafel (z wątku)
		const r = d.roads;
		if (r.count) {
			const geo = new BufferGeometry();
			geo.setAttribute('position', new BufferAttribute(r.pos, 3));
			geo.setAttribute('aSide', new BufferAttribute(r.side, 1));
			geo.setAttribute('aDist', new BufferAttribute(r.dist, 1));
			geo.setAttribute('aWidth', new BufferAttribute(r.width, 1));
			geo.setAttribute('aSurf', new BufferAttribute(r.surf, 1));
			geo.setAttribute('aCls', new BufferAttribute(r.cls, 1));
			geo.setAttribute('aWay', new BufferAttribute(r.way, 1));
			geo.setIndex(new BufferAttribute(r.idx, 1));
			const m = new Mesh(geo, this.roadMat);
			m.renderOrder = 10;
			m.frustumCulled = false;
			list.push(m);
		}
		// rzeki i strugi, tory, mosty i perony, aleje i linie energetyczne – geometria z wątku, siatki modułów regionów
		const A = [this.atmo, this.clouds, this.plane, this.worldShadow];
		const rv = riversFromArrays(d.rivers, ...A, this.shared.rivers);
		if (rv.material) this.shared.rivers ??= { material: rv.material };
		const rl = railsFromArrays(d.rails, ...A, this.shared.rails);
		if (rl.material) this.shared.rails ??= { material: rl.material };
		const br = bridgesFromArrays(d.bridges, ...A, this.shared.bridges);
		if (br.material) this.shared.bridges ??= { material: br.material, shadowMaterial: br.shadowMaterial };
		list.push(...rv.objects, ...rl.objects, ...br.objects, ...br.shadowCasters);
		const det = detailsFromArrays(d.details, ...A, this.shared.details);
		// zasięg widoczności szczegółów (drzewa przydrożne i przewody z daleka są poniżej piksela; słupy widać dalej)
		for (const o of [...det.objects, ...det.shadowCasters]) o.userData.detailRange = o.isInstancedMesh ? 2200 : o.isLineSegments ? 2500 : 6000;
		list.push(...det.objects, ...det.shadowCasters);
		// budynki: geometria z wątku, materiały wspólne dla wszystkich kafli
		if (d.buildings.tiles.length) {
			const b = buildingMeshes(d.buildings.tiles, d.buildings, this.atmo, this.clouds, this.plane, this.worldShadow, this.buildingShared);
			if (!this.buildingShared) this.buildingShared = { material: b.material, shadowMaterial: b.shadowMaterial };
			list.push(...b.objects, ...b.shadowCasters);
		}
		// odrzucanie poza kadrem (i poza obszarem mapy cieni) – sfera kafla dla wszystkiego, co jej nie ma
		const sphere = chunkSphere(ch);
		for (const o of list) {
			if (o.isInstancedMesh) o.boundingSphere = sphere.clone();
			else if (!o.geometry.boundingSphere) o.geometry.boundingSphere = sphere.clone();
			o.frustumCulled = true;
		}
		for (const o of list) this.scene.add(o);
		ch.objs = { list };
		this.stats.objectChunks++;
		this.stats.buildMs = performance.now() - t0;
	}

	/** Co klatkę: krzywizna względem kamery, budowa obiektów z kolejki (najbliższy kafel), podłoga. */
	update(camera, center, time = 0) {
		this.center = { x: center.x, z: center.z };
		// poziom szczegółów siatek terenu – dwa razy na sekundę
		if (performance.now() - this.lodAt > 500) {
			this.lodAt = performance.now();
			const cx = camera.position.x, cz = camera.position.z;
			for (const ch of this.loaded) {
				if (ch.objs) {
					const d = Math.max(0, Math.hypot(ch.frame.x0 + ch.frame.w / 2 - cx, ch.frame.z0 + ch.frame.h / 2 - cz) - ch.frame.w * 0.7);
					for (const o of ch.objs.list) if (o.userData.detailRange) o.visible = d < o.userData.detailRange;
				}
				const s2 = this.strideFor(ch, ch.stride);
				if (s2 === ch.stride || !ch.terrain) continue;
				ch.stride = s2;
				ch.terrain.geometry.dispose();
				ch.terrain.geometry = terrainGeometry(ch, ch.layer, 40, s2);
				ch.terrain.geometry.boundingSphere = chunkSphere(ch);
			}
		}
		this.camXZ.value.set(camera.position.x, camera.position.z);
		this.U.time.value = time;
		this.roadMat.userData.camXZ.value.set(camera.position.x, camera.position.z);
		const cx = camera.position.x, cz = camera.position.z;
		if (this.buildingShared) this.buildingShared.material.userData.camXZ.value.set(cx, cz);
		const sh = this.shared;
		for (const m of [sh.rivers?.material, sh.rails?.material, sh.bridges?.material, sh.bridges?.shadowMaterial, ...Object.values(sh.details)]) m?.userData.camXZ?.value.set(cx, cz);
		if (sh.rivers) sh.rivers.material.userData.time.value = performance.now() / 1000;
		// obiekty: zlecenia do wątków (najbliższe najpierw, do 3 naraz), siatki z gotowych – jeden kafel na klatkę
		if (this.objectQueue.length && this.inflight < 3 && this.streamer) {
			const dist = (c) => Math.hypot(c.frame.x0 + c.frame.w / 2 - center.x, c.frame.z0 + c.frame.h / 2 - center.z);
			this.objectQueue.sort((a, b) => dist(a) - dist(b));
			while (this.objectQueue.length && this.inflight < 3) {
				const ch = this.objectQueue.shift();
				if (!ch.terrain) continue;
				this.inflight++;
				this.streamer.requestObjects(ch).then((d) => {
					this.inflight--;
					if (d && ch.wantObjs && !ch.objs && ch.terrain) this.ready.push([ch, d]);
					else if (!d && ch.wantObjs && ch.terrain && !ch.objs) this.objectQueue.push(ch); // błąd – jeszcze raz
				});
			}
		}
		if (this.ready.length) {
			const [ch, d] = this.ready.shift();
			if (ch.wantObjs && !ch.objs && ch.terrain) this.buildObjects(ch, d);
		}
	}

	/** Nowy początek układu w (dx, dz): siatki wczytanych kafli przesunięte w miejscu (raz każda geometria). */
	shift(chunks, dx, dz) {
		const done = new Set();
		// tylko pozycje (normalne bez zmian), granice przesunięte zamiast liczenia od nowa
		const move = (g) => {
			if (!g || done.has(g)) return;
			done.add(g);
			const pos = g.attributes.position, a = pos.array, n = pos.count * 3;
			for (let i = 0; i < n; i += 3) { a[i] -= dx; a[i + 2] -= dz; }
			pos.needsUpdate = true;
			if (g.boundingSphere) { g.boundingSphere.center.x -= dx; g.boundingSphere.center.z -= dz; }
			if (g.boundingBox) { g.boundingBox.min.x -= dx; g.boundingBox.max.x -= dx; g.boundingBox.min.z -= dz; g.boundingBox.max.z -= dz; }
		};
		for (const ch of chunks) {
			move(ch.terrain?.geometry);
			for (const o of ch.objs?.list ?? []) {
				// drzewa przydrożne: położenie w macierzach instancji (geometria to kształt drzewa)
				if (o.isInstancedMesh) {
					if (o.boundingSphere) { o.boundingSphere.center.x -= dx; o.boundingSphere.center.z -= dz; }
					const a = o.instanceMatrix.array;
					for (let i = 0; i < o.count; i++) { a[i * 16 + 12] -= dx; a[i * 16 + 14] -= dz; }
					o.instanceMatrix.needsUpdate = true;
				} else move(o.geometry);
			}
		}
	}

	/** Wysokość podłogi: poniżej najniższego wczytanego terenu. */
	setFloor(h) { this.floor.base.value = h; }
}

/** Maska wczytanych kafli z14 (64² adresowane w kółko po numerze kafla) – daleki teren ich nie zasłania. */
export class NearMask {
	constructor() {
		this.data = new Uint8Array(64 * 64);
		this.tex = new DataTexture(this.data, 64, 64, RedFormat, UnsignedByteType);
		this.tex.minFilter = this.tex.magFilter = NearestFilter;
		this.tex.wrapS = this.tex.wrapT = RepeatWrapping;
		this.tex.needsUpdate = true;
		this.node = texture(this.tex);
		this.ref = uniform(new Vector2());
		this.size = uniform(new Vector2(1, 1));
		this.hasRef = false;
	}

	set(ch, on) {
		const f = ch.frame, mx = ((ch.x % 64) + 64) % 64, my = ((ch.y % 64) + 64) % 64;
		if (!this.hasRef) {
			// róg kafla o numerze ≡ 0 (mod 64) w tym samym rzędzie i kolumnie – piksel maski = numer kafla mod 64
			this.ref.value.set(f.x0 - mx * f.w, f.z0 - my * f.h);
			this.size.value.set(f.w, f.h);
			this.hasRef = true;
		}
		this.data[my * 64 + mx] = on ? 255 : 0;
		this.tex.needsUpdate = true;
	}

	shift(dx, dz) { this.ref.value.x -= dx; this.ref.value.y -= dz; }

	/** Dla materiału terenu: { tex, ref, size }. */
	get hole() { return { tex: this.node, ref: this.ref, size: this.size }; }
}

/**
 * Daleki teren: kafle z11 (~12,5 km) za zasięgiem kafli z14 – siatka 65² z rzeźbą Terrarium z11, pokrycie z mapy
 * z11, ten sam shader gruntu (z daleka wzory pól i lasów uśredniają się do barw z bliska). Pod wczytanymi kaflami z14
 * odrzucany (maska), szczeliny na styku zasłaniają fartuchy kafli bliskich.
 */
export class FarView {
	constructor(scene, U, atmo, clouds, plane, mask) {
		this.slots = 128;
		this.coverTex = new DataArrayTexture(new Uint8Array(COVER_RES * COVER_RES * this.slots * 2), COVER_RES, COVER_RES, this.slots);
		this.coverTex.format = RGFormat;
		this.coverTex.type = UnsignedByteType;
		this.coverTex.minFilter = this.coverTex.magFilter = NearestFilter;
		this.coverTex.generateMipmaps = false;
		this.coverTex.needsUpdate = true;
		this.free = Array.from({ length: this.slots }, (_, i) => this.slots - 1 - i);
		this.material = terrainMaterial(this.coverTex, U, atmo, clouds, plane, null, mask.hole, true); // lżejsze wzory pól
		this.group = new Group();
		scene.add(this.group);
		this.stats = { tiles: 0 };
	}

	add(ch) {
		const layer = this.free.pop();
		if (layer === undefined) return;
		ch.layer = layer;
		packCover(this.coverTex, ch, layer);
		ch.terrain = new Mesh(terrainGeometry(ch, layer, 60), this.material);
		// zapas na krzywiznę: do ~60 km od kamery opadanie do ~300 m
		ch.terrain.geometry.boundingSphere = chunkSphere(ch, 320);
		ch.terrain.renderOrder = 1; // po kaflach z14 – piksele pod nimi odpadają na teście głębi przed kosztownym cieniowaniem
		this.group.add(ch.terrain);
		this.stats.tiles++;
	}

	remove(ch) {
		if (ch.terrain) { this.group.remove(ch.terrain); ch.terrain.geometry.dispose(); ch.terrain = null; }
		if (ch.layer !== undefined) { this.free.push(ch.layer); ch.layer = undefined; }
		this.stats.tiles--;
	}

	shift(chunks, dx, dz) {
		for (const ch of chunks) {
			const pos = ch.terrain?.geometry.attributes.position;
			if (!pos) continue;
			const a = pos.array;
			for (let i = 0; i < a.length; i += 3) { a[i] -= dx; a[i + 2] -= dz; }
			pos.needsUpdate = true;
			const bs = ch.terrain.geometry.boundingSphere;
			if (bs) { bs.center.x -= dx; bs.center.z -= dz; }
		}
	}
}
