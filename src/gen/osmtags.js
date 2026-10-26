// Znaczniki OpenStreetMap → klasy gry (drogi, nawierzchnie, budynki, dachy) – wspólne dla narzędzi regionów
// (tools/lib/osm.js, dane z Overpass) i własnych kafli otwartego świata (src/gen/lottiles.js).
import { ROAD } from './schema.js';

const LINK = /_link$/;
// Nawierzchnia: 0 asfalt, 1 kostka/beton, 2 bruk, 3 utwardzona (szuter), 4 gruntowa/piaszczysta
const SURFACE = {
	asphalt: 0, paved: 0, concrete: 1, 'concrete:plates': 1, paving_stones: 1, sett: 2, cobblestone: 2, unhewn_cobblestone: 2,
	compacted: 3, fine_gravel: 3, gravel: 3, pebblestone: 3, ground: 4, dirt: 4, sand: 4, earth: 4, grass: 4, unpaved: 4, mud: 4, wood: 1,
};
// Budynki: 0 dom, 1 blok, 2 gospodarczy/garaż, 3 przemysł/magazyn, 4 usługi/handel, 5 publiczny (szkoła, urząd),
// 6 kościół, 7 inny, 8 stadion / trybuna (beton bez okien)
const BUILDING = {
	house: 0, detached: 0, semidetached_house: 0, terrace: 0, bungalow: 0, residential: 0, farm: 0,
	apartments: 1, dormitory: 1, hotel: 1,
	garage: 2, garages: 2, shed: 2, outbuilding: 2, barn: 2, farm_auxiliary: 2, cowshed: 2, stable: 2, sty: 2, greenhouse: 2, hut: 2, carport: 2, roof: 2,
	industrial: 3, warehouse: 3, manufacture: 3, service: 3, storage_tank: 3, silo: 3,
	retail: 4, commercial: 4, supermarket: 4, kiosk: 4, office: 4,
	school: 5, public: 5, civic: 5, hospital: 5, kindergarten: 5, train_station: 5, university: 5, sports_hall: 5, fire_station: 5,
	church: 6, chapel: 6, cathedral: 6,
	stadium: 8, grandstand: 8,
};
const DEFAULT_LEVELS = [1.4, 4, 1, 2, 2, 3, 2, 1.5, 4];
const ROOF = { gabled: 1, hipped: 2, pyramidal: 2, flat: 0, skillion: 3, half_hipped: 2, mansard: 2, gambrel: 1, round: 0, dome: 0 };

export const num = (v) => {
	const x = parseFloat(String(v ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : null;
};

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


// Punkty orientacyjne: 0 elektrownia wiatrowa, 1 komin, 2 wieża szybowa, 3 wieża ciśnień, 4 maszt / wieża
// telekomunikacyjna. Domyślne wysokości – typowe w Polsce (wiatrak: wieża ~100 m, wirnik ~90 m).
export const LANDMARK = { wind: 0, chimney: 1, headframe: 2, waterTower: 3, mast: 4 };
const LANDMARK_H = [100, 60, 45, 28, 70];
const yes = (v) => v != null && v !== 'no' && v !== '0' && v !== 'false';

/** Rodzaj i wymiary punktu orientacyjnego ze znaczników OSM → { kind, height, rotor } albo null (pomijany). */
export function landmarkInfo(tags) {
	let kind = null;
	if (tags.power === 'generator') {
		if (tags['generator:source'] === 'wind' || tags['generator:method'] === 'wind_turbine') kind = LANDMARK.wind;
	} else if (tags.man_made === 'chimney') kind = LANDMARK.chimney;
	else if (tags.man_made === 'mineshaft') { if (yes(tags.headframe)) kind = LANDMARK.headframe; }
	else if (tags.man_made === 'water_tower') kind = LANDMARK.waterTower;
	else if (tags.man_made === 'mast' || tags.man_made === 'communications_tower') kind = LANDMARK.mast;
	else if (tags.man_made === 'tower' && (tags['tower:type'] === 'communication' || tags['tower:type'] === 'radio')) kind = LANDMARK.mast;
	if (kind == null) return null;
	let height = num(String(tags.height ?? '').replace(/\s*m$/, '')) ?? LANDMARK_H[kind];
	// kominy domów i niskie maszty z daleka niewidoczne; absurdalne wartości – przycięte
	if ((kind === LANDMARK.chimney && height < 20) || (kind === LANDMARK.mast && height < 25)) return null;
	height = Math.min(kind === LANDMARK.mast ? 350 : 250, height);
	const rotor = kind === LANDMARK.wind ? Math.min(170, num(tags['rotor:diameter']) ?? Math.min(130, height * 0.9)) : 0;
	return { kind, height, rotor };
}

// Części budynków 3D (building:part): kształty dachów → kody gry
export const ROOF_SHAPE = { flat: 0, gabled: 1, hipped: 2, pyramidal: 3, dome: 4, onion: 5, cone: 6, skillion: 0, round: 1, half_hipped: 2, side_hipped: 2, mansard: 2, gambrel: 1, saltbox: 1, gabled_row: 1, double_saltbox: 1, quadruple_saltbox: 2, crosspitched: 2, many: 2 };
const COLOUR = {
	white: 0xeeeeea, black: 0x202020, grey: 0x8a8a88, gray: 0x8a8a88, darkgrey: 0x505050, darkgray: 0x505050, lightgrey: 0xc0c0bc, lightgray: 0xc0c0bc, silver: 0xb8b8b8,
	red: 0x8e3a2a, darkred: 0x6a1c16, maroon: 0x6a1c16, brown: 0x6b4630, tan: 0xc0a07a, beige: 0xd8c9a6, cream: 0xe8dfc4, ivory: 0xece6d0,
	yellow: 0xd8c35a, gold: 0xc9a43a, orange: 0xc9783a, green: 0x4e7a48, darkgreen: 0x2f4f2c, lightgreen: 0x8fb57d, olive: 0x6b6b3a, teal: 0x3f7f78,
	blue: 0x3f5f8f, navy: 0x2a3550, lightblue: 0x8fb0c8, pink: 0xd8a0a0, purple: 0x6a4a7a, copper: 0x5f9a82, brick: 0x8a4632,
};
const MATERIAL_COLOUR = { brick: 0x8a4632, stone: 0xb0a890, concrete: 0xa0a09a, glass: 0x5f7a8a, metal: 0x8a8d90, copper: 0x5f9a82, wood: 0x7a5a3a, plaster: 0xd8d0bc, roof_tiles: 0x8a3a26, tile: 0x8a3a26, slate: 0x4a4e52, tar_paper: 0x3a3a3a, eternit: 0x8a8a84, zinc: 0x9aa0a4, steel: 0x8a8d90 };

/** Kolor OSM (nazwa albo #rgb / #rrggbb) → 0xRRGGBB, null – nieznany. */
export function parseColour(v) {
	if (!v) return null;
	const s = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
	if (COLOUR[s] != null) return COLOUR[s];
	let m = /^#?([0-9a-f]{6})$/.exec(s);
	if (m) return parseInt(m[1], 16);
	m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
	if (m) return parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16);
	return null;
}

/**
 * Część budynku ze znaczników → { minH, height, roof, roofH, wall, roofColour } (metry; kolory 0xRRGGBB albo -1).
 * height – wierzch dachu, null – brak danych (gra bierze wysokość budynku, w którym część stoi); roofH null – z kształtu
 * dachu i obrysu w grze. null – część pomijana (bez bryły).
 */
export function partInfo(tags) {
	const levels = num(tags['building:levels']), minLevel = num(tags['building:min_level']);
	const roofLevels = num(tags['roof:levels']) ?? 0;
	const roof = ROOF_SHAPE[tags['roof:shape']] ?? 0;
	let roofH = num(String(tags['roof:height'] ?? '').replace(/\s*m$/, ''));
	if (roofH == null && roofLevels) roofH = roofLevels * 2.8;
	let height = num(String(tags.height ?? '').replace(/\s*m$/, ''));
	if (height == null && levels != null) height = levels * 3.2 + (roofH ?? 0);
	const minH = num(String(tags.min_height ?? '').replace(/\s*m$/, '')) ?? (minLevel != null ? minLevel * 3.2 : 0);
	if (height != null && height - minH < 0.5) return null;
	const wall = parseColour(tags['building:colour'] ?? tags.colour) ?? MATERIAL_COLOUR[tags['building:material']] ?? -1;
	const roofColour = parseColour(tags['roof:colour']) ?? MATERIAL_COLOUR[tags['roof:material']] ?? -1;
	return { minH: Math.max(0, minH), height: height == null ? null : Math.min(250, height), roof, roofH, wall, roofColour };
}
