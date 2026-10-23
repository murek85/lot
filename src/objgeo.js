// Geometria obiektów wzdłuż linii i drobnych budowli w tablicach – bez Three.js (poza matematyką macierzy z rdzenia
// three.core.js, który niczego nie importuje): rzeki i strugi, tory, mosty i perony, aleje (macierze instancji drzew),
// linie energetyczne (słupy, przewody). Liczona w wątku głównym (regiony – src/rivers.js, src/rails.js,
// src/bridges.js, src/details.js) albo w wątkach kafli otwartego świata (src/world/chunkworker.js); siatki z tablic
// tworzą te same moduły (…FromArrays).
import { Matrix4, Quaternion, Vector3, Euler } from '../vendor/three/three.core.js';
import { densify, ribbon } from './gfx/ribbon.js';
import { GeoArrays } from './gfx/geobuilder.js';
import { rng } from './clouds/noise3d.js';

const F32 = (a) => new Float32Array(a);
const toPts = (c) => { const p = []; for (let i = 0; i < c.length; i += 2) p.push(c[i] / 10, c[i + 1] / 10); return p; };

// --- rzeki i strugi ---
const MIN_DRAWN = 2; // rowy węższe niż 2 m tylko w masce lasu

/**
 * Wstęgi wody wzdłuż cieków (osm.waterways – [szer.×10, linia dm]) i linie koryt z pasem nadbrzeżnym (maska lasu).
 * heightAt(x, z) – wysokość terenu; half – pomijanie poza kwadratem ±half. → { mesh: { pos, side, width, idx, count }, lines }.
 */
export function riverArrays(waterways, heightAt, half = Infinity) {
	const g = { pos: [], side: [], width: [], dist: [], slope: [], idx: [], count: 0 };
	const lines = [];
	for (const [w10, c] of waterways ?? []) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) {
			const x = c[i] / 10, z = c[i + 1] / 10;
			if (Math.abs(x) < half && Math.abs(z) < half) pts.push(x, z);
			else if (pts.length >= 4) break;
		}
		if (pts.length < 4) continue;
		pts = densify(pts, 10);
		const width = Math.min(60, w10 / 10);
		// pas nadbrzeżny bez drzew: łęgi przy rzekach szersze niż przy strugach
		lines.push({ pts, half: width / 2 + (width >= 8 ? 7 : width >= 2 ? 3 : 1) });
		if (width < MIN_DRAWN) continue;
		// lustro wody: wysokość terenu wygładzona wzdłuż koryta (DEM w wąskiej dolinie jest poszarpany)
		const n = pts.length / 2, raw = [];
		for (let i = 0; i < n; i++) raw.push(heightAt(pts[i * 2], pts[i * 2 + 1]));
		let i = 0;
		const hAt = () => {
			let s = 0, k = 0;
			for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { s += raw[j]; k++; }
			const own = raw[i++];
			return Math.min(own, s / k) + 0.12;
		};
		// trochę szerzej niż koryto – brzeg rozmywa przezroczystość
		const rb = ribbon(pts, width / 2 + 1, hAt, g.count);
		// koryto w poprzek zbocza (linia z OSM obok doliny w modelu terenu): pozioma wstęga wisiała nad niższym stokiem
		// i chowała się pod wyższym – wąskie cieki (koryto węższe niż oczko siatki terenu) leżą na terenie po obu
		// brzegach, szerokie rzeki – brzeg nad niższym terenem opuszczony do niego (pod skarpami brzeg się chowa)
		for (let k = 0; k < rb.pos.length; k += 3) {
			const t = heightAt(rb.pos[k], rb.pos[k + 2]) + 0.12;
			rb.pos[k + 1] = width < 12 ? t : Math.min(rb.pos[k + 1], t);
		}
		for (const v of rb.pos) g.pos.push(v);
		for (const v of rb.side) g.side.push(v);
		for (const v of rb.idx) g.idx.push(v);
		for (let k = 0; k < rb.side.length; k++) { g.width.push(width + 2); g.dist.push(rb.dist[k]); }
		// spadek koryta (nurt, bystrza): różnica wysokości terenu ±5 punktów (±50 m) wzdłuż biegu, bez znaku – kierunek
		// rysowania nie zawsze jest z nurtem; OSM rysuje cieki z nurtem, więc odległość rośnie w dół rzeki
		for (let k = 0; k < n; k++) {
			const a = Math.max(0, k - 5), b = Math.min(n - 1, k + 5);
			const s = b > a ? Math.abs(raw[a] - raw[b]) / ((b - a) * 10) : 0;
			g.slope.push(s, s);
		}
		g.count += rb.side.length;
	}
	return { mesh: { pos: F32(g.pos), side: F32(g.side), width: F32(g.width), dist: F32(g.dist), slope: F32(g.slope), idx: new Uint32Array(g.idx), count: g.count }, lines };
}

// --- tory ---
export const BED = 4.4; // szerokość nasypu z tłuczniem (m)

/**
 * Wstęgi torów (osm.rails – [rodzaj, bocznica, most, warstwa, linia dm]); mosty – prosta między przyczółkami.
 * → { mesh: { pos, side, dist, kind, idx, count }, lines }.
 */
export function railArrays(rails, heightAt, half = Infinity) {
	const g = { pos: [], side: [], dist: [], kind: [], idx: [], count: 0 };
	const lines = [];
	const clip = (c) => {
		const pts = [];
		for (let i = 0; i < c.length; i += 2) {
			const x = c[i] / 10, z = c[i + 1] / 10;
			if (Math.abs(x) < half && Math.abs(z) < half) pts.push(x, z);
		}
		return pts.length >= 4 ? densify(pts, 10) : null;
	};
	for (const [kind, , bridge, , c] of rails ?? []) {
		const pts = clip(c);
		if (!pts) continue;
		lines.push({ pts, half: BED / 2, bridge });
		let hAt = (x, z) => heightAt(x, z) + (kind === 3 ? 0.15 : 0.35);
		if (bridge) {
			const n = pts.length / 2;
			const h0 = heightAt(pts[0], pts[1]), h1 = heightAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
			let i = 0;
			hAt = () => h0 + (h1 - h0) * (n > 1 ? i++ / (n - 1) : 0) + 0.9;
		}
		const rb = ribbon(pts, BED / 2, hAt, g.count);
		for (const v of rb.pos) g.pos.push(v);
		for (let i = 0; i < rb.side.length; i++) { g.side.push(rb.side[i]); g.dist.push(rb.dist[i]); g.kind.push(kind); }
		for (const v of rb.idx) g.idx.push(v);
		g.count += rb.side.length;
	}
	return { mesh: { pos: F32(g.pos), side: F32(g.side), dist: F32(g.dist), kind: F32(g.kind), idx: new Uint32Array(g.idx), count: g.count }, lines };
}

// --- mosty i perony ---
const CONCRETE = [0.42, 0.41, 0.39], STEEL = [0.2, 0.22, 0.24], RUST = [0.25, 0.12, 0.07], PLATFORM = [0.36, 0.35, 0.33];

/**
 * Mosty i wiadukty (drogi i tory z bridge=yes): pomost z bocznymi ścianami, bariery, filary co ~28 m; perony.
 * → tablice zbieracza { pos, nrm, col, idx, count } i liczba mostów (bridges).
 */
export function bridgeArrays(osm, heightAt, half = Infinity) {
	const b = new GeoArrays();
	const decks = [];
	for (const [, w10, , bridge, , c] of osm.roads) if (bridge) decks.push({ c, width: w10 / 10 + 1.2, lift: 0.6, rail: false });
	for (const [kind, , bridge, , c] of osm.rails) if (bridge) decks.push({ c, width: 5, lift: 0.9, rail: true, old: kind >= 2 });
	let bridges = 0;
	for (const d of decks) {
		let pts = [];
		for (let i = 0; i < d.c.length; i += 2) pts.push(d.c[i] / 10, d.c[i + 1] / 10);
		if (pts.some((v) => Math.abs(v) > half)) continue;
		pts = densify(pts, 6);
		const n = pts.length / 2;
		if (n < 2) continue;
		const h0 = heightAt(pts[0], pts[1]), h1 = heightAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
		const deckY = (i) => h0 + (h1 - h0) * (i / (n - 1)) + d.lift - 0.05;
		let since = 0;
		for (let i = 1; i < n; i++) {
			const x0 = pts[i * 2 - 2], z0 = pts[i * 2 - 1], x1 = pts[i * 2], z1 = pts[i * 2 + 1];
			const y0 = deckY(i - 1), y1 = deckY(i);
			const y = (y0 + y1) / 2;
			// pomost (bez góry – jezdnię rysuje wstęga drogi/toru) i bariery po bokach
			const len = Math.hypot(x1 - x0, z1 - z0) || 1, tx = (x1 - x0) / len, tz = (z1 - z0) / len;
			const ox = -tz * (d.width / 2), oz = tx * (d.width / 2);
			for (const s of [-1, 1]) {
				const ax = x0 + ox * s, az = z0 + oz * s, bx = x1 + ox * s, bz = z1 + oz * s;
				const nrm = [-tz * s, 0, tx * s];
				b.quad([ax, y - 1.1, az], [bx, y - 1.1, bz], [bx, y + 0.05, bz], [ax, y + 0.05, az], nrm, CONCRETE);
				b.beam(ax - ox * s * 0.03, az - oz * s * 0.03, bx - ox * s * 0.03, bz - oz * s * 0.03, 0.08, y + 0.05, y + (d.rail ? 1.6 : 1.05), d.rail ? (d.old ? RUST : STEEL) : STEEL, false);
			}
			// spód pomostu
			b.quad([x0 + ox, y - 1.1, z0 + oz], [x1 + ox, y - 1.1, z1 + oz], [x1 - ox, y - 1.1, z1 - oz], [x0 - ox, y - 1.1, z0 - oz], [0, -1, 0], CONCRETE);
			// filary
			since += len;
			if (since > 28 && i < n - 1) {
				since = 0;
				const g = heightAt(x1, z1);
				if (y1 - 1.1 - g > 2) b.beam(x1 - tx * 0.8, z1 - tz * 0.8, x1 + tx * 0.8, z1 + tz * 0.8, d.width * 0.7, g - 1, y1 - 1.1, CONCRETE);
			}
		}
		bridges++;
	}
	// perony: podniesione płyty (0,76 m) wzdłuż linii albo z obrysu (jako pas wzdłuż najdłuższego boku)
	for (const [c] of osm.platforms) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
		if (pts.some((v) => Math.abs(v) > half) || pts.length < 4) continue;
		const closed = pts.length >= 8 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
		if (closed) {
			// obrys peronu: odcinek środkowy wzdłuż najdłuższej krawędzi
			let best = 0, bi = 0;
			for (let i = 2; i < pts.length; i += 2) {
				const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
				if (l > best) { best = l; bi = i; }
			}
			let cx = 0, cz = 0;
			const m = pts.length / 2 - 1;
			for (let i = 0; i < m; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
			cx /= m; cz /= m;
			if (!(best > 1) || !(m > 0)) continue; // zdegenerowany obrys (punkty w jednym miejscu) – bez peronu
			const tx = (pts[bi] - pts[bi - 2]) / best, tz = (pts[bi + 1] - pts[bi - 1]) / best;
			pts = [cx - tx * best / 2, cz - tz * best / 2, cx + tx * best / 2, cz + tz * best / 2];
		}
		for (let i = 2; i < pts.length; i += 2) {
			const g = Math.min(heightAt(pts[i - 2], pts[i - 1]), heightAt(pts[i], pts[i + 1]));
			b.beam(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], 4, g - 0.5, g + 0.76, PLATFORM);
		}
	}
	return { ...b.arrays(), bridges };
}

// --- aleje i linie energetyczne ---

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
 * Aleje (szpalery z danych i drzewa wzdłuż co trzeciej drogi lokalnej) i linie energetyczne. coverAt(x, z) → klasa
 * pokrycia albo −1, cls – klasy (COVER). → { trees: Float32Array macierzy instancji (16 na drzewo), treeCount,
 * pylons: tablice zbieracza, wires: Float32Array odcinków (x, y, z × 2) }.
 */
export function detailArrays(osm, heightAt, coverAt, cls, half = Infinity, seed = 4242) {
	const r = rng(seed);
	const inside = (pts) => pts.every((v) => Math.abs(v) < half);
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
	const mats = new Float32Array(trees.length * 16);
	const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), s = new Vector3();
	trees.forEach(([x, z], i) => {
		const H = 13 + r() * 9;
		e.set((r() - 0.5) * 0.06, r() * Math.PI * 2, (r() - 0.5) * 0.06);
		q.setFromEuler(e);
		m4.compose(v.set(x, heightAt(x, z) - 0.4, z), q, s.set(H * (0.9 + r() * 0.3), H, H * (0.9 + r() * 0.3)));
		m4.toArray(mats, i * 16);
	});

	// linie energetyczne: słupy w wierzchołkach linii, przewody ze zwisem
	const pylons = new GeoArrays();
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
			const g = heightAt(x, z);
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
			for (const sd of minor ? [-0.7, 0.7] : [-5, 0, 5]) {
				const span = Math.hypot(B[0] - A[0], B[2] - A[2]);
				const sag = span * span * (minor ? 0.00025 : 0.00018);
				let prev = null;
				for (let k = 0; k <= 10; k++) {
					const t = k / 10;
					const px = A[0] + A[3] * sd + (B[0] + B[3] * sd - A[0] - A[3] * sd) * t;
					const pz = A[2] + A[4] * sd + (B[2] + B[4] * sd - A[2] - A[4] * sd) * t;
					const py = A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t);
					if (prev) wires.push(...prev, px, py, pz);
					prev = [px, py, pz];
				}
			}
		}
	}
	return { trees: mats, treeCount: trees.length, pylons: pylons.arrays(), wires: F32(wires) };
}
