// Opis własnych kafli gry (data/tiles/lot/tiles.json, tools/bake-tiles.js) – wspólny dla narzędzia, wątku kafli i menu.
// Wersja 4: każdy obszar (województwo) ma własny znacznik wypieczenia i zbiór kafli z14 zapisany maskami 64-bitowymi
// po kaflach z11 (8 × 8 kafli z14 w jednym), z11 – listą. Kafel należy do jednego obszaru – tego wypieczonego
// ostatnio (kafle na granicy województw przechodzą na nowy obszar razem z pełnymi danymi z obu stron).
// Wersja 3 (lista „x/y” kafli z14) jest czytana do czasu ponownego wypieczenia.

export const MANIFEST_VERSION = 4;

/** Kafle z14 „x/y” → { „x11/y11”: 16 cyfr szesnastkowych } (bit 8·dy + dx – kafel x11·8 + dx, y11·8 + dy). */
export function encodeTiles(keys) {
	const groups = new Map();
	for (const k of keys) {
		const [x, y] = k.split('/').map(Number);
		const g = `${x >> 3}/${y >> 3}`, bit = ((y & 7) << 3) | (x & 7);
		if (!groups.has(g)) groups.set(g, [0, 0]);
		groups.get(g)[bit >> 5] |= 1 << (bit & 31);
	}
	const out = {};
	for (const g of [...groups.keys()].sort()) {
		const [lo, hi] = groups.get(g);
		out[g] = (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
	}
	return out;
}

/** Odwrotność encodeTiles: lista „x/y” kafli z14. */
export function decodeTiles(enc) {
	const out = [];
	for (const [g, hex] of Object.entries(enc ?? {})) {
		const [gx, gy] = g.split('/').map(Number);
		const words = [parseInt(hex.slice(8), 16), parseInt(hex.slice(0, 8), 16)];
		for (let bit = 0; bit < 64; bit++) if (words[bit >> 5] & (1 << (bit & 31))) out.push(`${gx * 8 + (bit & 7)}/${gy * 8 + (bit >> 3)}`);
	}
	return out;
}

/** Kafle z14 obszaru z opisu dowolnej wersji. */
const areaZ14 = (a) => (Array.isArray(a.z14) ? a.z14 : decodeTiles(a.z14));

/**
 * Opis → { areas: [{ id, bounds, built, z14: Set }], z14 / z11: Map „x/y” → znacznik, area14 / area11: Map „x/y” →
 * obszar (archiwum <obszar>.pmtiles), heights,
 * farHeights }. Znacznik (wersja, obszar, czas wypieczenia) trafia do kluczy pamięci kafli – po ponownym wypieczeniu
 * obszaru gra nie bierze jego starych kafli z IndexedDB, a kafle innych obszarów zostają.
 */
export function readManifest(m) {
	const z14 = new Map(), z11 = new Map(), area14 = new Map(), area11 = new Map(), areas = [];
	for (const [id, a] of Object.entries(m?.areas ?? {})) {
		const stamp = `v${m.version ?? 0}-${id}-${a.built}`;
		const keys = areaZ14(a);
		for (const k of keys) { z14.set(k, stamp); area14.set(k, id); }
		for (const k of a.z11 ?? []) { z11.set(k, stamp); area11.set(k, id); }
		if (Array.isArray(a.bounds)) areas.push({ id, bounds: a.bounds, built: a.built, z14: new Set(keys) });
	}
	return { areas, z14, z11, area14, area11, heights: !!m?.heightRes, farHeights: !!m?.farHeightRes };
}

/**
 * Dokłada (albo zastępuje) obszar w opisie: { bounds, built, source, z14: [„x/y”], z11: [„x/y”] }. Kafle obszaru
 * znikają z pozostałych obszarów (należą do nowszego wypieczenia); obszar bez kafli wypada. Zwraca nowy opis v4.
 */
export function mergeArea(manifest, id, area, info = {}) {
	const own14 = new Set(area.z14), own11 = new Set(area.z11);
	const areas = {};
	for (const [oid, a] of Object.entries(manifest?.areas ?? {})) {
		if (oid === id) continue;
		const k14 = areaZ14(a).filter((k) => !own14.has(k)), k11 = (a.z11 ?? []).filter((k) => !own11.has(k));
		if (!k14.length && !k11.length) continue;
		areas[oid] = { ...a, bounds: tilesBounds(k14) ?? a.bounds, z14: encodeTiles(k14), z11: k11 };
	}
	areas[id] = { ...area, z14: encodeTiles(area.z14), z11: [...area.z11] };
	return { ...info, version: MANIFEST_VERSION, areas };
}

/** Prostokąt [w, s, e, n] (stopnie) obejmujący kafle „x/y” poziomu z (domyślnie z14) albo null. */
export function tilesBounds(keys, z = 14) {
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const k of keys) {
		const [x, y] = k.split('/').map(Number);
		x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
	}
	if (x0 === Infinity) return null;
	const n = 2 ** z, lon = (x) => (x / n) * 360 - 180;
	const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
	const r = (v) => Math.round(v * 1e5) / 1e5;
	return [r(lon(x0)), r(lat(y1)), r(lon(x1)), r(lat(y0))];
}
