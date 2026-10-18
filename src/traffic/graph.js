// Sieć dróg dla ruchu: z odcinków dróg regionu (osm.roads) graf – węzły na końcach dróg i w punktach wspólnych dla
// kilku dróg (skrzyżowania w środku drogi z OSM i z kafli wektorowych mają identyczne współrzędne), krawędzie –
// fragmenty dróg między węzłami. Końce dróg pocięte na granicach kafli generatora łączą się w siatce 0,5 m.
// Sama matematyka (bez Three.js) – testowana w Node.

/** Klasy dróg z ruchem samochodowym (0 autostrada … 5 dojazdowa); dukty i ścieżki – bez. */
export const CAR_MAX_CLASS = 5;
/** Prędkość (m/s) i gęstość ruchu (pojazdów na km na kierunek przy ruchu „normalnym”) dla klasy drogi. */
export const SPEED = [33, 20, 17, 14, 11, 7];
export const DENSITY = [16, 9, 6.5, 4.5, 1.6, 0.5];

const key = (x10, z10) => `${Math.round(x10 / 5)},${Math.round(z10 / 5)}`;

/**
 * roads: [[cls, w10, surface, bridge, layer, c (decymetry), oneway?], …]. Zwraca { nodes, edges, ways }:
 * node: { id, x, z, out: [{ edge, dir }] } – wyjazdy dozwolone z węzła (dir +1 – zgodnie z krawędzią, −1 – pod prąd
 * krawędzi, czyli od jej końca); edge: { id, a, b, pts (Float32Array x,z w m), cum (długości narastająco), len, cls,
 * width, oneway, bridge, way, wayS0 (początek krawędzi w drodze, m) }; ways: [{ len, bridge, first, last }] (krawędzie).
 */
export function buildRoadGraph(roads, { maxClass = CAR_MAX_CLASS, half = Infinity, join = true } = {}) {
	let use = [];
	for (let i = 0; i < roads.length; i++) {
		const r = roads[i];
		if (r[0] > maxClass || r[5].length < 4) continue;
		const c = r[5];
		if (Math.abs(c[0]) > half * 10 || Math.abs(c[1]) > half * 10) continue;
		use.push(r);
	}
	if (join) use = joinRoads(use);
	// 1. ile dróg przechodzi przez każdy punkt (każda droga liczona raz)
	const count = new Map();
	for (const r of use) {
		const c = r[5], seen = new Set();
		for (let i = 0; i < c.length; i += 2) {
			const k = key(c[i], c[i + 1]);
			if (seen.has(k)) continue;
			seen.add(k);
			count.set(k, (count.get(k) ?? 0) + 1);
		}
	}
	const nodes = [], nodeOf = new Map(), edges = [], ways = [];
	const node = (k, x, z) => {
		let n = nodeOf.get(k);
		if (!n) { n = { id: nodes.length, x, z, out: [] }; nodes.push(n); nodeOf.set(k, n); }
		return n;
	};
	// 2. podział dróg w węzłach
	for (const r of use) {
		const [cls, w10, , bridge, , c] = r;
		const oneway = r[6] ?? 0;
		const way = ways.length, firstEdge = edges.length;
		let wayLen = 0;
		let cur = [c[0] / 10, c[1] / 10], start = node(key(c[0], c[1]), c[0] / 10, c[1] / 10), s0 = 0;
		const flush = (endKey, x, z) => {
			if (cur.length < 4) return;
			const pts = Float32Array.from(cur);
			const cum = new Float32Array(pts.length / 2);
			for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
			const len = cum[cum.length - 1];
			const end = node(endKey, x, z);
			if (len < 0.5 || end === start) { start = end; return; }
			const e = { id: edges.length, a: start.id, b: end.id, pts, cum, len, cls, width: w10 / 10, oneway, bridge, way, wayS0: s0 };
			edges.push(e);
			if (oneway !== -1) start.out.push({ edge: e.id, dir: 1 });
			if (oneway !== 1) end.out.push({ edge: e.id, dir: -1 });
			s0 += len;
			start = end;
		};
		for (let i = 2; i < c.length; i += 2) {
			const x = c[i] / 10, z = c[i + 1] / 10;
			wayLen += Math.hypot(x - cur[cur.length - 2], z - cur[cur.length - 1]);
			cur.push(x, z);
			const k = key(c[i], c[i + 1]);
			if (i === c.length - 2 || (count.get(k) ?? 0) > 1) {
				flush(k, x, z);
				cur = [x, z];
			}
		}
		ways.push({ len: wayLen, bridge, first: firstEdge, last: edges.length - 1 });
	}
	return { nodes, edges, ways };
}

/**
 * Łączenie dróg bez wspólnych punktów: kafle wektorowe upraszczają linie i gubią punkty skrzyżowań (w Zabrzu ~30 tys.
 * „ślepych” końców tuż przy innej drodze). Koniec drogi bliżej niż 1,5 m od odcinka innej drogi – przyciągnięty do niego
 * (punkt wstawiony w obie), przecięcia odcinków różnych dróg – wspólny punkt. Mosty i drogi na innych poziomach
 * (layer) się nie łączą. Zwraca nowe drogi (te same pola, nowe współrzędne).
 */
export function joinRoads(roads, tol = 1.5, cell = 40) {
	const segs = []; // [droga, i (indeks punktu początku odcinka), ax, az, bx, bz] w metrach
	const grid = new Map();
	const add = (k, id) => { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(id); };
	roads.forEach((r, ri) => {
		const c = r[5];
		for (let i = 0; i + 3 < c.length; i += 2) {
			const ax = c[i] / 10, az = c[i + 1] / 10, bx = c[i + 2] / 10, bz = c[i + 3] / 10;
			const id = segs.length;
			segs.push([ri, i, ax, az, bx, bz]);
			const x0 = Math.floor((Math.min(ax, bx) - tol) / cell), x1 = Math.floor((Math.max(ax, bx) + tol) / cell);
			const z0 = Math.floor((Math.min(az, bz) - tol) / cell), z1 = Math.floor((Math.max(az, bz) + tol) / cell);
			for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) add(`${xx},${zz}`, id);
		}
	});
	const level = (r) => (r[3] ? 1000 : 0) + (r[4] ?? 0);
	const ins = new Map(); // "droga:i" → [{ t, x10, z10 }]
	const snap = new Map(); // "droga:koniec" → [x10, z10]
	const insert = (ri, i, t, x10, z10) => { const k = `${ri}:${i}`; let a = ins.get(k); if (!a) ins.set(k, (a = [])); a.push({ t, x10, z10 }); };
	const cellOf = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
	for (const [ck, ids] of grid) {
		for (let p = 0; p < ids.length; p++) for (let q = p + 1; q < ids.length; q++) {
			const A = segs[ids[p]], B = segs[ids[q]];
			if (A[0] === B[0]) continue;
			const ra = roads[A[0]], rb = roads[B[0]];
			if (level(ra) !== level(rb)) continue;
			// przecięcie właściwe
			const dax = A[4] - A[2], daz = A[5] - A[3], dbx = B[4] - B[2], dbz = B[5] - B[3];
			const den = dax * dbz - daz * dbx;
			if (Math.abs(den) > 1e-9) {
				const t = ((B[2] - A[2]) * dbz - (B[3] - A[3]) * dbx) / den;
				const u = ((B[2] - A[2]) * daz - (B[3] - A[3]) * dax) / den;
				if (t > 1e-3 && t < 1 - 1e-3 && u > 1e-3 && u < 1 - 1e-3) {
					const x = A[2] + dax * t, z = A[3] + daz * t;
					if (cellOf(x, z) === ck) {
						const x10 = Math.round(x * 10), z10 = Math.round(z * 10);
						insert(A[0], A[1], t, x10, z10);
						insert(B[0], B[1], u, x10, z10);
					}
				}
			}
			// końce dróg przy odcinku drugiej drogi (skrzyżowanie T)
			for (const [S, T] of [[A, B], [B, A]]) {
				const r = roads[S[0]], c = r[5];
				for (const end of [0, c.length - 2]) {
					if (S[1] !== (end === 0 ? 0 : end - 2)) continue;
					const ex = c[end] / 10, ez = c[end + 1] / 10;
					if (cellOf(ex, ez) !== ck) continue;
					const dx = T[4] - T[2], dz = T[5] - T[3], L2 = dx * dx + dz * dz || 1;
					const t = Math.max(0, Math.min(1, ((ex - T[2]) * dx + (ez - T[3]) * dz) / L2));
					const px = T[2] + dx * t, pz = T[3] + dz * t;
					const d = Math.hypot(ex - px, ez - pz);
					if (d > tol || d < 0.05) continue;
					const sk = `${S[0]}:${end}`;
					if (snap.has(sk)) continue;
					const x10 = Math.round(px * 10), z10 = Math.round(pz * 10);
					snap.set(sk, [x10, z10]);
					if (t > 1e-3 && t < 1 - 1e-3) insert(T[0], T[1], t, x10, z10);
				}
			}
		}
	}
	return roads.map((r, ri) => {
		const c = r[5];
		let touched = false;
		const out = [];
		for (let i = 0; i < c.length; i += 2) {
			const s = snap.get(`${ri}:${i}`);
			if (s) { out.push(s[0], s[1]); touched = true; } else out.push(c[i], c[i + 1]);
			const a = ins.get(`${ri}:${i}`);
			if (a) {
				a.sort((p, q) => p.t - q.t);
				for (const p of a) out.push(p.x10, p.z10);
				touched = true;
			}
		}
		if (!touched) return r;
		const nr = r.slice();
		nr[5] = out;
		return nr;
	});
}

/** Punkt na krawędzi w odległości s od jej początku: { x, z, tx, tz } (kierunek wzdłuż krawędzi). */
export function pointAt(e, s) {
	const cum = e.cum, pts = e.pts, n = cum.length;
	if (s <= 0) return seg(pts, 0, 0);
	if (s >= e.len) return seg(pts, n - 2, 1);
	// wyszukiwanie binarne odcinka
	let lo = 0, hi = n - 1;
	while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
	const t = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
	return seg(pts, lo, t);
}

function seg(pts, i, t) {
	const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
	const l = Math.hypot(x1 - x0, z1 - z0) || 1;
	return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, tx: (x1 - x0) / l, tz: (z1 - z0) / l };
}

/** Siatka przestrzenna krawędzi (komórki cell m): Map "i,j" → [id krawędzi]; krawędź we wszystkich komórkach,
 * przez które przechodzi. */
export function edgeGrid(edges, cell = 250) {
	const g = new Map();
	const cellsOf = new Uint16Array(edges.length); // w ilu komórkach leży krawędź (podział jej długości)
	for (const e of edges) {
		const seen = new Set();
		const mark = (x, z) => {
			const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
			if (seen.has(k)) return;
			seen.add(k);
			let a = g.get(k);
			if (!a) g.set(k, (a = []));
			a.push(e.id);
		};
		// punkty co pół komórki wzdłuż odcinków (długie proste bez punktów pośrednich nie przeskakują komórek)
		for (let i = 0; i + 3 < e.pts.length; i += 2) {
			const x0 = e.pts[i], z0 = e.pts[i + 1], x1 = e.pts[i + 2], z1 = e.pts[i + 3];
			const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (cell / 2)));
			for (let k = 0; k <= n; k++) mark(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n);
		}
		cellsOf[e.id] = seen.size;
	}
	return { cell, map: g, cellsOf };
}

/**
 * Najbliższy punkt sieci (do tol m) zgodny z kierunkiem (hx, hz) – do przepięcia pojazdów i pociągów na nowy graf
 * (otwarty świat przebudowuje sieć z kafli wokół samolotu). Zwraca { edge, s (od początku krawędzi), dir } albo null.
 */
export function projectToGraph(g, grid, x, z, hx, hz, tol = 6) {
	const c = grid.cell, ci = Math.floor(x / c), cj = Math.floor(z / c);
	let best = null, bd = tol * tol;
	const seen = new Set();
	// sąsiednie komórki tylko, gdy punkt leży bliżej ich granicy niż tol
	const fx = x - ci * c, fz = z - cj * c;
	const d0 = fx < tol ? -1 : 0, d1 = c - fx < tol ? 1 : 0, e0 = fz < tol ? -1 : 0, e1 = c - fz < tol ? 1 : 0;
	for (let dj = e0; dj <= e1; dj++) for (let di = d0; di <= d1; di++) for (const id of grid.map.get(`${ci + di},${cj + dj}`) ?? []) {
		if (seen.has(id)) continue;
		seen.add(id);
		const e = g.edges[id], p = e.pts;
		for (let i = 0; i + 3 < p.length; i += 2) {
			const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1;
			const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
			const ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
			if (d2 >= bd) continue;
			const L = Math.sqrt(L2), dot = (dx * hx + dz * hz) / L;
			if (Math.abs(dot) < 0.7) continue; // poprzeczna droga na skrzyżowaniu
			bd = d2;
			best = { edge: id, s: e.cum[i / 2] + t * L, dir: dot > 0 ? 1 : -1 };
		}
	}
	return best;
}

/**
 * Graf i siatka krawędzi w kilku tablicach liczbowych (przekazanie z wątku bez kopiowania i bez kosztownego
 * odtwarzania tysięcy małych obiektów) – packNetwork w wątku, unpackNetwork w wątku głównym.
 */
export function packNetwork(g, grid) {
	const E = g.edges.length, N = g.nodes.length, W = g.ways.length;
	let nPts = 0, nOut = 0, nCell = 0;
	for (const e of g.edges) nPts += e.pts.length / 2;
	for (const n of g.nodes) nOut += n.out.length;
	for (const ids of grid.map.values()) nCell += ids.length;
	const eI = new Int32Array(E * 7), eF = new Float32Array(E * 3), pts = new Float32Array(nPts * 2), cum = new Float32Array(nPts);
	let p = 0;
	g.edges.forEach((e, i) => {
		const m = e.pts.length / 2;
		eI.set([e.a, e.b, e.cls, e.oneway, e.bridge ? 1 : 0, e.way, p], i * 7);
		eF.set([e.len, e.width, e.wayS0], i * 3);
		pts.set(e.pts, p * 2);
		cum.set(e.cum, p);
		p += m;
	});
	const nXZ = new Float32Array(N * 2), outOff = new Int32Array(N + 1), out = new Int32Array(nOut * 2);
	let o = 0;
	g.nodes.forEach((n, i) => {
		nXZ[i * 2] = n.x; nXZ[i * 2 + 1] = n.z;
		outOff[i] = o;
		for (const q of n.out) { out[o * 2] = q.edge; out[o * 2 + 1] = q.dir; o++; }
	});
	outOff[N] = o;
	const wI = new Int32Array(W * 3), wF = new Float32Array(W);
	g.ways.forEach((w, i) => { wI.set([w.first, w.last, w.bridge ? 1 : 0], i * 3); wF[i] = w.len; });
	const keys = [...grid.map.keys()], cellOff = new Int32Array(keys.length + 1), cellIds = new Int32Array(nCell);
	let c = 0;
	keys.forEach((k, i) => { cellOff[i] = c; for (const id of grid.map.get(k)) cellIds[c++] = id; });
	cellOff[keys.length] = c;
	const packed = { E, N, W, eI, eF, pts, cum, nXZ, outOff, out, wI, wF, keys, cell: grid.cell, cellOff, cellIds, cellsOf: grid.cellsOf };
	return { packed, transfer: [eI, eF, pts, cum, nXZ, outOff, out, wI, wF, cellOff, cellIds, grid.cellsOf].map((a) => a.buffer) };
}

/** Krawędź z tablic packNetwork: pola liczbowe od razu, pts i cum – widoki tworzone przy pierwszym użyciu. */
class PackedEdge {
	constructor(P, i) {
		const k = i * 7;
		this.P = P; this.id = i;
		this.a = P.eI[k]; this.b = P.eI[k + 1]; this.cls = P.eI[k + 2]; this.oneway = P.eI[k + 3]; this.bridge = P.eI[k + 4]; this.way = P.eI[k + 5];
		this.len = P.eF[i * 3]; this.width = P.eF[i * 3 + 1]; this.wayS0 = P.eF[i * 3 + 2];
		this._pts = null; this._cum = null;
	}

	range() { const P = this.P, k = this.id * 7; return [P.eI[k + 6], this.id + 1 < P.E ? P.eI[k + 13] : P.cum.length]; }
	get pts() { if (!this._pts) { const [p, q] = this.range(); this._pts = this.P.pts.subarray(p * 2, q * 2); } return this._pts; }
	get cum() { if (!this._cum) { const [p, q] = this.range(); this._cum = this.P.cum.subarray(p, q); } return this._cum; }
}

/** Węzeł z tablic packNetwork: lista wyjazdów tworzona przy pierwszym użyciu. */
class PackedNode {
	constructor(P, i) { this.P = P; this.id = i; this.x = P.nXZ[i * 2]; this.z = P.nXZ[i * 2 + 1]; this._out = null; }
	get out() {
		if (!this._out) {
			const P = this.P, o = [];
			for (let k = P.outOff[this.id]; k < P.outOff[this.id + 1]; k++) o.push({ edge: P.out[k * 2], dir: P.out[k * 2 + 1] });
			this._out = o;
		}
		return this._out;
	}
}

/** Odwrotność packNetwork: { graph, grid } w postaci z buildRoadGraph i edgeGrid (krawędzie i węzły – widoki tablic). */
export function unpackNetwork(P) {
	const edges = new Array(P.E), nodes = new Array(P.N), ways = new Array(P.W);
	for (let i = 0; i < P.E; i++) edges[i] = new PackedEdge(P, i);
	for (let i = 0; i < P.N; i++) nodes[i] = new PackedNode(P, i);
	for (let i = 0; i < P.W; i++) ways[i] = { len: P.wF[i], bridge: P.wI[i * 3 + 2], first: P.wI[i * 3], last: P.wI[i * 3 + 1] };
	const map = new Map();
	P.keys.forEach((k, i) => map.set(k, P.cellIds.subarray(P.cellOff[i], P.cellOff[i + 1])));
	return { graph: { nodes, edges, ways }, grid: { cell: P.cell, map, cellsOf: P.cellsOf } };
}
