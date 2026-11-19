// Sygnalizacja świetlna na skrzyżowaniach w zabudowie z udziałem drogi krajowej albo wojewódzkiej (węzły z zebrami,
// src/gen/crossings.js): sygnalizator przy każdym wylocie, po prawej stronie jezdni. Cykl w shaderze (bez pracy CPU
// co klatkę): zielone, żółte, czerwone, czerwone z żółtym; poprzeczne wyloty w przeciwfazie. Nocą (23–5) część
// skrzyżowań przechodzi na pulsujące żółte.
import { Sprite, SpriteNodeMaterial, AdditiveBlending, InstancedBufferAttribute } from 'three/webgpu';
import { float, vec3, uv, dot, exp, max, cameraPosition, length, instancedBufferAttribute, clamp, fract, step, select, time, uniform, smoothstep } from 'three/tsl';
import { roadCrossings } from './gen/crossings.js';
import { onGround, towardCamera } from './gfx/ground.js';

const CYCLE = 36; // s

const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Sygnalizatory: [x, y, z, faza] (faza: przesunięcie skrzyżowania + 0,5 dla wylotów poprzecznych; część ułamkowa
 * ×1000 – los skrzyżowania do pulsowania nocą). */
export function signalPositions(roads, buildings, heightAt) {
	const byNode = new Map();
	for (const z of roadCrossings(roads, buildings, 1000)) {
		const k = `${z.at[0]},${z.at[1]}`;
		let a = byNode.get(k);
		if (!a) byNode.set(k, (a = []));
		a.push(z);
	}
	const out = [];
	for (const list of byNode.values()) {
		if (list.length < 3 || !list.some((z) => z.major)) continue;
		const [jx, jz] = list[0].at;
		if (hash(jx, jz) > 0.85) continue; // część skrzyżowań bez sygnalizacji
		const off = Math.floor(hash(jz, jx) * 1000) / 1000, flashy = hash(jx + 1, jz) < 0.6 ? 0.5 : 0;
		let ref = null;
		for (const z of list) {
			const mx = (z.pts[0] + z.pts[2]) / 2, mz = (z.pts[1] + z.pts[3]) / 2;
			const L = Math.hypot(mx - jx, mz - jz) || 1, ux = (mx - jx) / L, uz = (mz - jz) / L;
			ref ??= [ux, uz];
			const group = Math.abs(ux * ref[0] + uz * ref[1]) < 0.7 ? 0.5 : 0;
			// kierowca jedzie ku skrzyżowaniu (−u), prawa strona: (uz, −ux)
			const side = z.width / 2 + 1.2;
			const x = mx + uz * side + ux * 1.5, zz = mz - ux * side + uz * 1.5;
			const g = heightAt(x, zz);
			if (!Number.isFinite(g)) continue;
			out.push(x, g + 4.2, zz, (off + group) % 1 + flashy * 0.001);
		}
	}
	return new Float32Array(out);
}

export class SignalLights {
	constructor(cap = 20000) {
		this.cap = cap;
		this.pos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
		this.ph = new InstancedBufferAttribute(new Float32Array(cap), 1);
		this.pos.setUsage(35048); this.ph.setUsage(35048);
		this.flash = uniform(0); // 1 – nocne pulsowanie żółtego
	}

	/** Sprite poświat; glow – uniform jasności (zmierzch × adaptacja), camXZ – do krzywizny. */
	createSprite(glow, camXZ, pixelAngle) {
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
		const world = onGround(towardCamera(instancedBufferAttribute(this.pos)), camXZ);
		m.positionNode = world;
		const dist = length(cameraPosition.sub(world));
		const s = max(float(0.8), dist.mul(pixelAngle).mul(4)).min(30);
		m.scaleNode = vec3(s, s, 1).xy;
		const q = uv().sub(0.5).mul(2), r2 = dot(q, q);
		const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
		const ph = instancedBufferAttribute(this.ph);
		const t = fract(time.div(CYCLE).add(ph));
		const RED = vec3(1, 0.05, 0.02), YEL = vec3(1, 0.6, 0.04), GRN = vec3(0.15, 1, 0.55);
		const cyc = select(t.lessThan(0.42), GRN, select(t.lessThan(0.5), YEL, select(t.lessThan(0.94), RED, vec3(1, 0.3, 0.03))));
		const fr = fract(ph.mul(1000)), flashing = this.flash.mul(step(0.25, fr)).mul(step(fr, 0.75));
		const blink = smoothstep(0.1, 0.2, fract(time)).mul(smoothstep(0.55, 0.65, fract(time)).oneMinus());
		const col = select(flashing.greaterThan(0.5), YEL.mul(blink), cyc);
		m.colorNode = col.mul(f.mul(max(glow, 0.15)).mul(5).mul(exp(dist.mul(-1 / 5000))));
		this.sprite = new Sprite(m);
		this.sprite.count = 0;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 15;
		return this.sprite;
	}

	/** Zestaw sygnalizatorów z tablic signalPositions. */
	set(arrays) {
		const P = this.pos.array, F = this.ph.array;
		let n = 0;
		for (const d of arrays) for (let i = 0; i < d.length && n < this.cap; i += 4, n++) {
			P[n * 3] = d[i]; P[n * 3 + 1] = d[i + 1]; P[n * 3 + 2] = d[i + 2]; F[n] = d[i + 3];
		}
		if (this.sprite) this.sprite.count = n;
		this.pos.needsUpdate = this.ph.needsUpdate = true;
		return n;
	}

	/** Pulsujące żółte nocą (godzina lokalna). */
	update(hour) { const h = ((hour % 24) + 24) % 24; this.flash.value = h >= 23 || h < 5 ? 1 : 0; }
}
