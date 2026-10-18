// Symulacja ruchu ulicznego wokół kamery (sama logika – testowana w Node): pojazdy pojawiają się na drogach w promieniu
// R według gęstości klasy drogi i pory dnia, jadą po krawędziach grafu (src/traffic/graph.js) z prędkością drogi,
// trzymają odstęp od poprzedzającego na tym samym pasie, na skrzyżowaniach wybierają dalszą drogę (wolą podobną
// lub ważniejszą, nie zawracają, chyba że ślepa uliczka), daleko od kamery – znikają. Ruch prawostronny.
import { SPEED, DENSITY, pointAt } from './graph.js';

/** Rodzaje pojazdów: długość, szerokość (m), udział w ruchu (autostrada / miasto) i mnożnik prędkości. */
export const VEHICLES = [
	{ id: 'car', len: 4.4, width: 1.8, share: [0.72, 0.84], speed: 1 },
	{ id: 'van', len: 5.4, width: 2.0, share: [0.12, 0.1], speed: 0.92 },
	{ id: 'truck', len: 13, width: 2.5, share: [0.16, 0.03], speed: 0.75 },
	{ id: 'bus', len: 12, width: 2.55, share: [0, 0.03], speed: 0.8 },
];
const CAR_COLORS = [
	[0.75, 0.75, 0.76], [0.08, 0.08, 0.09], [0.45, 0.46, 0.48], [0.9, 0.9, 0.9], [0.5, 0.06, 0.05], [0.1, 0.17, 0.35],
	[0.25, 0.27, 0.3], [0.62, 0.6, 0.55], [0.15, 0.3, 0.2], [0.85, 0.55, 0.1],
];

/** Natężenie ruchu wg godziny (0..1): szczyty rano i po południu, noc prawie pusto. */
export function trafficByHour(h) {
	const g = (c, w) => Math.exp(-(((h - c) / w) ** 2));
	return Math.min(1, 0.12 + 0.5 * g(13, 5.5) + 0.58 * g(7.5, 1.2) + 0.5 * g(16.5, 1.6) + 0.15 * g(20, 2));
}

/** Prosty generator liczb pseudolosowych (powtarzalny w testach). */
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

export class TrafficSim {
	/** graph – z buildRoadGraph, grid – z edgeGrid; opts: { radius, max, seed }. */
	constructor(graph, grid, opts = {}) {
		this.g = graph;
		this.grid = grid;
		this.radius = opts.radius ?? 2500;
		this.max = opts.max ?? 2500;
		this.random = rng(opts.seed ?? 12345);
		this.agents = [];
		this.lanes = new Map(); // "krawędź:kierunek" → pojazdy na pasie
		this.density = 1; // mnożnik (ustawienia × pora dnia × pogoda)
		this.center = { x: 0, z: 0 };
		this.target = 0;
		this.cellCache = new Map(); // komórka → suma gęstości × długość krawędzi (oczekiwana liczba pojazdów przy 1)
		this.lastCell = '';
		this.heightAt = opts.heightAt ?? (() => 0);
		this.wayEnds = new Map(); // droga na moście → wysokości przyczółków
	}

	/** Oczekiwana liczba pojazdów w komórce siatki przy gęstości 1 (krawędzie liczone raz na komórkę). */
	cellLoad(k) {
		let v = this.cellCache.get(k);
		if (v !== undefined) return v;
		v = 0;
		for (const id of this.grid.map.get(k) ?? []) {
			const e = this.g.edges[id];
			// długość krawędzi rozdzielona po równo na jej komórki
			const dirs = e.oneway ? 1 : 2;
			v += (DENSITY[e.cls] * dirs * e.len) / 1000 / Math.max(1, this.grid.cellsOf[id]);
		}
		this.cellCache.set(k, v);
		return v;
	}

	/** Liczba pojazdów docelowa w promieniu – przeliczana przy zmianie komórki środka. */
	updateTarget() {
		const c = this.grid.cell, R = this.radius;
		const ci = Math.floor(this.center.x / c), cj = Math.floor(this.center.z / c);
		const k = `${ci},${cj}`;
		if (k === this.lastCell) return;
		this.lastCell = k;
		const n = Math.ceil(R / c);
		let sum = 0;
		this.cells = [];
		for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
			if ((i * c) ** 2 + (j * c) ** 2 > (R + c) ** 2) continue;
			const kk = `${ci + i},${cj + j}`;
			const load = this.cellLoad(kk);
			if (load > 0) { sum += load; this.cells.push([kk, load]); }
		}
		this.cellSum = sum;
		this.baseTarget = sum;
	}

	lane(a) { return `${a.edge.id}:${a.dir}`; }

	addToLane(a) {
		const k = this.lane(a);
		let l = this.lanes.get(k);
		if (!l) this.lanes.set(k, (l = []));
		l.push(a);
	}

	removeFromLane(a) {
		const l = this.lanes.get(this.lane(a));
		if (!l) return;
		const i = l.indexOf(a);
		if (i >= 0) l.splice(i, 1);
		if (!l.length) this.lanes.delete(this.lane(a));
	}

	/** Nowy pojazd w losowej komórce (wagą obciążenia), na losowej krawędzi (wagą gęstości klasy), losowym miejscu. */
	spawn() {
		if (!this.cells?.length) return null;
		let r = this.random() * this.cellSum, cell = this.cells[0][0];
		for (const [k, load] of this.cells) { r -= load; if (r <= 0) { cell = k; break; } }
		const ids = this.grid.map.get(cell);
		if (!ids?.length) return null;
		const e = this.g.edges[ids[Math.floor(this.random() * ids.length)]];
		if (this.random() > DENSITY[e.cls] / DENSITY[0]) return null; // drogi lokalne rzadziej
		const dir = e.oneway ? e.oneway : this.random() < 0.5 ? 1 : -1;
		const s = this.random() * e.len;
		const urban = e.cls >= 2 ? 1 : 0;
		let pick = this.random(), type = 0;
		for (let i = 0; i < VEHICLES.length; i++) { pick -= VEHICLES[i].share[urban]; if (pick <= 0) { type = i; break; } }
		const V = VEHICLES[type];
		const a = {
			edge: e, dir, s, type, len: V.len, width: V.width,
			vmax: SPEED[e.cls] * V.speed * (0.85 + this.random() * 0.3), v: 0,
			color: type === 3 ? [0.75, 0.62, 0.12] : type === 2 && this.random() < 0.5 ? [0.85, 0.85, 0.83] : CAR_COLORS[Math.floor(this.random() * CAR_COLORS.length)],
			lanePick: this.random(),
			x: 0, y: 0, z: 0, hx: 1, hz: 0,
		};
		// nie wstawiaj na innego (odstęp co najmniej 12 m)
		const l = this.lanes.get(this.lane(a));
		if (l && l.some((b) => Math.abs(b.s - s) < 12)) return null;
		a.v = a.vmax * 0.8;
		this.addToLane(a);
		this.agents.push(a);
		return a;
	}

	/** Dalsza droga z węzła na końcu krawędzi: bez zawracania (chyba że ślepa), wolą podobną lub ważniejszą klasę. */
	nextEdge(a) {
		const nodeId = a.dir === 1 ? a.edge.b : a.edge.a;
		const node = this.g.nodes[nodeId];
		const opts = node.out.filter((o) => o.edge !== a.edge.id);
		if (!opts.length) {
			const back = node.out.find((o) => o.edge === a.edge.id);
			return back ?? null;
		}
		let sum = 0;
		const w = opts.map((o) => {
			const c = this.g.edges[o.edge].cls;
			const x = c <= a.edge.cls ? 1 : 0.35 / (1 + c - a.edge.cls);
			sum += x;
			return x;
		});
		let r = this.random() * sum;
		for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
		return opts[opts.length - 1];
	}

	/** Krok: center – punkt odniesienia (kamera/samolot na ziemi), dt – s. */
	step(dt, center) {
		this.center = center;
		this.updateTarget();
		const target = Math.min(this.max, Math.round(this.baseTarget * this.density));
		this.target = target;
		// pojawianie się: kilkadziesiąt prób na klatkę, aż do celu
		for (let tries = 0; tries < 60 && this.agents.length < target; tries++) this.spawn();
		// odstępy: pojazdy na pasie posortowane wzdłuż kierunku jazdy
		for (const l of this.lanes.values()) l.sort((p, q) => p.s - q.s);
		const R2 = (this.radius * 1.12) ** 2;
		const keep = [];
		for (const a of this.agents) {
			const l = this.lanes.get(this.lane(a));
			const i = l.indexOf(a);
			const lead = l[i + 1];
			let v = a.vmax;
			if (lead) {
				const gap = lead.s - a.s - (lead.len + a.len) / 2;
				v = Math.min(v, Math.max(0, (gap - 4) / 1.4));
			}
			a.v += (v - a.v) * Math.min(1, dt * (v < a.v ? 3 : 0.8));
			a.s += a.v * dt;
			// koniec krawędzi – następna
			let guard = 0;
			while (a.s > a.edge.len && guard++ < 4) {
				const rest = a.s - a.edge.len;
				const nx = this.nextEdge(a);
				this.removeFromLane(a);
				if (!nx) { a.dead = true; break; }
				a.edge = this.g.edges[nx.edge];
				a.dir = nx.dir;
				a.s = rest;
				a.vmax = SPEED[a.edge.cls] * VEHICLES[a.type].speed * (0.85 + a.lanePick * 0.3);
				this.addToLane(a);
			}
			if (a.dead) continue;
			this.place(a);
			if ((a.x - center.x) ** 2 + (a.z - center.z) ** 2 > R2 || keep.length >= this.max) { this.removeFromLane(a); continue; }
			keep.push(a);
		}
		this.agents = keep;
	}

	/** Położenie i kierunek pojazdu: prawy pas (dwukierunkowe), na jednokierunkowych – losowy pas. */
	place(a) {
		const e = a.edge;
		const sAlong = a.dir === 1 ? a.s : e.len - a.s;
		const p = pointAt(e, sAlong);
		const hx = p.tx * a.dir, hz = p.tz * a.dir;
		// prawa strona kierunku jazdy w układzie x – wschód, z – południe: (−hz, hx)
		const w = e.width;
		const off = e.oneway ? (a.lanePick - 0.5) * Math.max(0, w - 3.2) : Math.min(w / 4, 1.9);
		a.x = p.x - hz * off;
		a.z = p.z + hx * off;
		a.hx = hx; a.hz = hz;
		if (e.bridge) {
			// pomost – prosta między przyczółkami drogi (jak w src/bridges.js)
			let ends = this.wayEnds.get(e.way);
			if (!ends) {
				const w = this.g.ways[e.way], first = this.g.edges[w.first], last = this.g.edges[w.last];
				ends = [this.heightAt(first.pts[0], first.pts[1]), this.heightAt(last.pts[last.pts.length - 2], last.pts[last.pts.length - 1])];
				this.wayEnds.set(e.way, ends);
			}
			const t = (e.wayS0 + sAlong) / Math.max(1, this.g.ways[e.way].len);
			a.y = ends[0] + (ends[1] - ends[0]) * t + 0.6;
		} else a.y = this.heightAt(a.x, a.z) + 0.05;
	}
}
