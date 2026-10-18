// Dane kafla otwartego świata (kafel Web Mercator z14, ~1,5 km) – sama logika, wspólna dla wątku i testów (Node):
// siatka wysokości z marginesem (normalne liczone ze wspólnych punktów – bez szwów światła na granicach kafli),
// raster pokrycia terenu w układzie kafla, obiekty (drogi, budynki, tory, cieki…) w metrach układu świata.
import { decodeTile } from '../gen/mvt.js';
import { tileToLocal, tilePointLonLat } from '../gen/tiles.js';
import { convertTile, rasterizePolygon, COVER_PRIORITY, UNSET } from '../gen/convert.js';
import { convertLotTile, LOT_LAYERS } from '../gen/lottiles.js';
import { COVER } from '../gen/terrain.js';
import { lonToTileX, latToTileY, terrariumHeight } from '../geo.js';

export const CHUNK_Z = 14;
export const GRID = 65; // wierzchołki siatki terenu na bok z Terrarium (≈ 24 m)
export const LOT_GRID = 129; // z wysokości GUGiK we własnych kafach (≈ 12 m)
export const COVER_RES = 256; // piksele pokrycia na bok (≈ 6 m)
export const HEIGHT_Z = 12; // kafle Terrarium
/** Daleki teren (za zasięgiem kafli z14): kafle z11 (~12,5 km) – rzeźba z Terrarium z11, pokrycie z mapy z11. */
export const FAR_Z = 11;
export const MASK_RES = 256; // maska dróg, torów i cieków (≈ 6 m) – drzewa 3D ich omijają
export const LAYERS = ['transportation', 'building', 'waterway', 'water', 'landcover', 'landuse', 'poi', 'place'];
const FAR_LAYERS = ['water', 'landcover', 'landuse', 'place'];

/** Przeliczenia kafla: punkt (u, v) ∈ [0, 4096]² → metry układu świata (początek origin) i z powrotem. */
export function chunkFrame(x, y, origin, Z = CHUNK_Z) {
	const T = tileToLocal(Z, x, y, 4096, origin);
	const [x0, z0] = T.pt(0, 0), [x1, z1] = T.pt(4096, 4096);
	return { T, x0, z0, sx: (x1 - x0) / 4096, sz: (z1 - z0) / 4096, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, h: z1 - z0 };
}

/**
 * Kafle Terrarium (z12) potrzebne do siatki wysokości kafla z14 (z marginesem jednej komórki i jednego piksela
 * na interpolację) – zwykle jeden, przy krawędzi dwa lub cztery.
 */
export function heightTilesFor(x, y, Z = CHUNK_Z, HZ = HEIGHT_Z) {
	const pad = 1 / (GRID - 1); // komórka siatki w ułamku kafla
	// prostokąt pikseli kafli wysokości pod kaflem (z marginesem) – wszystkie kafle, które go pokrywają
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const [u, v] of [[-pad, -pad], [1 + pad, 1 + pad]]) {
		const p = tilePointLonLat(Z, x, y, u * 4096, v * 4096, 4096);
		const gx = lonToTileX(p.lon, HZ) * 256, gy = latToTileY(p.lat, HZ) * 256;
		x0 = Math.min(x0, gx - 1); x1 = Math.max(x1, gx + 1); y0 = Math.min(y0, gy - 1); y1 = Math.max(y1, gy + 1);
	}
	const out = [];
	for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) out.push([tx, ty]);
	return out;
}

/** Wysokości Terrarium z obrazka RGBA 256² → Float32 256². */
export function decodeTerrarium(rgba) {
	const h = new Float32Array(256 * 256);
	for (let k = 0; k < h.length; k++) h[k] = terrariumHeight(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
	return h;
}

/**
 * Siatka wysokości kafla (GRID+2)² z marginesem jednej komórki: tiles – Map "x/y" → Float32 256² (z12).
 * Zwraca { heights (GRID², środek), normals (GRID² × 3), min, max }.
 */
export function chunkHeights(x, y, tiles, Z = CHUNK_Z, HZ = HEIGHT_Z) {
	const n = GRID + 2, cell = 1 / (GRID - 1);
	const px = (gx, gy) => tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)?.[(gy & 255) * 256 + (gx & 255)] ?? 0;
	const H = new Float32Array(n * n);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		const u = (i - 1) * cell, v = (j - 1) * cell;
		const p = tilePointLonLat(Z, x, y, u * 4096, v * 4096, 4096);
		const fx = lonToTileX(p.lon, HZ) * 256 - 0.5, fy = latToTileY(p.lat, HZ) * 256 - 0.5;
		const ix = Math.floor(fx), iy = Math.floor(fy), a = fx - ix, b = fy - iy;
		H[j * n + i] = (px(ix, iy) * (1 - a) + px(ix + 1, iy) * a) * (1 - b) + (px(ix, iy + 1) * (1 - a) + px(ix + 1, iy + 1) * a) * b;
	}
	return H;
}

/** Normalne z siatki z marginesem (różnice centralne; dx, dz – rozmiar komórki w m; G – wierzchołki na bok). */
export function gridNormals(H, dx, dz, G = GRID) {
	const n = G + 2;
	const heights = new Float32Array(G * G), normals = new Float32Array(G * G * 3);
	let min = Infinity, max = -Infinity;
	for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
		const c = (j + 1) * n + (i + 1);
		const h = H[c];
		heights[j * G + i] = h;
		if (h < min) min = h;
		if (h > max) max = h;
		const gx = (H[c + 1] - H[c - 1]) / (2 * dx), gz = (H[c + n] - H[c - n]) / (2 * dz);
		const l = Math.hypot(gx, 1, gz);
		normals.set([-gx / l, 1 / l, -gz / l], (j * G + i) * 3);
	}
	return { heights, normals, min, max };
}

/**
 * Kafel wektorowy (bufor pbf, może być pusty) → obiekty w układzie świata (decymetry jak w osm.json) i raster
 * pokrycia COVER_RES² w układzie kafla (wiersz 0 – północ). origin – { lon, lat } początku układu.
 */
export function chunkObjects(buf, x, y, origin, Z = CHUNK_Z) {
	const out = { roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [], places: [] };
	const cover = new Uint8Array(COVER_RES * COVER_RES).fill(UNSET);
	if (buf && buf.byteLength) {
		const r = convertTile(decodeTile(buf, Z === CHUNK_Z ? LAYERS : FAR_LAYERS), Z, x, y, { center: origin, half: 1e9, buildings: Z === CHUNK_Z ? 'all' : 'none' });
		for (const k of ['roads', 'rails', 'buildings', 'waterways', 'stations', 'platforms', 'places']) out[k] = r[k];
		// wielokąty pokrycia z metrów świata z powrotem do układu kafla (−2048…2048), rastrowanie z ważnością klas
		const F = chunkFrame(x, y, origin, Z);
		for (const c of r.cover) {
			const rings = c.rings.map((ring) => {
				const o = new Array(ring.length);
				for (let i = 0; i < ring.length; i += 2) { o[i] = (ring[i] - F.x0) / F.sx - 2048; o[i + 1] = (ring[i + 1] - F.z0) / F.sz - 2048; }
				return o;
			});
			rasterizePolygon(cover, COVER_RES, 4096, rings, c.cls, COVER_PRIORITY);
		}
	}
	for (let i = 0; i < cover.length; i++) if (cover[i] === UNSET) cover[i] = COVER.crop;
	return { osm: out, cover };
}

/**
 * Maska dróg, torów i cieków kafla MASK_RES² (0/255, wiersz 0 – północ) – jak maska regionu (src/roads.js): pas
 * do osi bliżej niż połowa szerokości + 3 m; przy rzekach pas nadbrzeżny jak w src/rivers.js. frame – z chunkFrame.
 */
export function chunkMask(osm, frame) {
	const n = MASK_RES, mask = new Uint8Array(n * n);
	const cx = frame.w / n, cz = frame.h / n;
	const line = (c, half) => {
		const r = half + 3;
		for (let i = 2; i < c.length; i += 2) {
			const x0 = c[i - 2] / 10 - frame.x0, z0 = c[i - 1] / 10 - frame.z0, x1 = c[i] / 10 - frame.x0, z1 = c[i + 1] / 10 - frame.z0;
			const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - r) / cx)), i1 = Math.min(n - 1, Math.floor((Math.max(x0, x1) + r) / cx));
			const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - r) / cz)), j1 = Math.min(n - 1, Math.floor((Math.max(z0, z1) + r) / cz));
			const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
			for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
				const px = (k + 0.5) * cx, pz = (j + 0.5) * cz;
				const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / len2));
				const ex = x0 + dx * t - px, ez = z0 + dz * t - pz;
				if (ex * ex + ez * ez <= r * r) mask[j * n + k] = 255;
			}
		}
	};
	for (const r of osm.roads) line(r[5], r[1] / 20);
	for (const r of osm.rails) line(r[4], 2.2);
	for (const [w10, c] of osm.waterways) { const w = Math.min(60, w10 / 10); line(c, w / 2 + (w >= 8 ? 7 : w >= 2 ? 3 : 1) - 3); }
	return mask;
}

/** Przesunięcie obiektów kafla o (−dx, −dz) m (nowy początek układu w punkcie (dx, dz)); dx, dz – wielokrotności 0,1 m. */
export function shiftOsm(osm, dx, dz) {
	const ex = Math.round(dx * 10), ez = Math.round(dz * 10);
	const sh = (c) => { for (let i = 0; i < c.length; i += 2) { c[i] -= ex; c[i + 1] -= ez; } };
	for (const r of osm.roads) sh(r[5]);
	for (const r of osm.rails) sh(r[4]);
	for (const b of osm.buildings) sh(b[4]);
	for (const w of osm.waterways) sh(w[1]);
	for (const p of osm.platforms) sh(p[0]);
	for (const s of osm.stations) sh(s[1]);
	for (const p of osm.power ?? []) sh(p[1]);
	for (const r of osm.treeRows ?? []) sh(r[0]);
	for (const c of osm.crossings ?? []) sh(c[1]);
	for (const p of osm.places) { p.x -= dx; p.z -= dz; }
}

/**
 * Kafel z własnych kafli gry (tools/bake-tiles.js): obiekty ze schematu „lot”, pokrycie z rastra WorldCover
 * (coverRaw – COVER_RES², może być null) z wodą z OSM na wierzchu (dokładny brzeg).
 */
export function chunkObjectsLot(buf, coverRaw, x, y, origin, Z = CHUNK_Z) {
	const r = convertLotTile(decodeTile(buf, LOT_LAYERS), Z, x, y, { center: origin });
	const cover = coverRaw ? resampleCover(new Uint8Array(coverRaw)) : new Uint8Array(COVER_RES * COVER_RES).fill(COVER.crop);
	const F = chunkFrame(x, y, origin, Z);
	for (const c of r.cover) {
		const rings = c.rings.map((ring) => {
			const o = new Array(ring.length);
			for (let i = 0; i < ring.length; i += 2) { o[i] = (ring[i] - F.x0) / F.sx - 2048; o[i + 1] = (ring[i + 1] - F.z0) / F.sz - 2048; }
			return o;
		});
		rasterizePolygon(cover, COVER_RES, 4096, rings, c.cls, COVER_PRIORITY);
	}
	const { cover: _, ...osm } = r;
	return { osm, cover };
}

/** Raster pokrycia innej rozdzielczości (np. starsze kafle 128²) → COVER_RES² (najbliższy piksel). */
export function resampleCover(c) {
	const r = Math.round(Math.sqrt(c.length));
	if (r === COVER_RES) return c;
	const out = new Uint8Array(COVER_RES * COVER_RES);
	for (let j = 0; j < COVER_RES; j++) for (let i = 0; i < COVER_RES; i++) out[j * COVER_RES + i] = c[Math.floor((j * r) / COVER_RES) * r + Math.floor((i * r) / COVER_RES)];
	return out;
}

/** Wysokości z własnych kafli (Int16, decymetry, (LOT_GRID+2)²) → metry, siatka z marginesem jak chunkHeights. */
export function lotHeights(raw) {
	const dm = new Int16Array(raw), H = new Float32Array(dm.length);
	for (let i = 0; i < dm.length; i++) H[i] = dm[i] === -32768 ? NaN : dm[i] / 10; // NaN – brak danych (poza Polską)
	return H;
}

/** Uzupełnienie braków (NaN) wysokości z innego źródła tej samej siatki (Terrarium); zwraca liczbę uzupełnionych. */
export function fillHeights(H, fallback) {
	let n = 0;
	for (let i = 0; i < H.length; i++) if (Number.isNaN(H[i])) { H[i] = fallback[i]; n++; }
	return n;
}

/**
 * Odległość od brzegu (m, do 255) dla pikseli wody rastra pokrycia – głębia i piana jak w regionach. Przybliżenie
 * dwuprzebiegowe (odległość „szachownicowa” 3–4); piksele poza kaflem nie liczą się jako ląd (woda przecięta brzegiem
 * kafla nie ma tam fałszywego brzegu).
 */
export function shoreDistance(cover, res, pixelM) {
	const INF = 1e9, d = new Float32Array(res * res);
	for (let i = 0; i < d.length; i++) d[i] = cover[i] === COVER.water ? INF : 0;
	const at = (i, j) => (i < 0 || j < 0 || i >= res || j >= res ? INF : d[j * res + i]);
	for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
		const k = j * res + i;
		if (!d[k]) continue;
		d[k] = Math.min(d[k], at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4);
	}
	for (let j = res - 1; j >= 0; j--) for (let i = res - 1; i >= 0; i--) {
		const k = j * res + i;
		if (!d[k]) continue;
		d[k] = Math.min(d[k], at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4);
	}
	const out = new Uint8Array(res * res);
	for (let i = 0; i < d.length; i++) out[i] = d[i] >= INF ? 255 : Math.min(255, Math.round((d[i] / 3) * pixelM));
	return out;
}
