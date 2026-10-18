// Własne kafle gry (tools/bake-tiles.js, schemat tools/tiles/lot-schema.yml) → obiekty w formacie gry (jak
// osm.json.gz regionów): surowe znaczniki OSM przeliczane tą samą logiką co narzędzia regionów (src/gen/osmtags.js).
// W odróżnieniu od kafli OpenMapTiles mają rodzaje i dachy budynków, nawierzchnie, linie energetyczne, szpalery
// drzew i przejazdy kolejowe. Pokrycie terenu przychodzi osobno (raster z ESA WorldCover) – tu tylko woda z OSM
// (dokładny brzeg na rastrze pokrycia).
import { COVER } from './terrain.js';
import { tileToLocal, clipLine, clipRing } from './tiles.js';
import { ringArea } from './mvt.js';
import { roadInfo, buildingInfo, num } from './osmtags.js';

export const LOT_LAYERS = ['roads', 'rails', 'platforms', 'buildings', 'waterways', 'water', 'power', 'tree_rows', 'stations', 'crossings', 'places'];
const RAIL = { rail: 0, light_rail: 0, preserved: 0, narrow_gauge: 1, disused: 2, abandoned: 3 };
const WATERWAY = { river: 12, canal: 6, stream: 2.5, ditch: 1.2, drain: 1.2 };
const yes = (v) => v != null && v !== 'no' && v !== '0' && v !== 'false';

/**
 * Konwersja zdekodowanego kafla (z, x, y). opts: { center }. Zwraca { roads, rails, buildings, waterways, power,
 * treeRows, stations, crossings, platforms, cover: [{ cls, rings }] (woda), places } – współrzędne w decymetrach.
 */
export function convertLotTile(tile, z, x, y, opts) {
	const out = { roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [], cover: [], places: [] };
	const L = tile.layers;
	const ext = Object.values(L)[0]?.extent ?? 4096;
	const T = tileToLocal(z, x, y, ext, opts.center);
	const dm = (flat) => {
		const m = T.line(flat);
		const o = new Array(m.length);
		for (let i = 0; i < m.length; i++) o[i] = Math.round(m[i] * 10);
		return o;
	};
	// linie przycięte do kafla (kafle mają margines – bez przycięcia obiekty z sąsiednich kafli by się dublowały)
	const lines = (f, fn) => { if (f.type !== 2) return; for (const part of f.geom) for (const piece of clipLine(part, ext)) fn(dm(piece)); };
	// punkty tylko z wnętrza kafla
	const point = (f) => {
		if (f.type !== 1) return null;
		const [u, v] = f.geom[0];
		if (u < 0 || v < 0 || u >= ext || v >= ext) return null;
		return T.pt(u, v);
	};

	for (const f of L.roads?.features ?? []) {
		const p = f.props;
		if (yes(p.tunnel)) continue;
		const r = roadInfo(p);
		if (!r) continue;
		const bridge = yes(p.bridge) ? 1 : 0, layer = num(p.layer) ?? 0;
		lines(f, (c) => out.roads.push([r.cls, Math.round(r.width * 10), r.surface, bridge, layer, c, r.oneway]));
	}
	for (const f of L.rails?.features ?? []) {
		const p = f.props, kind = RAIL[p.railway];
		if (kind == null || yes(p.tunnel)) continue;
		lines(f, (c) => out.rails.push([kind, p.service ? 1 : 0, yes(p.bridge) ? 1 : 0, num(p.layer) ?? 0, c]));
	}
	for (const f of L.platforms?.features ?? []) {
		if (f.type === 2) lines(f, (c) => out.platforms.push([c]));
		else if (f.type === 3) for (const ring of f.geom) { const cl = clipRing(ring, ext); if (cl) out.platforms.push([dm(cl)]); }
	}
	for (const f of L.buildings?.features ?? []) {
		if (f.type !== 3) continue;
		const b = buildingInfo(f.props);
		for (const ring of f.geom) {
			if (ringArea(ring) <= 0) continue; // otwory dziedzińców pomijamy (budynek pełny)
			const cl = clipRing(ring, ext);
			if (!cl) continue;
			const m = T.line(cl);
			let a = 0;
			for (let i = 0; i + 3 < m.length; i += 2) a += m[i] * m[i + 3] - m[i + 2] * m[i + 1];
			if (Math.abs(a / 2) < 6) continue;
			out.buildings.push([b.type, Math.round(b.height * 10), b.roof, b.known ? 1 : 0, dm(cl)]);
		}
	}
	for (const f of L.waterways?.features ?? []) {
		const p = f.props, w = WATERWAY[p.waterway];
		if (!w || yes(p.tunnel)) continue;
		const width = Math.min(60, num(p.width) ?? w);
		lines(f, (c) => out.waterways.push([Math.round(width * 10), c]));
	}
	for (const f of L.water?.features ?? []) {
		if (f.type !== 3) continue;
		const rings = [];
		for (const ring of f.geom) { const cl = clipRing(ring, ext); if (cl) rings.push(T.line(cl)); }
		if (rings.length) out.cover.push({ cls: COVER.water, rings });
	}
	for (const f of L.power?.features ?? []) lines(f, (c) => out.power.push([f.props.power === 'minor_line' ? 1 : 0, c]));
	for (const f of L.tree_rows?.features ?? []) lines(f, (c) => out.treeRows.push([c]));
	for (const f of L.stations?.features ?? []) {
		const m = point(f);
		if (m) out.stations.push([f.props.railway === 'halt' ? 1 : 0, [Math.round(m[0] * 10), Math.round(m[1] * 10)], f.props.name ?? '']);
	}
	for (const f of L.crossings?.features ?? []) {
		const m = point(f);
		if (m) out.crossings.push([yes(f.props['crossing:barrier']) ? 1 : 0, [Math.round(m[0] * 10), Math.round(m[1] * 10)]]);
	}
	for (const f of L.places?.features ?? []) {
		const m = point(f), p = f.props;
		if (!m || !p.name) continue;
		// ranga jak w OpenMapTiles (mniejsza – ważniejsza): z liczby mieszkańców
		const pop = num(p.population) ?? 0;
		out.places.push({ name: p['name:pl'] || p.name, cls: p.place, rank: pop ? Math.max(1, 20 - Math.round(Math.log10(pop) * 3)) : 99, x: m[0], z: m[1] });
	}
	return out;
}
