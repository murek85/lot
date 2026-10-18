// Budowle bez okien rozpoznawane z kształtu: kafle OpenMapTiles (regiony z generatora) nie mają rodzaju budynku,
// a i w OSM kominy bywają zwykłym „building=yes”. Obrys prawie okrągły (kołowość 4πA/P² ≥ 0,85, co najmniej
// 7 wierzchołków – kwadrat ma 0,785) i:
//   – smukły i wysoki (wysokość / √pole ≥ 2,5, ≥ 25 m) → komin (elektrownie, ciepłownie, huty, kopalnie);
//   – wysoki i szeroki (≥ 25 m, ≥ 500 m²) → chłodnia kominowa (hiperboloida);
//   – niższy, z wysokością z danych → zbiornik, silos, gazometr.
// Sama matematyka (bez Three.js) – testowana w Node.

/** Pole (bez znaku) i obwód obrysu z płaskiej listy [x0, z0, x1, z1, …] (bez powtórzonego pierwszego punktu). */
export function outline(pts) {
	const n = pts.length / 2;
	let a = 0, p = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[j * 2], z1 = pts[j * 2 + 1];
		a += x0 * z1 - x1 * z0;
		p += Math.hypot(x1 - x0, z1 - z0);
	}
	a = Math.abs(a / 2);
	return { area: a, perimeter: p, circularity: p > 0 ? (4 * Math.PI * a) / (p * p) : 0, n };
}

/** Rodzaj budowli: 'chimney' | 'cooling' | 'tank' | null (zwykły budynek). h – wysokość ścian (m). */
export function structureKind(pts, h, known) {
	const o = outline(pts);
	if (o.n < 7 || o.circularity < 0.85 || o.area < 1) return null;
	const slender = h / Math.sqrt(o.area);
	if (h >= 25 && slender >= 2.5) return 'chimney';
	if (h >= 25 && o.area >= 500) return 'cooling';
	if (known && h >= 6) return 'tank';
	return null;
}

/**
 * Profil chłodni kominowej (hiperboloida): promień jako ułamek promienia podstawy na wysokości t (0 – ziemia,
 * 1 – wieniec): przewężenie ~62% na 72% wysokości, u góry lekko rozszerzona.
 */
export const coolingProfile = (t) => 0.62 + 0.38 * ((t - 0.72) / 0.72) ** 2;

/** Światła przeszkodowe: wysokości lamp (m nad podstawą) – szczyt, a przy wysokich także niżej (co ~ 1/3). */
export function beaconHeights(h) {
	if (h < 45) return [];
	if (h < 100) return [h - 1];
	if (h < 150) return [h - 1, h * 0.5];
	return [h - 1, h * 0.66, h * 0.33];
}
