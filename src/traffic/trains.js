// Ruch kolejowy (sama logika – testowana w Node): graf torów jak dróg (src/traffic/graph.js), pociągi w promieniu
// kilku km od kamery. Pociąg jedzie po ścieżce złożonej z kolejnych krawędzi (z zapasem przed czołem i za ogonem),
// wagony stoją w swoich odległościach od czoła – na łukach składa się naturalnie. Na rozjazdach tylko łagodne
// przejścia (pociąg nie skręca pod ostrym kątem), na końcu toru staje i zmienia kierunek czoła (jak skład wahadłowy).
// Osobowe stają na stacjach i przystankach z danych (Intercity – tylko na stacjach), towarowe przejeżdżają.
import { buildRoadGraph, edgeGrid, pointAt } from './graph.js';

/** Klasy torów w grafie: 0 szlak, 1 bocznica / tor stacyjny, 2 wąskotorowy. */
export function railsAsRoads(rails) {
	const out = [];
	for (const [kind, service, bridge, layer, c] of rails) {
		if (kind >= 2) continue; // nieczynne i rozebrane – bez ruchu
		out.push([kind === 1 ? 2 : service ? 1 : 0, 40, 0, bridge, layer, c, 0]);
	}
	return out;
}

/** Wagony: długość (m); kinds – do rysowania. */
export const CARS = {
	loco: { len: 19 }, emuHead: { len: 22 }, emuMid: { len: 22 }, coach: { len: 26.4 },
	hopper: { len: 14 }, tank: { len: 12.5 }, narrowLoco: { len: 8 }, narrowCoach: { len: 10.5 },
};
/** Barwy: [główna, druga] – Polregio / Koleje Śląskie, Intercity, PKP Cargo, wąskotorowa. */
const LIVERY = {
	emu: [[[0.62, 0.07, 0.05], [0.85, 0.65, 0.08]], [[0.85, 0.66, 0.1], [0.6, 0.08, 0.06]], [[0.7, 0.72, 0.75], [0.12, 0.25, 0.6]]],
	ic: [[[0.72, 0.73, 0.75], [0.1, 0.18, 0.42]]],
	cargo: [[[0.55, 0.07, 0.05], [0.25, 0.26, 0.28]], [[0.12, 0.3, 0.55], [0.85, 0.85, 0.85]]],
	wagon: [[[0.22, 0.13, 0.08], [0.06, 0.06, 0.06]], [[0.3, 0.3, 0.3], [0.1, 0.1, 0.1]], [[0.35, 0.2, 0.1], [0.08, 0.08, 0.08]]],
	narrow: [[[0.15, 0.35, 0.18], [0.75, 0.62, 0.3]]],
};
/** Rodzaje pociągów: prędkość (m/s), przyspieszenie i hamowanie (m/s²), postoje. */
export const TRAINS = {
	emu: { vmax: 27, acc: 0.7, brake: 0.8, stops: 'all', dwell: [25, 45] },
	ic: { vmax: 33, acc: 0.45, brake: 0.6, stops: 'stations', dwell: [60, 90] },
	freight: { vmax: 19, acc: 0.25, brake: 0.4, stops: 'none', dwell: [0, 0] },
	narrow: { vmax: 7, acc: 0.4, brake: 0.5, stops: 'all', dwell: [30, 50] },
};

function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Skład pociągu danego rodzaju: lista { kind, len, colA, colB } od czoła. */
export function makeConsist(type, random) {
	const pick = (a) => a[Math.floor(random() * a.length)];
	const cars = [];
	const add = (kind, liv) => cars.push({ kind, len: CARS[kind].len, colA: liv[0], colB: liv[1] });
	if (type === 'emu') {
		const liv = pick(LIVERY.emu), mids = 1 + Math.floor(random() * 2);
		add('emuHead', liv);
		for (let i = 0; i < mids; i++) add('emuMid', liv);
		add('emuHead', liv);
		cars[cars.length - 1].reversed = true;
	} else if (type === 'ic') {
		const liv = pick(LIVERY.ic);
		add('loco', pick(LIVERY.cargo));
		const n = 5 + Math.floor(random() * 4);
		for (let i = 0; i < n; i++) add('coach', liv);
	} else if (type === 'freight') {
		add('loco', pick(LIVERY.cargo));
		const n = 16 + Math.floor(random() * 16), tanks = random() < 0.3;
		const liv = pick(LIVERY.wagon);
		for (let i = 0; i < n; i++) add(tanks && random() < 0.8 ? 'tank' : 'hopper', tanks ? [[0.12, 0.12, 0.13], [0.05, 0.05, 0.05]] : liv);
	} else {
		const liv = pick(LIVERY.narrow);
		add('narrowLoco', [[0.08, 0.08, 0.09], [0.6, 0.1, 0.06]]);
		for (let i = 0; i < 3; i++) add('narrowCoach', liv);
	}
	// odległości środków wagonów od czoła (1 m przerwy na sprzęgi)
	let d = 0;
	for (const c of cars) { c.offset = d + c.len / 2; d += c.len + 1; }
	return { cars, length: d - 1 };
}

export class TrainSim {
	/** rails – osm.rails, stations – osm.stations; opts: { radius, max, heightAt, seed }. */
	constructor(rails, stations, opts = {}) {
		this.g = buildRoadGraph(railsAsRoads(rails), { maxClass: 2, half: opts.half ?? Infinity });
		this.grid = edgeGrid(this.g.edges, 500);
		this.radius = opts.radius ?? 6000;
		this.max = opts.max ?? 10;
		this.random = rng(opts.seed ?? 777);
		this.heightAt = opts.heightAt ?? (() => 0);
		this.trains = [];
		this.density = 1;
		this.wayEnds = new Map();
		this.events = []; // zdarzenia do dźwięku: { type: 'horn', x, z }
		// stacje przypięte do najbliższego toru (do 80 m)
		this.stops = new Map(); // krawędź → [{ s, halt, name }]
		for (const [halt, p, name] of stations ?? []) {
			const x = p[0] / 10, z = p[1] / 10;
			let best = null, bd = 80;
			for (const id of this.nearEdges(x, z)) {
				const e = this.g.edges[id];
				for (let i = 0; i + 3 < e.pts.length; i += 2) {
					const ax = e.pts[i], az = e.pts[i + 1], dx = e.pts[i + 2] - ax, dz = e.pts[i + 3] - az, L2 = dx * dx + dz * dz || 1;
					const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
					const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
					if (d < bd && e.cls !== 1) { bd = d; best = { edge: id, s: e.cum[i / 2] + t * Math.sqrt(L2), halt, name }; }
				}
			}
			if (best) {
				let a = this.stops.get(best.edge);
				if (!a) this.stops.set(best.edge, (a = []));
				a.push(best);
			}
		}
	}

	nearEdges(x, z) {
		const c = this.grid.cell, i = Math.floor(x / c), j = Math.floor(z / c), out = new Set();
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const id of this.grid.map.get(`${i + di},${j + dj}`) ?? []) out.add(id);
		return out;
	}

	/** Długość szlaków (km) w promieniu – do liczby pociągów. */
	trackKm(cx, cz) {
		const c = this.grid.cell, n = Math.ceil(this.radius / c), ci = Math.floor(cx / c), cj = Math.floor(cz / c);
		let km = 0;
		for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
			for (const id of this.grid.map.get(`${ci + i},${cj + j}`) ?? []) {
				const e = this.g.edges[id];
				if (e.cls !== 1) km += e.len / 1000 / Math.max(1, this.grid.cellsOf[id]);
			}
		}
		return km;
	}

	/** Kierunek na końcu wpisu ścieżki i na początku następnej krawędzi (do wyboru łagodnego przejścia). */
	tangentEnd(entry) {
		const e = this.g.edges[entry.edge], p = pointAt(e, entry.dir === 1 ? e.len - 0.1 : 0.1);
		return [p.tx * entry.dir, p.tz * entry.dir];
	}

	/** Następny odcinek z węzła na końcu wpisu: tylko przejścia łagodne (kąt < ~40°), szlak przed bocznicą. */
	nextEntry(entry) {
		const e = this.g.edges[entry.edge];
		const node = this.g.nodes[entry.dir === 1 ? e.b : e.a];
		const [tx, tz] = this.tangentEnd(entry);
		const opts = [];
		for (const o of node.out) {
			if (o.edge === entry.edge) continue;
			const n = this.g.edges[o.edge];
			const p = pointAt(n, o.dir === 1 ? 0.1 : n.len - 0.1);
			const dot = p.tx * o.dir * tx + p.tz * o.dir * tz;
			if (dot < 0.75) continue;
			if ((n.cls === 2) !== (e.cls === 2)) continue; // wąski i normalny tor się nie łączą
			opts.push({ o, w: (n.cls === 1 ? 0.15 : 1) * (dot * dot) });
		}
		if (!opts.length) return null;
		let r = this.random() * opts.reduce((a, b) => a + b.w, 0);
		for (const p of opts) { r -= p.w; if (r <= 0) return p.o; }
		return opts[opts.length - 1].o;
	}

	/** Dokłada odcinki przed czołem (zapas lookahead), zbiera postoje; zwraca false, gdy tor się kończy. */
	extend(tr, lookahead = 1600) {
		while (true) {
			const last = tr.path[tr.path.length - 1];
			const lastEnd = last.start + this.g.edges[last.edge].len;
			if (lastEnd > tr.head + lookahead) return true;
			if (tr.endOfLine) return false;
			const nx = this.nextEntry(last);
			if (!nx) { tr.endOfLine = lastEnd; return false; }
			const entry = { edge: nx.edge, dir: nx.dir, start: lastEnd };
			tr.path.push(entry);
			this.addStops(tr, entry);
		}
	}

	addStops(tr, entry) {
		const rule = TRAINS[tr.type].stops;
		if (rule === 'none') return;
		const e = this.g.edges[entry.edge];
		for (const st of this.stops.get(entry.edge) ?? []) {
			if (rule === 'stations' && st.halt) continue;
			const along = entry.dir === 1 ? st.s : e.len - st.s;
			// środek składu przy budynku stacji (czoło pół długości dalej)
			const at = entry.start + along + tr.length / 2;
			if (at > tr.head + 5 && !tr.stops.some((s) => Math.abs(s.at - at) < 60)) tr.stops.push({ at, name: st.name });
		}
		tr.stops.sort((a, b) => a.at - b.at);
	}

	/** Położenie na ścieżce w odległości D (od początku ścieżki): { x, z, tx, tz, y }. */
	posAt(tr, D) {
		const path = tr.path;
		let i = tr.cursor ?? path.length - 1;
		while (i > 0 && path[i].start > D) i--;
		while (i < path.length - 1 && path[i + 1].start <= D) i++;
		const en = path[Math.max(0, i)], e = this.g.edges[en.edge];
		const s = Math.max(0, Math.min(e.len, D - en.start));
		const along = en.dir === 1 ? s : e.len - s;
		const p = pointAt(e, along);
		let y;
		if (e.bridge) {
			let ends = this.wayEnds.get(e.way);
			if (!ends) {
				const w = this.g.ways[e.way], f = this.g.edges[w.first], l = this.g.edges[w.last];
				ends = [this.heightAt(f.pts[0], f.pts[1]), this.heightAt(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1])];
				this.wayEnds.set(e.way, ends);
			}
			y = ends[0] + (ends[1] - ends[0]) * ((e.wayS0 + along) / Math.max(1, this.g.ways[e.way].len)) + 0.9;
		} else y = this.heightAt(p.x, p.z) + 0.35;
		return { x: p.x, z: p.z, tx: p.tx * en.dir, tz: p.tz * en.dir, y };
	}

	/** Nowy pociąg na szlaku w pierścieniu 1,5 km … promień od środka. */
	spawn(center) {
		const ang = this.random() * Math.PI * 2, r = 1500 + this.random() * (this.radius - 1500);
		const ids = [...this.nearEdges(center.x + Math.cos(ang) * r, center.z + Math.sin(ang) * r)].filter((id) => this.g.edges[id].cls !== 1);
		if (!ids.length) return null;
		const e = this.g.edges[ids[Math.floor(this.random() * ids.length)]];
		const type = e.cls === 2 ? 'narrow' : this.random() < 0.5 ? 'emu' : this.random() < 0.7 ? 'freight' : 'ic';
		const con = makeConsist(type, this.random);
		const dir = this.random() < 0.5 ? 1 : -1;
		const tr = {
			type, ...con, path: [{ edge: e.id, dir, start: 0 }], head: this.random() * e.len,
			v: TRAINS[type].vmax * 0.8, stops: [], dwell: 0, endOfLine: null, id: Math.floor(this.random() * 1e9),
		};
		// ogon za czołem: ścieżka dokładana wstecz (krawędzie między rozjazdami bywają krótsze od pociągu)
		if (!this.extendBack(tr)) return null;
		this.addStops(tr, tr.path[tr.path.length - 1]);
		tr.stops = tr.stops.filter((s) => s.at > tr.head + 200);
		this.extend(tr);
		// nie na innym pociągu
		for (const o of this.trains) for (const en of o.path) if (en.edge === e.id) return null;
		this.trains.push(tr);
		return tr;
	}

	/** Dokłada odcinki za początkiem ścieżki, aż zmieści się cały skład; false – tor kończy się wcześniej. */
	extendBack(tr) {
		let guard = 0;
		while (tr.path[0].start > tr.head - tr.length - 20 && guard++ < 50) {
			const first = tr.path[0];
			const nx = this.nextEntry({ edge: first.edge, dir: -first.dir });
			if (!nx) return false;
			const len = this.g.edges[nx.edge].len;
			tr.path.unshift({ edge: nx.edge, dir: -nx.dir, start: first.start - len });
		}
		return guard < 50;
	}

	/** Zmiana kierunku: ścieżka odwrócona, czoło – tam, gdzie był ogon; kolejność wagonów odwrócona. */
	reverse(tr) {
		const end = tr.path[tr.path.length - 1];
		const total = end.start + this.g.edges[end.edge].len;
		const path = [];
		for (let i = tr.path.length - 1; i >= 0; i--) {
			const en = tr.path[i], len = this.g.edges[en.edge].len;
			path.push({ edge: en.edge, dir: -en.dir, start: total - (en.start + len) });
		}
		tr.head = total - (tr.head - tr.length);
		tr.path = path;
		tr.cursor = undefined;
		tr.cars.reverse();
		let d = 0;
		for (const c of tr.cars) { c.offset = d + c.len / 2; d += c.len + 1; c.reversed = !c.reversed; }
		tr.endOfLine = null;
		tr.stops = [];
		for (const en of tr.path) if (en.start + this.g.edges[en.edge].len > tr.head) this.addStops(tr, en);
		tr.stops = tr.stops.filter((s) => s.at > tr.head + 5);
	}

	step(dt, center) {
		this.events.length = 0;
		// ok. 1 pociąg na 10 km szlaków w promieniu, co najmniej jeden, gdy torów jest więcej niż 3 km
		const km = this.trackKm(center.x, center.z);
		const target = km < 3 || this.density <= 0 ? 0 : Math.max(1, Math.min(this.max, Math.round((km / 10) * this.density)));
		this.target = target;
		if (this.trains.length < target) for (let i = 0; i < 4 && this.trains.length < target; i++) this.spawn(center);
		const keep = [];
		for (const tr of this.trains) {
			const T = TRAINS[tr.type];
			if (tr.dwell > 0) {
				tr.dwell -= dt;
				if (tr.dwell <= 0) {
					if (tr.reverseAfter) { this.reverse(tr); tr.reverseAfter = false; }
					this.events.push({ type: 'horn', train: tr });
				}
			} else {
				this.extend(tr);
				// prędkość: do najbliższego postoju albo końca toru – hamowanie √(2·a·d)
				let stopAt = tr.stops[0]?.at ?? Infinity;
				if (tr.endOfLine != null) stopAt = Math.min(stopAt, tr.endOfLine - 2);
				const d = stopAt - tr.head;
				const vt = Math.min(T.vmax, Math.sqrt(2 * T.brake * Math.max(0, d)));
				tr.v = vt > tr.v ? Math.min(vt, tr.v + T.acc * dt) : vt;
				tr.head += tr.v * dt;
				if (d < 1.5 && tr.v < 0.6) {
					tr.v = 0;
					if (tr.stops.length && tr.stops[0].at - tr.head < 2) {
						tr.stops.shift();
						tr.dwell = T.dwell[0] + this.random() * (T.dwell[1] - T.dwell[0]);
					}
					if (tr.endOfLine != null && tr.endOfLine - tr.head < 4) { tr.dwell = Math.max(tr.dwell, 40); tr.reverseAfter = true; }
				}
				// zbędne odcinki za ogonem
				while (tr.path.length > 1 && tr.path[1].start < tr.head - tr.length - 100) tr.path.shift();
			}
			// położenia wagonów (środek i oba końce – do kierunku)
			let far = true;
			for (const c of tr.cars) {
				const D = tr.head - c.offset;
				const a = this.posAt(tr, D + c.len * 0.35), b = this.posAt(tr, D - c.len * 0.35);
				c.x = (a.x + b.x) / 2; c.z = (a.z + b.z) / 2; c.y = (a.y + b.y) / 2;
				const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1;
				c.hx = dx / l; c.hz = dz / l;
				c.pitch = (a.y - b.y) / (c.len * 0.7);
				if ((c.x - center.x) ** 2 + (c.z - center.z) ** 2 < (this.radius * 1.15) ** 2) far = false;
			}
			if (!far) keep.push(tr);
		}
		this.trains = keep;
	}
}
