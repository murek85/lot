// Obróbka siatek terenu (wypiekanie w narzędziach i generator w grze): klasy pokrycia, wygładzanie wody, odległość od brzegu.

// Klasy gry (wartość w cover.bin). Kolejność jest umową z shaderem terenu (src/terrain.js).
export const COVER = { grass: 0, forest: 1, shrub: 2, crop: 3, built: 4, bare: 5, water: 6, wetland: 7 };

// ESA WorldCover 2021 → klasy gry.
const WORLDCOVER = {
	10: COVER.forest, 20: COVER.shrub, 30: COVER.grass, 40: COVER.crop, 50: COVER.built, 60: COVER.bare,
	70: COVER.bare, 80: COVER.water, 90: COVER.wetland, 95: COVER.forest, 100: COVER.grass,
};

export function worldCoverClass(v) {
	return WORLDCOVER[v] ?? COVER.grass;
}

/** Spójne składowe (sąsiedztwo 4) maski; zwraca etykiety (0 = poza maską) i listę składowych. */
export function components(mask, n) {
	const label = new Int32Array(n * n);
	const comps = [];
	const stack = [];
	for (let start = 0; start < n * n; start++) {
		if (!mask[start] || label[start]) continue;
		const id = comps.length + 1;
		const cells = [];
		let x0 = n, x1 = 0, y0 = n, y1 = 0;
		label[start] = id;
		stack.push(start);
		while (stack.length) {
			const i = stack.pop();
			cells.push(i);
			const x = i % n, y = (i / n) | 0;
			if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
			const nb = [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1];
			for (const j of nb) if (j >= 0 && mask[j] && !label[j]) { label[j] = id; stack.push(j); }
		}
		comps.push({ id, cells, extent: Math.max(x1 - x0, y1 - y0) + 1 });
	}
	return { label, comps };
}

/**
 * Gładka tafla wody: jeziora (składowe mniejsze niż maxLakeCells w poprzek) dostają jeden poziom – 20. percentyl
 * ich wysokości; rzeki (dłuższe) – minimum z okna 7×7, żeby nurt dalej opadał, ale bez szumu SRTM.
 * Ląd przy brzegu nie może leżeć niżej niż woda obok.
 */
export function flattenWater(height, water, n, maxLakeCells) {
	const { comps } = components(water, n);
	const out = Float32Array.from(height);
	for (const c of comps) {
		if (c.extent <= maxLakeCells) {
			const hs = c.cells.map((i) => height[i]).sort((a, b) => a - b);
			const level = hs[Math.floor(hs.length * 0.2)];
			for (const i of c.cells) out[i] = level;
		} else {
			for (const i of c.cells) {
				const x = i % n, y = (i / n) | 0;
				let m = Infinity;
				for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
					const xx = x + dx, yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
					const j = yy * n + xx;
					if (water[j] && height[j] < m) m = height[j];
				}
				out[i] = m;
			}
		}
	}
	for (let i = 0; i < n * n; i++) {
		if (water[i]) continue;
		const x = i % n, y = (i / n) | 0;
		for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
			if (j >= 0 && water[j] && out[i] < out[j] + 0.3) out[i] = out[j] + 0.3;
		}
	}
	return out;
}

/** Odległość (w komórkach) do najbliższej komórki przeciwnej strony maski – fazowa (chamfer 3-4), ze znakiem: woda < 0. */
export function signedShoreDistance(water, n) {
	const BIG = 1e9;
	const dist = (inside) => {
		const d = new Float32Array(n * n);
		for (let i = 0; i < n * n; i++) d[i] = !!water[i] === inside ? BIG : 0;
		const pass = (forward) => {
			const step = forward ? 1 : -1;
			for (let y = forward ? 0 : n - 1; forward ? y < n : y >= 0; y += step) {
				for (let x = forward ? 0 : n - 1; forward ? x < n : x >= 0; x += step) {
					const i = y * n + x;
					if (d[i] === 0) continue;
					let v = d[i];
					const xb = x - step, yb = y - step;
					if (xb >= 0 && xb < n) v = Math.min(v, d[i - step] + 3);
					if (yb >= 0 && yb < n) {
						v = Math.min(v, d[i - step * n] + 3);
						if (xb >= 0 && xb < n) v = Math.min(v, d[i - step * n - step] + 4);
						if (x + step >= 0 && x + step < n) v = Math.min(v, d[i - step * n + step] + 4);
					}
					d[i] = v;
				}
			}
		};
		pass(true);
		pass(false);
		return d;
	};
	const land = dist(false), sea = dist(true);
	const out = new Float32Array(n * n);
	for (let i = 0; i < n * n; i++) out[i] = water[i] ? -sea[i] / 3 : land[i] / 3;
	return out;
}

/** Maska wody na siatce wysokości n×n z siatki pokrycia coverRes² (komórka wodą, gdy co najmniej pół jej pikseli). */
export function waterMask(cover, coverRes, n) {
	const k = coverRes / n;
	const mask = new Uint8Array(n * n);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		let w = 0;
		for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) if (cover[(j * k + dy) * coverRes + i * k + dx] === COVER.water) w++;
		mask[j * n + i] = w * 2 >= k * k ? 1 : 0;
	}
	return mask;
}

export const SHORE_STEP = 3; // metry na jednostkę odległości od brzegu; 128 = brzeg

/**
 * Teren gotowy do zapisu: wygładzona woda, wysokość Uint16 w zakresie min…max, odległość od brzegu Uint8 i udział
 * klas pokrycia w procentach. rawHeight – Float32 n×n (m n.p.m.), cover – Uint8 coverRes².
 */
export function packTerrain(rawHeight, cover, n, coverRes, size) {
	const cell = size / n;
	const water = waterMask(cover, coverRes, n);
	const height = flattenWater(rawHeight, water, n, Math.round(6000 / cell));
	const shore = signedShoreDistance(water, n);
	let min = Infinity, max = -Infinity;
	for (const h of height) { if (h < min) min = h; if (h > max) max = h; }
	min = Math.floor(min) - 1; max = Math.ceil(max) + 1;
	const h16 = new Uint16Array(n * n);
	for (let i = 0; i < h16.length; i++) h16[i] = Math.round(((height[i] - min) / (max - min)) * 65535);
	const s8 = new Uint8Array(n * n);
	for (let i = 0; i < s8.length; i++) s8[i] = Math.max(0, Math.min(255, Math.round(128 + (shore[i] * cell) / SHORE_STEP)));
	const names = Object.keys(COVER);
	const counts = new Array(names.length).fill(0);
	for (const c of cover) counts[c]++;
	const percent = Object.fromEntries(names.map((k, i) => [k, +((counts[COVER[k]] / cover.length) * 100).toFixed(1)]));
	return { h16, s8, min, max, percent };
}
