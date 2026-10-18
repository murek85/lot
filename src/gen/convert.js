// Kafle wektorowe OpenMapTiles (OpenFreeMap) → dane regionu w formacie gry (jak osm.json.gz z narzędzi):
// drogi, tory, budynki, cieki, stacje, perony – współrzędne w decymetrach lokalnego układu regionu; do tego
// wielokąty pokrycia terenu (las, łąki, pola, zabudowa, woda, mokradła) do rastrowania i miejscowości (start).
// Schemat warstw: openmaptiles.org/schema. Czego w nich nie ma (linie energetyczne, szpalery drzew, przejazdy
// kolejowe) – region ma puste listy.
import { ROAD } from './schema.js';
import { COVER } from './terrain.js';
import { tileToLocal, clipLine, clipRing } from './tiles.js';
import { ringArea } from './mvt.js';

export { COVER };
// ważność klas pokrycia przy nakładaniu się wielokątów (woda nad lasem, las nad zabudową…); UNSET – komórka bez
// żadnego wielokąta (na końcu dostaje klasę domyślną – pola uprawne)
export const UNSET = 255;
export const COVER_PRIORITY = (() => {
	const p = new Uint8Array(256);
	[COVER.grass, COVER.crop, COVER.shrub, COVER.built, COVER.bare, COVER.forest, COVER.wetland, COVER.water].forEach((c, i) => { p[c] = i + 1; });
	return p;
})();

const LANDCOVER = {
	wood: COVER.forest, forest: COVER.forest, grass: COVER.grass, farmland: COVER.crop, wetland: COVER.wetland, sand: COVER.bare,
	rock: COVER.bare, ice: COVER.bare, scrub: COVER.shrub,
};
const LANDCOVER_SUB = { scrub: COVER.shrub, heath: COVER.shrub, shrubbery: COVER.shrub, bare_rock: COVER.bare, scree: COVER.bare, quarry: COVER.bare, beach: COVER.bare };
const LANDUSE = {
	residential: COVER.built, suburb: COVER.built, neighbourhood: COVER.built, industrial: COVER.built, commercial: COVER.built,
	retail: COVER.built, railway: COVER.built, garages: COVER.built, school: COVER.built, hospital: COVER.built, university: COVER.built,
	military: COVER.grass, cemetery: COVER.grass, quarry: COVER.bare, pitch: COVER.grass, playground: COVER.grass,
};
const WATERWAY = { river: 12, canal: 6, stream: 2.5, ditch: 1.2, drain: 1.2 };
const RAIL = { rail: 0, light_rail: 0, preserved: 0, narrow_gauge: 1, disused: 2, abandoned: 3 };

/** Klasa drogi gry z klasy i podklasy OpenMapTiles. */
export function roadFrom(cls, sub) {
	if (cls === 'minor') return ROAD.residential;
	if (cls === 'path') return ROAD[sub] ?? ROAD.path;
	if (cls === 'raceway' || cls === 'busway') return ROAD.service;
	return ROAD[cls] ?? null;
}

/** Rodzaj budynku gry z pola i wysokości (OpenMapTiles nie podaje rodzaju): 0 dom, 1 blok, 2 gosp., 3 hala, 4 usługi. */
export function buildingType(area, h) {
	if (h >= 12) return 1;
	if (area < 40) return 2;
	if (area > 1500) return 3;
	if (area > 400 && h >= 8) return 4;
	return 0;
}

/**
 * Konwersja jednego zdekodowanego kafla (z, x, y) na kawałki regionu. opts: { center, half (połowa boku regionu w
 * m), buildings: 'all' | 'large' | 'none' }. Zwraca { roads, rails, buildings, waterways, stations, platforms,
 * cover: [{ cls, rings }], places }.
 */
export function convertTile(tile, z, x, y, opts) {
	const out = { roads: [], rails: [], buildings: [], waterways: [], stations: [], platforms: [], cover: [], places: [] };
	const L = tile.layers;
	const ext = (L.transportation ?? L.building ?? L.water ?? Object.values(L)[0])?.extent ?? 4096;
	const T = tileToLocal(z, x, y, ext, opts.center);
	const half = opts.half;
	const dm = (flat) => {
		const m = T.line(flat);
		const o = new Array(m.length);
		for (let i = 0; i < m.length; i++) o[i] = Math.round(m[i] * 10);
		return o;
	};
	const inRegion = (flatM) => {
		for (let i = 0; i < flatM.length; i += 2) if (Math.abs(flatM[i]) < half && Math.abs(flatM[i + 1]) < half) return true;
		return false;
	};

	for (const f of L.transportation?.features ?? []) {
		const p = f.props;
		if (f.type !== 2 && !(p.class === 'path' && p.subclass === 'platform')) continue;
		if (p.brunnel === 'tunnel') continue;
		const bridge = p.brunnel === 'bridge' ? 1 : 0, layer = p.layer ?? 0;
		for (const part of f.geom) {
			const pieces = f.type === 3 ? [clipRing(part, ext)].filter(Boolean) : clipLine(part, ext);
			for (const piece of pieces) {
				const c = dm(piece);
				if (!inRegion(T.line(piece))) continue;
				if (p.class === 'path' && p.subclass === 'platform') { out.platforms.push([c]); continue; }
				if (p.class === 'rail') {
					const kind = RAIL[p.subclass] ?? (p.subclass ? null : 0);
					if (kind == null) continue;
					out.rails.push([kind, p.service ? 1 : 0, bridge, layer, c]);
					continue;
				}
				if (p.class === 'transit' || p.class === 'ferry' || p.class === 'pier' || p.class === 'aerialway') continue;
				const r = roadFrom(p.class, p.subclass);
				if (!r) continue;
				const surface = p.surface === 'unpaved' ? (r.id === 6 ? 4 : 3) : p.surface === 'paved' ? (r.id === 6 ? 1 : 0) : r.id <= 5 ? 0 : r.id === 6 ? 4 : 3;
				// jednokierunkowa (OpenMapTiles: 1 / −1); autostrady – jezdnie osobno dla kierunków
				const oneway = p.oneway === -1 ? -1 : p.oneway === 1 || p.class === 'motorway' ? 1 : 0;
				out.roads.push([r.id, Math.round(r.width * 10), surface, bridge, layer, c, oneway]);
			}
		}
	}

	if (opts.buildings !== 'none') {
		const minArea = opts.buildings === 'large' ? 60 : 6;
		for (const f of L.building?.features ?? []) {
			if (f.type !== 3) continue;
			const h = f.props.render_height ?? 5, h0 = f.props.render_min_height ?? 0;
			if (h0 > 0 && h - h0 < 2.5) continue; // podniesione części (wiaty nad przejściem) – pomijamy
			for (const ring of f.geom) {
				if (ringArea(ring) <= 0) continue; // otwory dziedzińców pomijamy (budynek pełny)
				const cl = clipRing(ring, ext);
				if (!cl) continue;
				const m = T.line(cl);
				let a = 0;
				for (let i = 0; i + 3 < m.length; i += 2) a += m[i] * m[i + 3] - m[i + 2] * m[i + 1];
				a = Math.abs(a / 2);
				if (a < minArea || !inRegion(m)) continue;
				out.buildings.push([buildingType(a, h), Math.round(h * 10), -1, h >= 8 ? 1 : 0, dm(cl)]);
			}
		}
	}

	for (const f of L.waterway?.features ?? []) {
		const w = WATERWAY[f.props.class];
		if (!w || f.props.brunnel === 'tunnel' || f.type !== 2) continue;
		for (const part of f.geom) for (const piece of clipLine(part, ext)) if (inRegion(T.line(piece))) out.waterways.push([Math.round(w * 10), dm(piece)]);
	}

	// pokrycie terenu: wielokąty w metrach lokalnych (pierścienie razem – parzysto-nieparzyste wypełnianie)
	const coverPoly = (f, cls) => {
		if (cls == null || f.type !== 3) return;
		const rings = [];
		for (const ring of f.geom) { const cl = clipRing(ring, ext); if (cl) rings.push(T.line(cl)); }
		if (rings.length) out.cover.push({ cls, rings });
	};
	for (const f of L.landcover?.features ?? []) coverPoly(f, LANDCOVER_SUB[f.props.subclass] ?? LANDCOVER[f.props.class]);
	for (const f of L.landuse?.features ?? []) coverPoly(f, LANDUSE[f.props.class]);
	for (const f of L.water?.features ?? []) if (f.props.brunnel !== 'tunnel') coverPoly(f, COVER.water);

	for (const f of L.poi?.features ?? []) {
		const p = f.props;
		if (f.type !== 1 || p.class !== 'railway' || !(p.subclass === 'station' || p.subclass === 'halt')) continue;
		const [u, v] = [f.geom[0][0], f.geom[0][1]];
		if (u < 0 || v < 0 || u > ext || v > ext) continue;
		const [mx, mz] = T.pt(u, v);
		if (Math.abs(mx) < half && Math.abs(mz) < half) out.stations.push([p.subclass === 'halt' ? 1 : 0, [Math.round(mx * 10), Math.round(mz * 10)], p['name:pl'] || p.name || '']);
	}
	for (const f of L.place?.features ?? []) {
		const p = f.props;
		if (f.type !== 1 || !p.name) continue;
		const [u, v] = [f.geom[0][0], f.geom[0][1]];
		if (u < 0 || v < 0 || u > ext || v > ext) continue;
		const [mx, mz] = T.pt(u, v);
		out.places.push({ name: p['name:pl'] || p.name, cls: p.class, rank: p.rank ?? 99, x: mx, z: mz });
	}
	return out;
}

/**
 * Rastrowanie wielokątów pokrycia do siatki n×n regionu (bok size m; komórka [0,0] w rogu płn.-zach.):
 * wypełnianie wierszami według reguły parzysto-nieparzystej. grid – Uint8Array n×n; pri – opcjonalna tablica
 * ważności klas (komórka zmienia się tylko na klasę co najmniej tak ważną jak obecna).
 */
export function rasterizePolygon(grid, n, size, rings, cls, pri = null) {
	const k = n / size, off = size / 2;
	let y0 = n, y1 = -1;
	const edges = [];
	for (const r of rings) {
		for (let i = 2; i < r.length; i += 2) {
			const ax = (r[i - 2] + off) * k - 0.5, ay = (r[i - 1] + off) * k - 0.5, bx = (r[i] + off) * k - 0.5, by = (r[i + 1] + off) * k - 0.5;
			if (ay === by) continue;
			edges.push(ax, ay, bx, by);
			y0 = Math.min(y0, Math.floor(Math.min(ay, by))); y1 = Math.max(y1, Math.ceil(Math.max(ay, by)));
		}
	}
	y0 = Math.max(0, y0); y1 = Math.min(n - 1, y1);
	const xs = [];
	for (let y = y0; y <= y1; y++) {
		xs.length = 0;
		for (let e = 0; e < edges.length; e += 4) {
			const ay = edges[e + 1], by = edges[e + 3];
			if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(edges[e] + ((y - ay) / (by - ay)) * (edges[e + 2] - edges[e]));
		}
		xs.sort((a, b) => a - b);
		for (let i = 0; i + 1 < xs.length; i += 2) {
			const a = Math.max(0, Math.ceil(xs[i])), b = Math.min(n - 1, Math.floor(xs[i + 1]));
			if (pri) { const pc = pri[cls]; for (let x = a; x <= b; x++) { const i = y * n + x; if (pc >= pri[grid[i]]) grid[i] = cls; } } else for (let x = a; x <= b; x++) grid[y * n + x] = cls;
		}
	}
}

/** Kolejność ważności miejscowości (etykiety, opis położenia). */
export const PLACE_ORDER = { city: 0, town: 1, village: 2, suburb: 3, quarter: 4, hamlet: 5, neighbourhood: 6, isolated_dwelling: 7 };

/**
 * Nazwy miejscowości regionu do opisu położenia i map: w obrębie regionu, bez powtórzeń (ta sama nazwa bliżej niż
 * 2 km – raz), najważniejsze najpierw (miasta, miasteczka, wsie, dzielnice, przysiółki); najwyżej max.
 */
export function pickLabels(places, half, center, toLonLat, max = 900) {
	const ok = places.filter((p) => PLACE_ORDER[p.cls] != null && Math.abs(p.x) < half && Math.abs(p.z) < half);
	ok.sort((a, b) => PLACE_ORDER[a.cls] - PLACE_ORDER[b.cls] || a.rank - b.rank);
	const out = [];
	for (const p of ok) {
		if (out.some((q) => q.name === p.name && Math.hypot(q.x - p.x, q.z - p.z) < 2000)) continue;
		out.push(p);
		if (out.length >= max) break;
	}
	return out.map((p) => {
		const ll = toLonLat(p.x, p.z, center);
		return { name: p.name, cls: p.cls, lon: +ll.lon.toFixed(5), lat: +ll.lat.toFixed(5), x: p.x, z: p.z };
	}).map(({ x, z, ...rest }) => rest);
}

/**
 * Miejsca startu z miejscowości regionu: miasta, potem miasteczka i wsie (wg rangi), nie bliżej krawędzi niż
 * margin; najwyżej max, nie bliżej siebie niż 3 km.
 */
export function pickPlaces(places, half, margin = 4000, max = 6) {
	const order = { city: 0, town: 1, village: 2, suburb: 3, hamlet: 4 };
	const ok = places.filter((p) => order[p.cls] != null && Math.abs(p.x) < half - margin && Math.abs(p.z) < half - margin);
	ok.sort((a, b) => order[a.cls] - order[b.cls] || a.rank - b.rank || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
	const out = [];
	for (const p of ok) {
		if (out.some((q) => q.name === p.name || Math.hypot(q.x - p.x, q.z - p.z) < 3000)) continue;
		out.push(p);
		if (out.length >= max) break;
	}
	return out;
}
