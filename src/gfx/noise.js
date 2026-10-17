// Szumy proceduralne w TSL (tanie, deterministyczne): hash, szum wartości, fbm i komórki Woronoja.
import { Fn, float, vec2, vec3, floor, fract, dot, mix, sqrt, If } from 'three/tsl';

// Hash komórki → 0..1 („Hash without Sine”, D. Hoskins) – stabilny na GPU także daleko od środka.
export const hash12 = Fn(([p]) => {
	const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
	p3.addAssign(dot(p3, p3.yzx.add(33.33)));
	return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const hash22 = Fn(([p]) => {
	const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
	p3.addAssign(dot(p3, p3.yzx.add(33.33)));
	return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'hash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

/** Szum wartości 0..1 z gładką interpolacją. */
export const valueNoise = Fn(([p]) => {
	const i = floor(p);
	const f = fract(p);
	const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
	const a = hash12(i);
	const b = hash12(i.add(vec2(1, 0)));
	const c = hash12(i.add(vec2(0, 1)));
	const d = hash12(i.add(vec2(1, 1)));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'valueNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** fbm 0..1 – oktawy rozwijane w JS (stała liczba). */
export function fbm(p, octaves = 4) {
	let sum = float(0), amp = 0.5, norm = 0, q = p;
	for (let o = 0; o < octaves; o++) {
		sum = sum.add(valueNoise(q).mul(amp));
		norm += amp;
		amp *= 0.5;
		q = q.mul(2.03).add(vec2(17.1, 9.3));
	}
	return sum.div(norm);
}

/** Komórki Woronoja: x = odległość do najbliższego punktu, y = do drugiego, z = losowa wartość komórki 0..1. */
export const voronoi = Fn(([p]) => {
	const cell = floor(p);
	const f = fract(p);
	const d1 = float(8).toVar(), d2 = float(8).toVar(), id = float(0).toVar();
	for (let y = -1; y <= 1; y++) {
		for (let x = -1; x <= 1; x++) {
			const o = vec2(x, y);
			const c = cell.add(o);
			const pt = o.add(hash22(c).mul(0.85).add(0.075));
			const r = pt.sub(f);
			const d = dot(r, r);
			If(d.lessThan(d1), () => {
				d2.assign(d1);
				d1.assign(d);
				id.assign(hash12(c.add(vec2(31.7, 11.3))));
			}).ElseIf(d.lessThan(d2), () => {
				d2.assign(d);
			});
		}
	}
	return vec3(sqrt(d1), sqrt(d2), id);
}).setLayout({ name: 'voronoi', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

