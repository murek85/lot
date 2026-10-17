// Kafelkowana mapa fal jezior (liczona raz na CPU): suma kilkudziesięciu fal sinusoidalnych o całkowitych wektorach
// falowych (dzięki temu bez szwów), z widmem malejącym jak u fal wiatrowych i przewagą kierunku wiatru.
// Kanały: R, G – nachylenie w x i z (0..255 ↔ −1..1 po normalizacji), B – wysokość (do piany na grzbietach).
import { rng } from '../clouds/noise3d.js';

export function waveMap(n = 256, seed = 5, count = 40, windAngle = 0.4) {
	const r = rng(seed);
	const waves = [];
	for (let i = 0; i < count; i++) {
		// długość fali od całego kafelka do ~1/28 kafelka, kierunki skupione wokół wiatru (±70°)
		const cycles = 1 + Math.floor(Math.pow(r(), 1.6) * 27);
		const ang = windAngle + (r() - 0.5) * 2.4;
		let kx = Math.round(Math.cos(ang) * cycles), kz = Math.round(Math.sin(ang) * cycles);
		if (kx === 0 && kz === 0) kx = 1;
		const k = Math.hypot(kx, kz);
		waves.push({ kx, kz, amp: 1 / Math.pow(k, 1.5), phase: r() * Math.PI * 2 });
	}
	const sx = new Float32Array(n * n), sz = new Float32Array(n * n), h = new Float32Array(n * n);
	let maxS = 1e-6, minH = Infinity, maxH = -Infinity;
	for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const u = (x / n) * Math.PI * 2, v = (y / n) * Math.PI * 2;
		let a = 0, b = 0, c = 0;
		for (const w of waves) {
			const arg = w.kx * u + w.kz * v + w.phase;
			const cs = Math.cos(arg) * w.amp;
			a += cs * w.kx;
			b += cs * w.kz;
			c += Math.sin(arg) * w.amp;
		}
		const i = y * n + x;
		sx[i] = a; sz[i] = b; h[i] = c;
		maxS = Math.max(maxS, Math.abs(a), Math.abs(b));
		minH = Math.min(minH, c); maxH = Math.max(maxH, c);
	}
	const out = new Uint8Array(n * n * 4);
	for (let i = 0; i < n * n; i++) {
		out[i * 4] = Math.round((sx[i] / maxS) * 127.5 + 127.5);
		out[i * 4 + 1] = Math.round((sz[i] / maxS) * 127.5 + 127.5);
		out[i * 4 + 2] = Math.round(((h[i] - minH) / (maxH - minH)) * 255);
		out[i * 4 + 3] = 255;
	}
	return out;
}
