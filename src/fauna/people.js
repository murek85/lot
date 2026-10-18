// Piesi (sama logika – testowana w Node): chodzą po chodnikach ulic, deptakach i ścieżkach w zabudowie, czekają na
// peronach. Widoczni tylko z niska, więc symulowani w promieniu ~800 m od kamery, gdy jest nisko. Sieć ścieżek
// budowana na bieżąco w kwadratach 2 km wokół kamery (graf wszystkich chodników regionu wydłużyłby wczytywanie).
import { buildRoadGraph, pointAt } from '../traffic/graph.js';

const CHUNK = 2000;
/** Klasy dróg, po których chodzą piesi: ulice (chodnikiem) i ścieżki; bez autostrad i duktów. */
const WALK = new Set([1, 2, 3, 4, 5, 7]);

/** Ruch pieszy wg godziny (0..1): dzień, popołudniowy szczyt, noc prawie pusto. */
export function peopleByHour(h) {
	const g = (c, w) => Math.exp(-(((h - c) / w) ** 2));
	return Math.min(1, 0.04 + 0.6 * g(12.5, 4.5) + 0.4 * g(17, 2) + 0.25 * g(8, 1.3));
}

function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

const SHIRTS = [[0.55, 0.08, 0.06], [0.1, 0.18, 0.45], [0.85, 0.85, 0.82], [0.08, 0.08, 0.09], [0.2, 0.4, 0.2], [0.75, 0.55, 0.1], [0.45, 0.45, 0.48], [0.5, 0.25, 0.45]];
const PANTS = [[0.08, 0.1, 0.18], [0.06, 0.06, 0.07], [0.35, 0.3, 0.22], [0.25, 0.27, 0.32]];
const UMBRELLAS = [[0.06, 0.06, 0.07], [0.5, 0.06, 0.05], [0.1, 0.2, 0.5], [0.7, 0.6, 0.1]];

export class PeopleSim {
	/** roads – osm.roads, platforms – osm.platforms; opts: { coverAt, heightAt, radius, max, seed }. */
	constructor(roads, platforms, opts = {}) {
		this.coverAt = opts.coverAt ?? (() => 'built');
		this.heightAt = opts.heightAt ?? (() => 0);
		this.radius = opts.radius ?? 800;
		this.max = opts.max ?? 1500;
		this.random = rng(opts.seed ?? 99);
		this.setRoads(roads, platforms);
		this.agents = [];
		this.density = 1;
		this.rain = false;
	}

	/**
	 * Drogi i perony (otwarty świat podmienia je przy przebudowie sieci z kafli); grafy kwadratów od nowa – piesi
	 * w drodze trzymają swój graf, aż znikną.
	 */
	setRoads(roads, platforms) {
		// drogi rozłożone po kwadratach (pierwszy punkt) – graf kwadratu budowany przy pierwszej potrzebie
		this.byChunk = new Map();
		for (const r of roads) {
			if (!WALK.has(r[0]) || r[3]) continue; // mosty pomijamy (pomost i chodnik nad terenem)
			const k = this.chunkKey(r[5][0] / 10, r[5][1] / 10);
			let a = this.byChunk.get(k);
			if (!a) this.byChunk.set(k, (a = []));
			a.push(r);
		}
		this.platforms = (platforms ?? []).map(([c]) => {
			const pts = [];
			for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
			return pts;
		});
		this.graphs = new Map();
	}

	chunkKey(x, z) { return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`; }

	/**
	 * Graf kwadratu (z dróg zaczynających się w nim – na granicy piesi zawracają); null – brak dróg. Budowa najwyżej
	 * jednego kwadratu na klatkę (do 40 ms w gęstym mieście), inaczej undefined – „jeszcze nie”.
	 */
	graph(k) {
		if (this.graphs.has(k)) return this.graphs.get(k);
		if (this.built) return undefined;
		this.built = true;
		const roads = this.byChunk.get(k) ?? [];
		const g = roads.length ? buildRoadGraph(roads, { maxClass: 7 }) : null;
		if (g) {
			// tylko krawędzie w zabudowie (chodniki wsi i miast); poza nią – rzadko
			g.walk = g.edges.filter((e) => {
				const m = e.pts.length >> 1;
				return this.coverAt(e.pts[(m >> 1) * 2], e.pts[(m >> 1) * 2 + 1]) === 'built' || e.cls === 7 && this.random() < 0.15;
			});
			g.walkLen = g.walk.reduce((a, e) => a + e.len, 0);
		}
		this.graphs.set(k, g);
		// pamięć: najwyżej 12 kwadratów
		if (this.graphs.size > 12) this.graphs.delete(this.graphs.keys().next().value);
		return g;
	}

	/** Nowy pieszy: na krawędzi w zabudowie w promieniu (losowo, wagą długości) albo czekający na peronie. */
	spawn(center) {
		const r = this.random;
		if (r() < 0.12 && this.platforms.length) {
			const pl = this.platforms[Math.floor(r() * this.platforms.length)];
			const i = Math.floor(r() * (pl.length / 2 - 1)) * 2;
			const t = r(), x = pl[i] + (pl[i + 2] - pl[i]) * t, z = pl[i + 1] + (pl[i + 3] - pl[i + 1]) * t;
			if ((x - center.x) ** 2 + (z - center.z) ** 2 > this.radius ** 2) return null;
			return this.add({ waiting: true, x: x + (r() - 0.5) * 2, z: z + (r() - 0.5) * 2, hx: Math.cos(r() * 6.3), hz: Math.sin(r() * 6.3), y: this.heightAt(x, z) + 0.76, v: 0 });
		}
		const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * this.radius;
		const px = center.x + Math.cos(ang) * d, pz = center.z + Math.sin(ang) * d;
		const g = this.graph(this.chunkKey(px, pz));
		if (!g?.walk.length) return null;
		// krawędź wagą długości: losowa długość wzdłuż listy
		let s = r() * g.walkLen, e = g.walk[0];
		for (const w of g.walk) { s -= w.len; if (s <= 0) { e = w; break; } }
		const a = { g, edge: e, dir: r() < 0.5 ? 1 : -1, s: r() * e.len, v: 1.1 + r() * 0.5, waiting: false };
		// ulica – chodnik po jednej stronie; ścieżka – blisko osi
		a.side = e.cls === 7 ? (r() - 0.5) * 1.2 : (r() < 0.5 ? -1 : 1) * (e.width / 2 + 1.3);
		this.place(a);
		if ((a.x - center.x) ** 2 + (a.z - center.z) ** 2 > this.radius ** 2) return null;
		return this.add(a);
	}

	add(a) {
		const r = this.random;
		a.phase = r() * 6.3;
		a.shirt = SHIRTS[Math.floor(r() * SHIRTS.length)];
		a.pants = PANTS[Math.floor(r() * PANTS.length)];
		a.umbrella = UMBRELLAS[Math.floor(r() * UMBRELLAS.length)];
		a.hasUmbrella = r() < 0.75;
		a.height = 1.6 + r() * 0.3;
		this.agents.push(a);
		return a;
	}

	place(a) {
		const e = a.edge, along = a.dir === 1 ? a.s : e.len - a.s;
		const p = pointAt(e, along);
		const hx = p.tx * a.dir, hz = p.tz * a.dir;
		// przesunięcie w bok względem osi krawędzi (stała strona ulicy niezależnie od kierunku chodu)
		a.x = p.x - p.tz * a.side;
		a.z = p.z + p.tx * a.side;
		a.hx = hx; a.hz = hz;
		a.y = this.heightAt(a.x, a.z);
	}

	/** Krok: center – punkt kamery na ziemi, low – 0..1 (jak nisko jest kamera: 1 – przy ziemi, 0 – za wysoko). */
	step(dt, center, low = 1) {
		this.built = false;
		const target = Math.round(this.max * this.density * low);
		for (let tries = 0; tries < 40 && this.agents.length < target; tries++) this.spawn(center);
		const R2 = (this.radius * 1.15) ** 2, r = this.random;
		const keep = [];
		for (const a of this.agents) {
			if (!a.waiting) {
				a.s += a.v * dt;
				a.phase += dt * a.v * 3.4;
				while (a.s > a.edge.len) {
					const rest = a.s - a.edge.len;
					const node = a.g.nodes[a.dir === 1 ? a.edge.b : a.edge.a];
					// piesi chodzą w obie strony niezależnie od jednokierunkowych (wszystkie krawędzie przy węźle); czasem zawracają
					const back = { edge: a.edge.id, dir: -a.dir };
					const all = this.both(a.g, node.id).filter((o) => o.edge !== a.edge.id);
					const pick = all.length && r() > 0.05 ? all[Math.floor(r() * all.length)] : back;
					a.edge = a.g.edges[pick.edge];
					a.dir = pick.dir;
					a.s = rest;
					if (a.edge.cls === 7) a.side = (r() - 0.5) * 1.2;
					else if (Math.abs(a.side) < 1.5) a.side = (r() < 0.5 ? -1 : 1) * (a.edge.width / 2 + 1.3);
				}
				this.place(a);
			} else a.phase = 0;
			if ((a.x - center.x) ** 2 + (a.z - center.z) ** 2 > R2 || keep.length >= target + 50) continue;
			keep.push(a);
		}
		this.agents = keep;
	}

	/** Wszystkie krawędzie przy węźle w obu kierunkach (piesi nie patrzą na jednokierunkowe). */
	both(g, nodeId) {
		if (!g.adj) {
			g.adj = new Map();
			for (const e of g.edges) {
				for (const [n, dir] of [[e.a, 1], [e.b, -1]]) {
					let l = g.adj.get(n);
					if (!l) g.adj.set(n, (l = []));
					l.push({ edge: e.id, dir });
				}
			}
		}
		return g.adj.get(nodeId) ?? [];
	}
}
