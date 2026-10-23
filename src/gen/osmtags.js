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
