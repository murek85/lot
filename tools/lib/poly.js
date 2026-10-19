// Wielokąty obszarów w formacie .poly (Osmosis, Geofabrik) – granice wyciągów OSM dla własnych kafli.
import { lonToTileX, latToTileY } from '../../src/geo.js';
import { tilePointLonLat } from '../../src/gen/tiles.js';

/** Pierścienie (lon, lat) z pliku .poly (Osmosis); pierścienie z „!” – otwory. */
export function readPoly(text) {
	const rings = [];
	let cur = null;
	for (const line of text.split(/\r?\n/).slice(1)) {
		const t = line.trim();
		if (!t) continue;
		if (t === 'END') { if (cur) { rings.push(cur); cur = null; } continue; }
		if (!cur) { cur = { hole: t.startsWith('!'), pts: [] }; continue; }
		const [lon, lat] = t.split(/\s+/).map(Number);
		cur.pts.push([lon, lat]);
	}
	return rings;
}
/** Punkt w wielokącie (parzysto-nieparzyście po wszystkich pierścieniach, otwory działają same). */
export function inPoly(rings, lon, lat) {
	let inside = false;
	for (const { pts } of rings) {
		for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
			const [xi, yi] = pts[i], [xj, yj] = pts[j];
			if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}


/** Prostokąt [w, s, e, n] pierścieni. */
export function polyBounds(rings) {
	let W = 180, E = -180, S = 90, N = -90;
	for (const { pts } of rings) for (const [lon, lat] of pts) { W = Math.min(W, lon); E = Math.max(E, lon); S = Math.min(S, lat); N = Math.max(N, lat); }
	return [W, S, E, N];
}

const GRID9 = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
const vertexTiles = new WeakMap(); // pierścienie → z → Set „x/y” kafli z wierzchołkami wielokąta
const tileOf = (lon, lat, z) => `${Math.floor(lonToTileX(lon, z))}/${Math.floor(latToTileY(lat, z))}`;

/**
 * Kafel „x/y” poziomu z a wielokąt: 'inside' – w całości wewnątrz (rogi, środki boków i środek; granica województwa
 * jest gładka w skali 1,5 km), 'touch' – dotyka (któryś z tych 9 punktów w wielokącie albo wierzchołek wielokąta
 * w kaflu – wąskie cyple).
 */
export function tileInPoly(rings, z, key, mode) {
	const [x, y] = key.split('/').map(Number);
	const at = ([u, v]) => { const p = tilePointLonLat(z, x, y, u * 4096, v * 4096, 4096); return inPoly(rings, p.lon, p.lat); };
	if (mode === 'inside') return GRID9.every(at);
	if (!vertexTiles.has(rings)) vertexTiles.set(rings, new Map());
	const vt = vertexTiles.get(rings);
	if (!vt.has(z)) vt.set(z, new Set(rings.flatMap(({ pts }) => pts.map(([lon, lat]) => tileOf(lon, lat, z)))));
	return vt.get(z).has(key) || GRID9.some(at);
}

/** Kafle „x/y” poziomu z wewnątrz wielokąta albo go dotykające (mode jak w tileInPoly). */
export function tilesInPoly(rings, z, mode) {
	const [W, S, E, N] = polyBounds(rings), out = [];
	for (let y = Math.floor(latToTileY(N, z)); y <= Math.floor(latToTileY(S, z)); y++) {
		for (let x = Math.floor(lonToTileX(W, z)); x <= Math.floor(lonToTileX(E, z)); x++) if (tileInPoly(rings, z, `${x}/${y}`, mode)) out.push(`${x}/${y}`);
	}
	return out;
}
