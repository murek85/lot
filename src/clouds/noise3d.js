// Szumy do chmur liczone raz na procesorze: kafelkowane (bez szwów) tekstury 3D kształtu i detalu oraz mapa pogody 2D.
// Klasyczny przepis z gier (A. Schneider, „The real-time volumetric cloudscapes of Horizon Zero Dawn”):
// kształt = szum Perlina „wyżarty” szumem Worleya (kłębiaste brzegi), detal = fbm z szumu Worleya.

/** Deterministyczny generator liczb losowych. */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const wrap = (i, n) => ((i % n) + n) % n;

/** Odwrócony szum Worleya 3D (1 przy punkcie, 0 daleko), okresowy co `cells` komórek; próbki w [0,1)³. */
export function worley3(cells, seed) {
	const r = rng(seed);
	const pts = new Float32Array(cells * cells * cells * 3);
	for (let i = 0; i < pts.length; i++) pts[i] = r();
	return (x, y, z) => {
		const fx = x * cells, fy = y * cells, fz = z * cells;
		const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
		let best = 9;
		for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const ix = cx + dx, iy = cy + dy, iz = cz + dz;
			const k = (wrap(iz, cells) * cells * cells + wrap(iy, cells) * cells + wrap(ix, cells)) * 3;
			const px = ix + pts[k] - fx, py = iy + pts[k + 1] - fy, pz = iz + pts[k + 2] - fz;
			const d = px * px + py * py + pz * pz;
			if (d < best) best = d;
		}
		return Math.max(0, 1 - Math.sqrt(best));
	};
}

/** Szum Perlina 3D (gradientowy) w zakresie ~0..1, okresowy co `period` komórek. */
export function perlin3(period, seed) {
	const r = rng(seed);
	const g = new Float32Array(period * period * period * 3);
	for (let i = 0; i < g.length; i += 3) {
		const u = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
		g[i] = s * Math.cos(t); g[i + 1] = s * Math.sin(t); g[i + 2] = u;
	}
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
	const dotG = (ix, iy, iz, x, y, z) => {
		const k = (wrap(iz, period) * period * period + wrap(iy, period) * period + wrap(ix, period)) * 3;
		return g[k] * (x - ix) + g[k + 1] * (y - iy) + g[k + 2] * (z - iz);
	};
	return (x, y, z) => {
		const fx = x * period, fy = y * period, fz = z * period;
		const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
		const u = fade(fx - ix), v = fade(fy - iy), w = fade(fz - iz);
		const lerp = (a, b, t) => a + (b - a) * t;
		const n = lerp(
			lerp(lerp(dotG(ix, iy, iz, fx, fy, fz), dotG(ix + 1, iy, iz, fx, fy, fz), u), lerp(dotG(ix, iy + 1, iz, fx, fy, fz), dotG(ix + 1, iy + 1, iz, fx, fy, fz), u), v),
			lerp(lerp(dotG(ix, iy, iz + 1, fx, fy, fz), dotG(ix + 1, iy, iz + 1, fx, fy, fz), u), lerp(dotG(ix, iy + 1, iz + 1, fx, fy, fz), dotG(ix + 1, iy + 1, iz + 1, fx, fy, fz), u), v),
			w,
		);
		return Math.max(0, Math.min(1, n * 0.85 + 0.5));
	};
}

const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);

/** Tekstura kształtu n³ (Uint8): Perlin–Worley. */
export function shapeNoise(n = 64, seed = 7) {
	const p = [perlin3(4, seed), perlin3(8, seed + 1), perlin3(16, seed + 2)];
	const w = [worley3(4, seed + 3), worley3(8, seed + 4), worley3(16, seed + 5)];
	const out = new Uint8Array(n * n * n);
	let i = 0;
	for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const fx = (x + 0.5) / n, fy = (y + 0.5) / n, fz = (z + 0.5) / n;
		const perlin = p[0](fx, fy, fz) * 0.625 + p[1](fx, fy, fz) * 0.25 + p[2](fx, fy, fz) * 0.125;
		const worley = w[0](fx, fy, fz) * 0.625 + w[1](fx, fy, fz) * 0.25 + w[2](fx, fy, fz) * 0.125;
		const pw = remap(perlin, worley - 1, 1, 0, 1);
		out[i++] = Math.round(Math.max(0, Math.min(1, pw)) * 255);
	}
	return out;
}

/** Tekstura detalu n³ (Uint8): fbm z szumu Worleya – wyżera drobne kłęby na brzegach chmur. */
export function detailNoise(n = 32, seed = 21) {
	const w = [worley3(4, seed), worley3(8, seed + 1), worley3(16, seed + 2)];
	const out = new Uint8Array(n * n * n);
	let i = 0;
	for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const fx = (x + 0.5) / n, fy = (y + 0.5) / n, fz = (z + 0.5) / n;
		out[i++] = Math.round((w[0](fx, fy, fz) * 0.625 + w[1](fx, fy, fz) * 0.25 + w[2](fx, fy, fz) * 0.125) * 255);
	}
	return out;
}

/**
 * Mapa pogody n² (RG Uint8), kafelkowana: R – zasięg chmur (skupiska cumulusów z fbm i komórek Worleya),
 * G – „wiek” chmury (wysokość wierzchołka: młode płaskie, dojrzałe wypiętrzone).
 */
export function weatherMap(n = 512, seed = 99) {
	const cov = [perlin3(4, seed), perlin3(8, seed + 1), perlin3(16, seed + 2), perlin3(32, seed + 3)];
	const cells = worley3(24, seed + 4);
	const tall = perlin3(6, seed + 5);
	const out = new Uint8Array(n * n * 2);
	for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
		const fx = (x + 0.5) / n, fy = (y + 0.5) / n;
		const f = cov[0](fx, fy, 0.3) * 0.5 + cov[1](fx, fy, 0.3) * 0.25 + cov[2](fx, fy, 0.3) * 0.15 + cov[3](fx, fy, 0.3) * 0.1;
		const c = Math.max(0, Math.min(1, f * 0.75 + cells(fx, fy, 0.5) * 0.45 - 0.12));
		const k = (y * n + x) * 2;
		out[k] = Math.round(c * 255);
		out[k + 1] = Math.round(Math.max(0, Math.min(1, tall(fx, fy, 0.7) * 1.3 - 0.15)) * 255);
	}
	return out;
}
