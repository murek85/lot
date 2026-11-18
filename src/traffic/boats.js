// Łodzie na wodach wokół kamery: żaglówki i motorówki na jeziorach (od maja do września, w dzień), barki
// (cały rok poza zimą). Płyną prosto, przed brzegiem skręcają tam, gdzie dalej jest woda; za rufą kilwater (biała „V”
// w bryle). Logika bez Three.js (testowana w Node), widok – instancje brył jak pojazdy.
import { Vector2 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { makeKind } from './render.js';

const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };
export const BOAT_KINDS = { sail: { speed: 3, look: 25 }, motor: { speed: 9, look: 40 }, barge: { speed: 3, look: 90 } };
const HULLS = { sail: [[0.9, 0.9, 0.88], [0.15, 0.25, 0.5], [0.6, 0.1, 0.08]], motor: [[0.92, 0.92, 0.9], [0.1, 0.12, 0.15], [0.7, 0.55, 0.1]], barge: [[0.12, 0.13, 0.15], [0.35, 0.12, 0.08]] };

/** Ile łodzi teraz: dzień roku, słońce (sun.y). */
export function boatTargets(day, sunY) {
	const summer = day >= 125 && day <= 265 && sunY > 0.05;
	return { sail: summer ? 8 : 0, motor: summer ? 4 : 0, barge: day >= 60 && day <= 340 ? 2 : 0 };
}

export class BoatSim {
	/** opts: { groundAt, coverAt (→ nazwa klasy), radius }. */
	constructor(opts) {
		this.groundAt = opts.groundAt;
		this.coverAt = opts.coverAt;
		this.radius = opts.radius ?? 3000;
		this.random = rng(opts.seed ?? 99);
		this.boats = [];
		this.targets = { sail: 0, motor: 0, barge: 0 };
	}

	water(x, z) { return this.coverAt(x, z) === 'water'; }

	spawn(kind, c) {
		const r = this.random, a = r() * Math.PI * 2, d = 300 + r() * (this.radius - 300);
		const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
		// woda dookoła (nie przy samym brzegu): 4 punkty w odległości ~zasięgu wzroku łodzi
		const L = BOAT_KINDS[kind].look;
		if (!this.water(x, z) || ![0, 1, 2, 3].every((k) => this.water(x + Math.cos(k * 1.57) * L, z + Math.sin(k * 1.57) * L))) return;
		const h = r() * Math.PI * 2, cols = HULLS[kind];
		this.boats.push({ kind, x, z, y: this.groundAt(x, z), hx: Math.sin(h), hz: -Math.cos(h), color: cols[Math.floor(r() * cols.length)], turn: 0 });
	}

	step(dt, c) {
		const count = { sail: 0, motor: 0, barge: 0 };
		for (const b of this.boats) count[b.kind]++;
		for (const k of Object.keys(BOAT_KINDS)) for (let i = 0; i < 3 && count[k] < this.targets[k]; i++) { const n = this.boats.length; this.spawn(k, c); if (this.boats.length > n) count[k]++; }
		const r = this.random, R2 = (this.radius * 1.3) ** 2, keep = [];
		for (const b of this.boats) {
			if (!this.targets[b.kind] || (b.x - c.x) ** 2 + (b.z - c.z) ** 2 > R2) continue;
			const K = BOAT_KINDS[b.kind];
			// przed dziobem brzeg – nowy kurs: najmniejszy skręt, przy którym dalej jest woda
			if (!this.water(b.x + b.hx * K.look, b.z + b.hz * K.look)) {
				const h0 = Math.atan2(b.hx, -b.hz), side = r() < 0.5 ? 1 : -1;
				let ok = false;
				for (let k = 1; k <= 6 && !ok; k++) for (const s of [side, -side]) {
					const h = h0 + s * k * 0.5;
					if (this.water(b.x + Math.sin(h) * K.look, b.z - Math.cos(h) * K.look)) { b.hx = Math.sin(h); b.hz = -Math.cos(h); ok = true; break; }
				}
				if (!ok) continue; // uwięziona – znika
			}
			b.x += b.hx * K.speed * dt; b.z += b.hz * K.speed * dt;
			b.y = this.groundAt(b.x, b.z);
			keep.push(b);
		}
		this.boats = keep;
	}
}

function boatGeometry(kind) {
	const b = new GeoBuilder(), P = [1, 1, 1], FOAM = [0.82, 0.85, 0.86], WH = [0.88, 0.88, 0.86];
	const box = (x0, x1, y0, y1, z0, z1, col) => b.beam((x0 + x1) / 2, z0, (x0 + x1) / 2, z1, x1 - x0, y0, y1, col);
	const wake = (w, len, spread) => { for (const s of [-1, 1]) b.beam(s * w * 0.5, -1, s * spread, -len, w * 0.35, 0.02, 0.07, FOAM); };
	if (kind === 'sail') {
		box(-0.9, 0.9, -0.2, 0.6, -3, 3, P);
		box(-0.06, 0.06, 0.6, 10, 0.5, 0.7, WH); // maszt
		box(-0.03, 0.03, 1.4, 9.5, -2.4, 0.5, WH); // grot
		box(-0.03, 0.03, 1.2, 7.5, 0.8, 2.8, WH); // fok
		wake(1.4, 18, 4);
	} else if (kind === 'motor') {
		box(-1.1, 1.1, -0.2, 0.8, -3, 3.2, P);
		box(-0.8, 0.8, 0.8, 1.6, -1.2, 0.8, WH);
		wake(1.8, 45, 12);
	} else {
		box(-5, 5, -0.5, 1.6, -40, 38, P);
		box(-4.6, 4.6, 1.6, 2.4, -32, 30, [0.3, 0.25, 0.18]); // ładunek
		box(-3.5, 3.5, 1.6, 6.5, -40, -34, WH); // sterówka
		wake(8, 70, 18);
	}
	return b;
}

export function createBoatView(sim, atmo, clouds, plane, cap = 64) {
	const camXZ = uniform(new Vector2());
	const kinds = Object.fromEntries(Object.keys(BOAT_KINDS).map((k) => [k, makeKind(k, cap, atmo, clouds, plane, camXZ, boatGeometry(k))]));
	return {
		objects: Object.values(kinds).map((k) => k.mesh),
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			const n = { sail: 0, motor: 0, barge: 0 };
			for (const b of sim.boats) {
				const k = kinds[b.kind], i = n[b.kind];
				if (i >= cap) continue;
				n[b.kind]++;
				k.pos.array.set([b.x, b.y, b.z], i * 3);
				k.dir.array.set([b.hx, b.hz], i * 2);
				k.col.array.set(b.color, i * 3);
			}
			for (const [t, k] of Object.entries(kinds)) {
				k.g.instanceCount = n[t];
				for (const at of [k.pos, k.dir, k.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n[t] * at.itemSize); }
				k.mesh.visible = n[t] > 0;
			}
		},
	};
}
