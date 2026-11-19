// Komunikacja miejska wokół kamery: tramwaje na torowiskach (jadą po kolejnych odcinkach, na końcu linii zawracają,
// co ~600 m stają na przystanku) i autobusy stojące na przystankach (co kilka minut, w dzień). Logika bez Three.js
// (testowana w Node), widok – instancje brył jak pojazdy (src/traffic/render.js).
import { Vector2 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { makeKind } from './render.js';

const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };
const TRAM_COLS = [[0.75, 0.12, 0.08], [0.85, 0.65, 0.1], [0.15, 0.35, 0.65], [0.9, 0.9, 0.88]];
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Polilinia [x0, z0, x1, z1, …] (m) → { p, cum (długości narastająco), len }. */
function track(p) {
	const cum = [0];
	for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
	return { p, cum, len: cum[cum.length - 1] };
}

const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)},${p[p.length - 2].toFixed(1)},${p[p.length - 1].toFixed(1)},${p.length}`;

/** Punkt i kierunek na torze w odległości s. */
function at(t, s) {
	let i = 1;
	while (i < t.cum.length - 1 && t.cum[i] < s) i++;
	const k = (s - t.cum[i - 1]) / ((t.cum[i] - t.cum[i - 1]) || 1), p = t.p;
	const dx = p[i * 2] - p[i * 2 - 2], dz = p[i * 2 + 1] - p[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
	return { x: p[i * 2 - 2] + dx * k, z: p[i * 2 - 1] + dz * k, hx: dx / l, hz: dz / l };
}

export class TransitSim {
	/** opts: { groundAt, seed }. */
	constructor(opts) {
		this.groundAt = opts.groundAt;
		this.random = rng(opts.seed ?? 31);
		this.tracks = []; // torowiska w pobliżu
		this.stops = []; // przystanki: { x, z, hx, hz }
		this.trams = [];
		this.buses = [];
		this.active = true; // w dzień i wieczorem
		this.t = 0;
	}

	/** Nowe torowiska (linie w metrach) – tramwaje na starych torach zostają, jeśli ich tor nadal jest. */
	setTracks(lines) {
		// ten sam odcinek (te same końce) – ten sam obiekt toru, żeby tramwaje na nim zostały
		const old = new Map(this.tracks.map((t) => [key(t.p), t]));
		this.tracks = lines.filter((p) => p.length >= 4).map((p) => old.get(key(p)) ?? track(p)).filter((t) => t.len > 30);
		const keep = new Set(this.tracks);
		this.trams = this.trams.filter((a) => keep.has(a.track));
	}

	/** Następny tor przy końcu (wspólny punkt ±4 m) albo null. */
	next(t, end) {
		const ex = end ? t.p[t.p.length - 2] : t.p[0], ez = end ? t.p[t.p.length - 1] : t.p[1];
		const c = [];
		for (const o of this.tracks) {
			if (o === t) continue;
			if (Math.hypot(o.p[0] - ex, o.p[1] - ez) < 4) c.push([o, 1]);
			else if (Math.hypot(o.p[o.p.length - 2] - ex, o.p[o.p.length - 1] - ez) < 4) c.push([o, -1]);
		}
		return c.length ? c[Math.floor(this.random() * c.length)] : null;
	}

	step(dt, c) {
		this.t += dt;
		const r = this.random;
		// tramwaje: ~1 na 1,2 km toru, najwyżej 10
		const total = this.tracks.reduce((s, t) => s + t.len, 0);
		const want = this.active ? Math.min(10, Math.floor(total / 1200)) : 0;
		if (this.trams.length < want && this.tracks.length && r() < dt) {
			const t = this.tracks[Math.floor(r() * this.tracks.length)];
			this.trams.push({ track: t, s: r() * t.len, dir: r() < 0.5 ? 1 : -1, v: 0, wait: 0, nextStop: 200 + r() * 600, color: TRAM_COLS[Math.floor(r() * TRAM_COLS.length)] });
		}
		if (this.trams.length > want) this.trams.length = want;
		for (const a of this.trams) {
			if (a.wait > 0) { a.wait -= dt; a.v = 0; } else {
				a.v = Math.min(11, a.v + 1.1 * dt);
				const d = a.v * dt;
				a.s += d * a.dir;
				a.nextStop -= d;
				if (a.nextStop <= 0) { a.wait = 12 + r() * 10; a.nextStop = 450 + r() * 350; }
				if (a.s < 0 || a.s > a.track.len) {
					const n = this.next(a.track, a.s > a.track.len);
					if (n) { const [o, dir] = n; a.track = o; a.dir = dir; a.s = dir > 0 ? 0 : o.len; }
					else { a.dir = -a.dir; a.s = Math.max(0, Math.min(a.track.len, a.s)); a.wait = 30; } // pętla – postój i powrót
				}
			}
			const p = at(a.track, a.s);
			a.x = p.x; a.z = p.z; a.hx = p.hx * a.dir; a.hz = p.hz * a.dir;
			a.y = this.groundAt(a.x, a.z);
		}
		// autobusy: przystanki do ~1,5 km, autobus co ~4 min na ~30 s (faza z położenia przystanku)
		this.buses.length = 0;
		if (this.active) for (const s of this.stops) {
			if (Math.hypot(s.x - c.x, s.z - c.z) > 1500) continue;
			const ph = (this.t / 240 + hash(s.x, s.z)) % 1;
			if (ph > 0.12) continue;
			const col = [[0.75, 0.15, 0.1], [0.15, 0.3, 0.6], [0.85, 0.78, 0.2]][Math.floor(hash(s.z, s.x) * 3)];
			this.buses.push({ x: s.x, z: s.z, y: this.groundAt(s.x, s.z), hx: s.hx, hz: s.hz, color: col });
		}
	}
}

function tramGeometry() {
	const b = new GeoBuilder(), P = [1, 1, 1], G = [0.05, 0.06, 0.07], W = [0.85, 0.86, 0.86], D = [0.1, 0.1, 0.1];
	const box = (x0, x1, y0, y1, z0, z1, col) => b.beam((x0 + x1) / 2, z0, (x0 + x1) / 2, z1, x1 - x0, y0, y1, col);
	box(-1.2, 1.2, 0.4, 1.2, -15, 15, P); // pas pod oknami w barwach
	box(-1.22, 1.22, 1.2, 2.5, -15, 15, G); // okna
	box(-1.2, 1.2, 2.5, 3.3, -15, 15, W); // dach
	box(-0.4, 0.4, 3.3, 3.5, -2, 2, D); // pantograf (podstawa)
	box(-1.25, 1.25, 0.1, 0.4, -14, 14, D);
	return b;
}

export function createTransitView(sim, atmo, clouds, plane, cap = 48) {
	const camXZ = uniform(new Vector2());
	const kinds = { tram: makeKind('tram', cap, atmo, clouds, plane, camXZ, tramGeometry()), bus: makeKind('bus', cap, atmo, clouds, plane, camXZ) };
	return {
		objects: Object.values(kinds).map((k) => k.mesh),
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			for (const [name, list] of [['tram', sim.trams], ['bus', sim.buses]]) {
				const k = kinds[name];
				let n = 0;
				for (const a of list) {
					if (n >= cap || a.x === undefined) continue;
					k.pos.array.set([a.x, a.y, a.z], n * 3);
					k.dir.array.set([a.hx, a.hz], n * 2);
					k.col.array.set(a.color, n * 3);
					n++;
				}
				k.g.instanceCount = n;
				for (const at of [k.pos, k.dir, k.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n * at.itemSize); }
				k.mesh.visible = n > 0;
			}
		},
	};
}
