// Światła z kalendarza: znicze na cmentarzach (Wszystkich Świętych – morze czerwonych i bursztynowych płomyków,
// przez cały rok tylko pojedyncze) i grudniowe iluminacje ulic (od 6 grudnia do Trzech Króli: kolorowe, migoczące
// światełka przy latarniach w zabudowie). Jeden sprite z instancjami; które świecą – w shaderze (los światła
// poniżej natężenia z daty), bez przebudowy buforów przy zmianie dnia.
import { Sprite, SpriteNodeMaterial, AdditiveBlending, InstancedBufferAttribute } from 'three/webgpu';
import { float, vec3, uv, dot, exp, max, cameraPosition, length, instancedBufferAttribute, clamp, fract, step, select, time, uniform, sin, mix } from 'three/tsl';
import { onGround } from './gfx/ground.js';
import { pointInRing } from './buildgeo.js';

export const CAL = { candle: 0, festive: 1 };
const STRIDE = 5; // x, y, z, rodzaj, los

const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Natężenie zniczy (odsetek zapalonych) w dniu roku i godzinie: 31 X wieczorem – 2 XI, potem gasną. */
export function candlesOn(day, hour) {
	const t = day + hour / 24;
	if (t >= 304.6 && t < 305) return 0.5; // wigilia Wszystkich Świętych – wieczorem
	if (t >= 305 && t < 306) return 1;
	if (t >= 306 && t < 307) return 0.85; // Zaduszki
	if (t >= 307 && t < 310) return 0.85 - (t - 307) * 0.25; // dopalają się
	return 0.03; // przez cały rok – pojedyncze znicze
}

/** Iluminacje świąteczne: 6 XII – 6 I (dzień roku). */
export const festiveOn = (day) => (day >= 340 || day <= 6 ? 1 : 0);

/**
 * Znicze na cmentarzach: obrysy [pierścień w dm, …] → punkty co ~5 m² (najwyżej 1500 na cmentarz), 0,4 m nad
 * ziemią. heightAt(x, z) – teren.
 */
export function candlePositions(cemeteries, heightAt, out = []) {
	for (const ring of cemeteries) {
		let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
		for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
		const w = (x1 - x0) / 10, h = (z1 - z0) / 10;
		const n = Math.min(1500, Math.round((w * h) / 5));
		for (let k = 0; k < n; k++) {
			const x = x0 / 10 + hash(k, x0) * w, z = z0 / 10 + hash(z0, k + 0.5) * h;
			if (!pointInRing(ring, x * 10, z * 10)) continue;
			const g = heightAt(x, z);
			if (Number.isFinite(g)) out.push(x, g + 0.4, z, CAL.candle, hash(x, z));
		}
	}
	return out;
}

/** Iluminacje: przy co drugiej latarni (lamps – [x, y, z, rodzaj] co 4) kolorowe światełko 1,5 m niżej, z boku. */
export function festivePositions(lamps, out = []) {
	for (let i = 0; i < lamps.length; i += 4) {
		const x = lamps[i], z = lamps[i + 2], h = hash(x, z);
		if (h < 0.5 && lamps[i + 3] < 2) out.push(x + 0.8, lamps[i + 1] - 1.5, z, CAL.festive, h * 2);
	}
	return out;
}

export class CalendarLights {
	constructor(cap = 120000) {
		this.cap = cap;
		this.pos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
		this.par = new InstancedBufferAttribute(new Float32Array(cap * 2), 2); // rodzaj, los
		this.pos.setUsage(35048); this.par.setUsage(35048);
		this.candles = uniform(0.03);
		this.festive = uniform(0);
	}

	createSprite(glow, camXZ, pixelAngle) {
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
		const world = onGround(instancedBufferAttribute(this.pos), camXZ);
		m.positionNode = world;
		const P = instancedBufferAttribute(this.par), kind = P.x, seed = P.y;
		const isCandle = kind.lessThan(0.5);
		const dist = length(cameraPosition.sub(world));
		const s = max(select(isCandle, float(0.4), float(1)), dist.mul(pixelAngle).mul(select(isCandle, float(2.2), float(3.5)))).min(20);
		m.scaleNode = vec3(s, s, 1).xy;
		const q = uv().sub(0.5).mul(2), r2 = dot(q, q);
		const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
		// znicze: czerwone i bursztynowe, migoczą; iluminacje: złote, białe, niebieskie, czerwone, zielone – mrugają
		const flick = sin(time.mul(9).add(seed.mul(80))).mul(0.15).add(sin(time.mul(23).add(seed.mul(31))).mul(0.1)).add(0.85);
		const candleC = mix(vec3(1, 0.12, 0.04), vec3(1, 0.5, 0.12), step(0.6, fract(seed.mul(17.3)))).mul(flick);
		const fh = fract(seed.mul(7.7));
		const festC = select(fh.lessThan(0.35), vec3(1, 0.7, 0.25), select(fh.lessThan(0.55), vec3(0.9, 0.92, 1), select(fh.lessThan(0.75), vec3(0.25, 0.45, 1),
			select(fh.lessThan(0.88), vec3(1, 0.15, 0.1), vec3(0.2, 1, 0.35)))));
		const twinkle = step(0.25, fract(time.mul(0.7).add(seed.mul(13)))).mul(0.7).add(0.3);
		const on = select(isCandle, step(seed, this.candles), this.festive);
		const col = select(isCandle, candleC.mul(1.3), festC.mul(twinkle).mul(1.8));
		// znicze z daleka – łuna (gasną wolniej niż pojedynczy punkt), iluminacje – do ~6 km
		m.colorNode = col.mul(f.mul(on).mul(max(glow, 0.1)).mul(4).mul(exp(dist.mul(select(isCandle, float(-1 / 9000), float(-1 / 6000))))));
		this.sprite = new Sprite(m);
		this.sprite.count = 0;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 15;
		return this.sprite;
	}

	/** Zestaw świateł z tablic (candlePositions, festivePositions). */
	set(arrays) {
		const P = this.pos.array, F = this.par.array;
		let n = 0;
		for (const d of arrays) for (let i = 0; i < d.length && n < this.cap; i += STRIDE, n++) {
			P[n * 3] = d[i]; P[n * 3 + 1] = d[i + 1]; P[n * 3 + 2] = d[i + 2]; F[n * 2] = d[i + 3]; F[n * 2 + 1] = d[i + 4];
		}
		if (this.sprite) this.sprite.count = n;
		this.pos.needsUpdate = this.par.needsUpdate = true;
		return n;
	}

	update(day, hour) { this.candles.value = candlesOn(day, hour); this.festive.value = festiveOn(day); }
}
