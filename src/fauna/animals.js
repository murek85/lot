// Zwierzęta na ziemi wokół kamery: stada krów na pastwiskach (łąki przy wsiach, od wiosny do jesieni, w dzień)
// i sarny na skrajach lasów (o świcie i zmierzchu, cały rok). Krowy pasą się, z rzadka przechodzą kilka kroków;
// sarny skubią i uciekają do lasu przed nisko przelatującym samolotem. Logika bez Three.js (testowana w Node),
// widok – instancje prostych brył (jak pojazdy, src/traffic/render.js).
import { Vector2 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { makeKind } from '../traffic/render.js';

const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };
const COATS = { cow: [[0.04, 0.04, 0.04], [0.85, 0.84, 0.8], [0.32, 0.17, 0.08], [0.55, 0.32, 0.15]], deer: [[0.36, 0.22, 0.12], [0.3, 0.19, 0.1]] };

/** Które zwierzęta teraz: dzień roku, godzina, słońce (sun.y). */
export function animalWeights(day, hour, sunY) {
	const pasture = day >= 110 && day <= 295 && hour >= 7 && hour <= 20 && sunY > 0.05 ? 1 : 0;
	const twilight = sunY > -0.08 && sunY < 0.18 ? 1 : 0;
	return { cow: pasture, deer: twilight };
}

export class AnimalSim {
	/** opts: { groundAt, coverAt (→ nazwa klasy pokrycia), radius, seed }. */
	constructor(opts) {
		this.groundAt = opts.groundAt;
		this.coverAt = opts.coverAt;
		this.radius = opts.radius ?? 1500;
		this.random = rng(opts.seed ?? 777);
		this.groups = [];
		this.weights = { cow: 0, deer: 0 };
		this.t = 0;
	}

	get agents() { return this.groups.flatMap((g) => g.animals); }

	/** Nowe stado w losowym miejscu wokół środka – krowy na łące, sarny na polu lub łące przy lesie. */
	spawn(c) {
		const r = this.random, a = r() * Math.PI * 2, d = 200 + r() * (this.radius - 200);
		const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, cov = this.coverAt(x, z);
		let type = null;
		if (this.weights.cow && cov === 'grass') type = 'cow';
		else if (this.weights.deer && (cov === 'crop' || cov === 'grass')) {
			// skraj lasu: las w odległości do ~120 m
			for (let k = 0; k < 8 && !type; k++) { const b = (k / 8) * Math.PI * 2; if (this.coverAt(x + Math.cos(b) * 90, z + Math.sin(b) * 90) === 'forest') type = 'deer'; }
		}
		if (!type) return;
		const n = type === 'cow' ? 5 + Math.floor(r() * 14) : 2 + Math.floor(r() * 5);
		const g = { type, x, z, animals: [], scared: 0 };
		for (let i = 0; i < n; i++) {
			const ax = x + (r() - 0.5) * (type === 'cow' ? 60 : 25), az = z + (r() - 0.5) * (type === 'cow' ? 60 : 25), h = r() * Math.PI * 2;
			if (type === 'cow' && this.coverAt(ax, az) !== 'grass') continue; // krowy tylko na łące
			const coat = COATS[type][Math.floor(r() * COATS[type].length)];
			g.animals.push({ type, x: ax, z: az, y: this.groundAt(ax, az), hx: Math.sin(h), hz: -Math.cos(h), v: 0, walk: r() * 20, color: coat });
		}
		if (g.animals.length) this.groups.push(g);
	}

	/** Krok: c – środek (kamera), plane – { x, y, z } albo null (płoszy sarny). */
	step(dt, c, plane = null) {
		this.t += dt;
		const r = this.random, R2 = (this.radius * 1.3) ** 2;
		const target = (this.weights.cow ? 8 : 0) + (this.weights.deer ? 6 : 0);
		for (let k = 0; k < 4 && this.groups.length < target; k++) this.spawn(c);
		const keep = [];
		for (const g of this.groups) {
			if (!this.weights[g.type] || (g.x - c.x) ** 2 + (g.z - c.z) ** 2 > R2) continue;
			if (g.type === 'deer' && plane && g.scared <= 0 && Math.hypot(plane.x - g.x, plane.y - this.groundAt(g.x, g.z), plane.z - g.z) < 250) {
				g.scared = 8;
				// ucieczka: od samolotu
				const dx = g.x - plane.x, dz = g.z - plane.z, l = Math.hypot(dx, dz) || 1;
				g.fx = dx / l; g.fz = dz / l;
			}
			if (g.scared > 0) g.scared -= dt;
			let cx = 0, cz = 0;
			for (const a of g.animals) {
				if (g.scared > 0) {
					a.hx += (g.fx - a.hx) * Math.min(1, dt * 4); a.hz += (g.fz - a.hz) * Math.min(1, dt * 4);
					a.v = 11;
				} else {
					// pasienie: postój, z rzadka kilka kroków w nowym kierunku
					a.walk -= dt;
					if (a.walk <= 0) {
						a.walk = (g.type === 'cow' ? 15 : 6) + r() * 20;
						const h = Math.atan2(a.hx, -a.hz) + (r() - 0.5) * 2;
						a.hx = Math.sin(h); a.hz = -Math.cos(h);
						a.v = r() < 0.5 ? (g.type === 'cow' ? 0.6 : 1.2) : 0;
						// krowa nie schodzi z pastwiska: przed nią nie łąka – zawraca w stronę stada
						if (g.type === 'cow' && this.coverAt(a.x + a.hx * 8, a.z + a.hz * 8) !== 'grass') {
							const dx = g.x - a.x, dz = g.z - a.z, l = Math.hypot(dx, dz) || 1;
							a.hx = dx / l; a.hz = dz / l;
						}
					}
					if (a.walk < 3) a.v = 0;
				}
				const l = Math.hypot(a.hx, a.hz) || 1;
				a.hx /= l; a.hz /= l;
				a.x += a.hx * a.v * dt; a.z += a.hz * a.v * dt;
				a.y = this.groundAt(a.x, a.z);
				cx += a.x; cz += a.z;
			}
			g.x = cx / g.animals.length; g.z = cz / g.animals.length;
			keep.push(g);
		}
		this.groups = keep;
	}
}

/** Bryły: x – w prawo, z – do przodu, y – w górę; kolor 1,1,1 – maść instancji. */
function animalGeometry(type) {
	const b = new GeoBuilder(), W = [1, 1, 1];
	const box = (x0, x1, y0, y1, z0, z1, col = W) => b.beam((x0 + x1) / 2, z0, (x0 + x1) / 2, z1, x1 - x0, y0, y1, col);
	if (type === 'cow') {
		box(-0.38, 0.38, 0.75, 1.4, -0.95, 0.95); // tułów
		box(-0.2, 0.2, 1.05, 1.45, 0.95, 1.5); // głowa (spuszczona – pasie się)
		box(-0.12, 0.12, 0.95, 1.15, 1.45, 1.62, [0.75, 0.6, 0.55]); // pysk
		for (const [x, z] of [[-0.26, -0.75], [0.26, -0.75], [-0.26, 0.75], [0.26, 0.75]]) box(x - 0.08, x + 0.08, 0, 0.8, z - 0.08, z + 0.08);
		box(-0.25, 0.25, 0.68, 0.8, -0.55, -0.25, [0.85, 0.7, 0.65]); // wymię
	} else {
		box(-0.17, 0.17, 0.55, 0.92, -0.55, 0.55); // tułów
		box(-0.16, 0.16, 0.58, 0.88, -0.62, -0.5, [0.9, 0.88, 0.85]); // biały „lustro”
		box(-0.07, 0.07, 0.85, 1.25, 0.45, 0.62); // szyja
		box(-0.09, 0.09, 1.15, 1.32, 0.55, 0.85); // głowa
		for (const [x, z] of [[-0.11, -0.42], [0.11, -0.42], [-0.11, 0.42], [0.11, 0.42]]) box(x - 0.035, x + 0.035, 0, 0.6, z - 0.035, z + 0.035);
	}
	return b;
}

/** Widok: dwa rodzaje instancji; update(camera) – pozycje z symulacji. */
export function createAnimalView(sim, atmo, clouds, plane, cap = 400) {
	const camXZ = uniform(new Vector2());
	const kinds = { cow: makeKind('cow', cap, atmo, clouds, plane, camXZ, animalGeometry('cow')), deer: makeKind('deer', cap, atmo, clouds, plane, camXZ, animalGeometry('deer')) };
	return {
		objects: Object.values(kinds).map((k) => k.mesh),
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			const n = { cow: 0, deer: 0 };
			for (const a of sim.agents) {
				const k = kinds[a.type], i = n[a.type];
				if (i >= cap) continue;
				n[a.type]++;
				k.pos.array.set([a.x, a.y, a.z], i * 3);
				k.dir.array.set([a.hx, a.hz], i * 2);
				k.col.array.set(a.color, i * 3);
			}
			for (const [t, k] of Object.entries(kinds)) {
				k.g.instanceCount = n[t];
				for (const at of [k.pos, k.dir, k.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n[t] * at.itemSize); }
				k.mesh.visible = n[t] > 0;
			}
		},
	};
}
