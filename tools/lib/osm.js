// Obróbka danych OpenStreetMap do kompaktowej postaci gry: drogi, tory, budynki, cieki, linie energetyczne,
// szpalery drzew, stacje i przejazdy. Współrzędne w lokalnych metrach regionu (decymetry jako liczby całkowite).
import { lonLatToLocal } from '../../src/geo.js';
import { ROAD } from '../../src/gen/schema.js';

export { ROAD };
const LINK = /_link$/;
// Nawierzchnia: 0 asfalt, 1 kostka/beton, 2 bruk, 3 utwardzona (szuter), 4 gruntowa/piaszczysta
const SURFACE = {
	asphalt: 0, paved: 0, concrete: 1, 'concrete:plates': 1, paving_stones: 1, sett: 2, cobblestone: 2, unhewn_cobblestone: 2,
	compacted: 3, fine_gravel: 3, gravel: 3, pebblestone: 3, ground: 4, dirt: 4, sand: 4, earth: 4, grass: 4, unpaved: 4, mud: 4, wood: 1,
};
// Budynki: 0 dom, 1 blok, 2 gospodarczy/garaż, 3 przemysł/magazyn, 4 usługi/handel, 5 publiczny (szkoła, urząd),
// 6 kościół, 7 inny
const BUILDING = {
	house: 0, detached: 0, semidetached_house: 0, terrace: 0, bungalow: 0, residential: 0, farm: 0,
	apartments: 1, dormitory: 1, hotel: 1,
	garage: 2, garages: 2, shed: 2, outbuilding: 2, barn: 2, farm_auxiliary: 2, cowshed: 2, stable: 2, sty: 2, greenhouse: 2, hut: 2, carport: 2, roof: 2,
	industrial: 3, warehouse: 3, manufacture: 3, service: 3, storage_tank: 3, silo: 3,
	retail: 4, commercial: 4, supermarket: 4, kiosk: 4, office: 4,
	school: 5, public: 5, civic: 5, hospital: 5, kindergarten: 5, train_station: 5, university: 5, sports_hall: 5, fire_station: 5,
	church: 6, chapel: 6, cathedral: 6,
};
const DEFAULT_LEVELS = [1.4, 4, 1, 2, 2, 3, 2, 1.5];
const ROOF = { gabled: 1, hipped: 2, pyramidal: 2, flat: 0, skillion: 3, half_hipped: 2, mansard: 2, gambrel: 1, round: 0, dome: 0 };

const num = (v) => {
	const x = parseFloat(String(v ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : null;
};

/** Ilość punktów, przeliczona i zaokrąglona do decymetrów. */
function project(geom, center) {
	const out = new Array(geom.length * 2);
	geom.forEach((g, i) => {
		const p = lonLatToLocal(g.lon, g.lat, center);
		out[i * 2] = Math.round(p.x * 10);
		out[i * 2 + 1] = Math.round(p.z * 10);
	});
	return out;
}

/** Pole wielokąta (m², ze znakiem) z płaskiej listy decymetrów. */
export function polygonArea(c) {
	let a = 0;
	const n = c.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		a += c[i * 2] * c[j * 2 + 1] - c[j * 2] * c[i * 2 + 1];
	}
	return a / 2 / 100;
}

export function roadInfo(tags) {
	let hw = tags.highway;
	if (!hw) return null;
	hw = hw.replace(LINK, '');
	const r = ROAD[hw];
	if (!r) return null;
	let width = num(tags.width);
	const lanes = num(tags.lanes);
	if (!width && lanes && r.id <= 4) width = Math.max(r.width, lanes * 3.2);
	if (!width) width = r.width;
	const surface = SURFACE[tags.surface] ?? (r.id <= 5 ? 0 : r.id === 6 ? 4 : 3);
	// jednokierunkowa: 1 – zgodnie z kolejnością punktów, −1 – przeciwnie; autostrady i ronda domyślnie
	const ow = tags.oneway;
	const oneway = ow === '-1' || ow === 'reverse' ? -1 : ow === 'yes' || ow === '1' || ow === 'true' ? 1 : ow === 'no' ? 0
		: hw === 'motorway' || tags.junction === 'roundabout' || tags.junction === 'circular' ? 1 : 0;
	return { cls: r.id, width: Math.min(30, width), surface, oneway };
}

export function buildingInfo(tags) {
	const type = BUILDING[tags.building] ?? (tags.amenity === 'place_of_worship' ? 6 : tags.building === 'yes' ? 7 : 7);
	const levels = num(tags['building:levels']);
	const roofLevels = num(tags['roof:levels']) ?? 0;
	let height = num(tags.height);
	const hasLevels = levels != null;
	if (height == null) height = (levels ?? DEFAULT_LEVELS[type]) * 3 + 0.6 + roofLevels * 2;
	const roof = ROOF[tags['roof:shape']] ?? -1; // -1: do wyboru przez grę (domy – dwuspadowy, bloki – płaski)
	return { type, height: Math.min(120, height), roof, known: hasLevels || tags.height != null };
}

/** Zbiera elementy z wielu odpowiedzi Overpass (kafelki nakładają się – usuwa duplikaty po id). */
export function collect(responses, center) {
	const seen = new Set();
	const out = {
		roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [],
	};
	for (const res of responses) {
		for (const e of res.elements) {
			const key = e.type + e.id;
			if (seen.has(key)) continue;
			seen.add(key);
			const t = e.tags || {};
			if (e.type === 'node') {
				const p = lonLatToLocal(e.lon, e.lat, center);
				const xy = [Math.round(p.x * 10), Math.round(p.z * 10)];
				if (t.railway === 'station' || t.railway === 'halt') out.stations.push({ p: xy, name: t.name || '', halt: t.railway === 'halt' ? 1 : 0 });
				else if (t.railway === 'level_crossing' || t.railway === 'crossing') out.crossings.push({ p: xy, barrier: t['crossing:barrier'] && t['crossing:barrier'] !== 'no' ? 1 : 0 });
				continue;
			}
			if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
			const c = project(e.geometry, center);
			const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
			const tunnel = t.tunnel && t.tunnel !== 'no' ? 1 : 0;
			const layer = num(t.layer) ?? 0;
			if (t.building && !t['building:part']) {
				if (c.length < 8) continue;
				const b = buildingInfo(t);
				out.buildings.push({ c, ...b, name: t.name || undefined });
			} else if (t.highway) {
				const r = roadInfo(t);
				if (!r || tunnel) continue;
				if (t.area === 'yes') continue;
				out.roads.push({ c, ...r, bridge, layer });
			} else if (t.railway) {
				if (t.railway === 'platform') { out.platforms.push({ c }); continue; }
				const kind = { rail: 0, light_rail: 0, narrow_gauge: 1, disused: 2, abandoned: 3 }[t.railway];
				if (kind === undefined || tunnel) continue;
				out.rails.push({ c, kind, service: t.service ? 1 : 0, bridge, layer });
			} else if (t.waterway) {
				const w = { river: 12, canal: 6, stream: 2.5, ditch: 1.2, drain: 1.2 }[t.waterway];
				if (!w) continue;
				out.waterways.push({ c, width: num(t.width) ?? w });
			} else if (t.power === 'line' || t.power === 'minor_line') {
				out.power.push({ c, minor: t.power === 'minor_line' ? 1 : 0 });
			} else if (t.natural === 'tree_row') {
				out.treeRows.push({ c });
			}
		}
	}
	return out;
}
