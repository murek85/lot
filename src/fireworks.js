// Fajerwerki w noc sylwestrową (31 XII 23:40 – 1 I 0:50, najwięcej tuż po północy): wybuchy nad osadami wokół
// kamery – kula iskier rozlatujących się z oporem powietrza i opadających, gasnących z migotaniem. Miejsca startu –
// latarnie w zabudowie. Na CPU tylko przydział wybuchów do gniazd (środek, czas, barwa); tor iskier liczy shader.
// Nakładka po wygładzaniu (jak dym, src/smoke.js) – widać je na tle nieba; mieszanie addytywne.
import { Sprite, SpriteNodeMaterial, InstancedBufferAttribute, CustomBlending, OneFactor, ZeroFactor, AddEquation, Vector2 } from 'three/webgpu';
import {
	Fn, vec2, vec3, vec4, float, uniform, instancedBufferAttribute, varying, uv, dot, max, sin, cos, exp, length, smoothstep, clamp, fract,
	cameraPosition, cameraViewMatrix, screenUV, getViewPosition, If, Discard, sqrt, hash, instanceIndex,
} from 'three/tsl';
import { onGround } from './gfx/ground.js';

const SPARKS = 72, SLOTS = 48, LIFE = 3.2; // iskier na wybuch, wybuchów naraz, czas życia (s)
const COLORS = [[1, 0.25, 0.15], [1, 0.75, 0.25], [0.3, 1, 0.4], [0.35, 0.55, 1], [1, 0.35, 0.9], [1, 1, 0.9], [1, 0.55, 0.1]];

/** Natężenie pokazu 0..1 w dniu roku i godzinie (szczyt 0:00–0:15). */
export function fireworksRate(day, hour) {
	if (day === 365 && hour >= 23.6) return (hour - 23.6) / 0.4 * 0.5;
	if (day === 1 && hour < 0.85) return hour < 0.25 ? 1 : 1 - (hour - 0.25) / 0.6;
	return 0;
}

export class Fireworks {
	constructor(pixelAngle) {
		this.pixelAngle = pixelAngle;
		this.camXZ = uniform(new Vector2());
		this.now = uniform(0);
		const n = SLOTS * SPARKS;
		this.burst = new InstancedBufferAttribute(new Float32Array(n * 4), 4); // środek x, y, z, czas wybuchu
		this.look = new InstancedBufferAttribute(new Float32Array(n * 4), 4); // barwa, prędkość
		this.burst.setUsage(35048); this.look.setUsage(35048);
		this.slots = Array.from({ length: SLOTS }, () => ({ end: -1 }));
		this.t = 0;
	}

	build(depthNode, projInv, scene) {
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
		// dodawanie światła; krycie (alfa) celu bez zmian – nakładka nie przyciemnia tła
		Object.assign(m, { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor });
		const B = instancedBufferAttribute(this.burst), Lk = instancedBufferAttribute(this.look);
		const t = this.now.sub(B.w);
		// kierunek iskry: równomiernie na sferze z numeru instancji
		const k = float(instanceIndex);
		const u = hash(k.mul(1.37)).mul(2).sub(1), ph = hash(k.mul(2.91).add(7)).mul(6.2832);
		const rr = sqrt(float(1).sub(u.mul(u)));
		const dirS = vec3(rr.mul(cos(ph)), u, rr.mul(sin(ph)));
		// opór: droga v/k·(1 − e^(−k t)), grawitacja – opadanie
		const v0 = Lk.w.mul(hash(k.mul(5.3)).mul(0.3).add(0.85));
		const dragK = 1.1;
		const dist0 = v0.div(dragK).mul(float(1).sub(exp(t.mul(-dragK))));
		const p = B.xyz.add(dirS.mul(dist0)).sub(vec3(0, t.mul(t).mul(2.2), 0));
		const world = onGround(p, this.camXZ);
		m.positionNode = world;
		const dist = length(cameraPosition.sub(world));
		const s = max(float(2.5), dist.mul(this.pixelAngle).mul(4));
		m.scaleNode = vec2(s, s);
		const alive = smoothstep(0, 0.05, t).mul(smoothstep(LIFE * 0.55, LIFE, t).oneMinus());
		const twinkle = smoothstep(1.4, 2.2, t).mul(sin(t.mul(40).add(k)).mul(0.5).add(0.5)).add(smoothstep(1.4, 2.2, t).oneMinus());
		const vFade = varying(alive.mul(twinkle).mul(exp(dist.mul(-1 / 12000))), 'vFwFade');
		const vCol = varying(Lk.xyz.mul(float(1).add(smoothstep(0.3, 0, t).mul(3))), 'vFwCol'); // błysk wybuchu – biel
		const vViewZ = varying(cameraViewMatrix.mul(vec4(world, 1)).z, 'vFwViewZ');
		m.colorNode = Fn(() => {
			const d = depthNode.sample(screenUV).r;
			If(d.greaterThan(0).and(vViewZ.lessThan(getViewPosition(screenUV, d, projInv).z)), () => { Discard(); });
			const q = uv().sub(0.5).mul(2), r2 = dot(q, q);
			const f = exp(r2.mul(-9)).mul(clamp(float(1).sub(r2), 0, 1));
			return vec4(vCol.mul(f).mul(vFade).mul(16), 0);
		})();
		this.sprite = new Sprite(m);
		this.sprite.count = SLOTS * SPARKS;
		this.sprite.frustumCulled = false;
		this.sprite.visible = false;
		scene.add(this.sprite);
	}

	/**
	 * dt (s), kamera, natężenie pokazu 0..1, sites() – kandydaci na miejsca startu [[x, y, z], …] (latarnie wokół).
	 */
	update(dt, camera, rate, sites) {
		if (!this.sprite) return;
		this.camXZ.value.set(camera.position.x, camera.position.z);
		this.t += dt;
		this.now.value = this.t;
		const busy = this.slots.some((s) => s.end > this.t);
		this.sprite.visible = rate > 0 || busy;
		if (rate <= 0) return;
		const B = this.burst.array, Lk = this.look.array;
		let changed = false, cand = null;
		for (let i = 0; i < SLOTS; i++) {
			const sl = this.slots[i];
			if (sl.end > this.t || Math.random() > rate * dt * 0.9) continue;
			cand ??= sites();
			if (!cand.length) return;
			const [x, y, z] = cand[Math.floor(Math.random() * cand.length)];
			const h = 70 + Math.random() * 110, c = COLORS[Math.floor(Math.random() * COLORS.length)], v = 45 + Math.random() * 30;
			sl.end = this.t + LIFE;
			for (let j = i * SPARKS; j < (i + 1) * SPARKS; j++) {
				B.set([x + (Math.random() - 0.5) * 30, y + h, z + (Math.random() - 0.5) * 30, this.t], j * 4);
				Lk.set([c[0], c[1], c[2], v], j * 4);
			}
			changed = true;
		}
		if (changed) this.burst.needsUpdate = this.look.needsUpdate = true;
	}
}
