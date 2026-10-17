// Kafle Web Mercator dla generatora regionów: lista kafli pokrywających region, przeliczenie punktu kafla na
// lokalne metry regionu, przycinanie linii i wielokątów do kwadratu kafla (obiekty z bufora sąsiednich kafli nie
// dublują się na styku). Wspólne dla gry, workera generatora i testów (Node).
import { lonToTileX, latToTileY, localToLonLat, lonLatToLocal, regionBounds } from '../geo.js';

const DEG = Math.PI / 180;

export const tileKey = (src, z, x, y) => `${src}/${z}/${x}/${y}`;

/** Kafle poziomu z pokrywające region (kwadrat size m wokół center) z zapasem margin metrów. */
export function tilesFor(center, size, z, margin = 0) {
	const b = regionBounds({ center, size: size + 2 * margin });
	const x0 = Math.floor(lonToTileX(b.west, z)), x1 = Math.floor(lonToTileX(b.east, z));
	const y0 = Math.floor(latToTileY(b.north, z)), y1 = Math.floor(latToTileY(b.south, z));
	const out = [];
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
	return out;
}

/** Długość/szerokość punktu (u, v) kafla x, y na poziomie z (u, v w jednostkach 0…extent). */
export function tilePointLonLat(z, x, y, u, v, extent) {
	const n = 2 ** z;
	const lon = ((x + u / extent) / n) * 360 - 180;
	const t = Math.PI * (1 - (2 * (y + v / extent)) / n);
	return { lon, lat: Math.atan(Math.sinh(t)) / DEG };
}

/**
 * Przelicznik kafla na lokalne metry regionu: zwraca funkcję (u, v) → [x, z] i jej wersję dla całego ciągu.
 * W obrębie kafla (1,5 km) rzut jest liniowy z dokładnością do centymetrów – liczony z rogów kafla.
 */
export function tileToLocal(z, x, y, extent, center) {
	const p00 = lonLatToLocal(...Object.values(tilePointLonLat(z, x, y, 0, 0, extent)), center);
	const p10 = lonLatToLocal(...Object.values(tilePointLonLat(z, x, y, extent, 0, extent)), center);
	const p01 = lonLatToLocal(...Object.values(tilePointLonLat(z, x, y, 0, extent, extent)), center);
	const sx = (p10.x - p00.x) / extent, szv = (p01.z - p00.z) / extent;
	// pionowa skala zmienia się z szerokością (Mercator) – w obrębie kafla interpolacja kwadratowa zbędna
	const pt = (u, v) => [p00.x + u * sx, p00.z + v * szv];
	const line = (flat) => {
		const out = new Array(flat.length);
		for (let i = 0; i < flat.length; i += 2) { out[i] = p00.x + flat[i] * sx; out[i + 1] = p00.z + flat[i + 1] * szv; }
		return out;
	};
	return { pt, line, metersPerUnit: Math.abs(sx) };
}

/** Przycina łamaną (płaska tablica) do kwadratu [0, s]²; zwraca listę łamanych (co najmniej 2 punkty). */
export function clipLine(flat, s) {
	const out = [];
	let cur = null;
	const inside = (x, y) => x >= 0 && x <= s && y >= 0 && y <= s;
	for (let i = 2; i < flat.length; i += 2) {
		let x0 = flat[i - 2], y0 = flat[i - 1], x1 = flat[i], y1 = flat[i + 1];
		// Liang–Barsky
		let t0 = 0, t1 = 1;
		const dx = x1 - x0, dy = y1 - y0;
		let ok = true;
		for (const [p, q] of [[-dx, x0], [dx, s - x0], [-dy, y0], [dy, s - y0]]) {
			if (p === 0) { if (q < 0) { ok = false; break; } continue; }
			const r = q / p;
			if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
		}
		if (!ok) { cur = null; continue; }
		const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
		if (!cur || t0 > 0 || !inside(x0, y0)) { cur = [ax, ay]; out.push(cur); }
		cur.push(bx, by);
		if (t1 < 1) cur = null;
	}
	return out.filter((l) => l.length >= 4);
}

/** Przycina pierścień wielokąta do kwadratu [0, s]² (Sutherland–Hodgman); wynik domknięty albo null. */
export function clipRing(flat, s) {
	let pts = [];
	for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
	if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
	const edges = [
		(p) => p[0] >= 0, (p) => p[0] <= s, (p) => p[1] >= 0, (p) => p[1] <= s,
	];
	const cut = [
		(a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + (b[1] - a[1]) * t]; },
		(a, b) => { const t = (s - a[0]) / (b[0] - a[0]); return [s, a[1] + (b[1] - a[1]) * t]; },
		(a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, 0]; },
		(a, b) => { const t = (s - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, s]; },
	];
	for (let e = 0; e < 4 && pts.length; e++) {
		const inp = pts;
		pts = [];
		for (let i = 0; i < inp.length; i++) {
			const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
			const ia = edges[e](a), ib = edges[e](b);
			if (ib) { if (!ia) pts.push(cut[e](a, b)); pts.push(b); } else if (ia) pts.push(cut[e](a, b));
		}
	}
	if (pts.length < 3) return null;
	const out = [];
	for (const p of pts) out.push(p[0], p[1]);
	out.push(pts[0][0], pts[0][1]);
	return out;
}

export { localToLonLat };
