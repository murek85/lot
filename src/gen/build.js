// Rdzeń generatora regionów, wspólny dla workera w grze (src/gen/worker.js) i narzędzia wypiekania regionów
// wbudowanych (tools/bake-gen.js): kafle wektorowe OpenMapTiles z14 → obiekty gry i mapa pokrycia, kafle wysokości
// Terrarium → siatka wysokości, woda i brzegi. Pobieranie, dekodowanie PNG i zapis dostarcza wołający (io).
import { decodeTile } from './mvt.js';
import { tilesFor } from './tiles.js';
import { convertTile, rasterizePolygon, pickPlaces, pickLabels, COVER, COVER_PRIORITY, UNSET } from './convert.js';
import { packTerrain, SHORE_STEP } from './terrain.js';
import { localToLonLat, lonToTileX, latToTileY, regionBounds } from '../geo.js';

export const MAP_Z = 14;
export const LAYERS = ['transportation', 'building', 'waterway', 'water', 'landcover', 'landuse', 'poi', 'place'];
export const SOURCES = [
	{ name: 'AWS Terrain Tiles (Terrarium)', license: 'różne otwarte źródła, m.in. SRTM i EU-DEM – zob. github.com/tilezen/joerd' },
	{ name: 'OpenFreeMap (schemat OpenMapTiles)', license: '© OpenMapTiles, dane © współtwórcy OpenStreetMap (ODbL)' },
];

/** Równoległe przetwarzanie listy (najwyżej n naraz) z przerwaniem. */
export async function pool(list, n, fn, signal) {
	let next = 0;
	const worker = async () => {
		while (next < list.length) {
			if (signal?.aborted) throw new Error('cancelled');
			const i = next++;
			await fn(list[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
}

const empty = () => ({ roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [] });

/**
 * Miejsca startu: podane z nazwy (regiony wbudowane – z odmianą gen/instr, kolejność jak na liście) albo wybrane
 * z miejscowości regionu; miejscowość, od której region wziął nazwę, na początku (domyślny start).
 */
function startPlaces(allPlaces, { name, center, size, places: wanted }) {
	const half = size / 2;
	let picked;
	if (wanted?.length) {
		picked = [];
		for (const w of wanted) {
			const cands = allPlaces.filter((p) => p.name === w.name && Math.abs(p.x) < half && Math.abs(p.z) < half);
			cands.sort((a, b) => a.rank - b.rank);
			if (cands[0]) picked.push({ ...cands[0], gen: w.gen, instr: w.instr, id: w.id });
			else console.warn(`Brak miejscowości „${w.name}” w regionie`);
		}
	} else {
		picked = pickPlaces(allPlaces, half);
		const own = picked.findIndex((p) => p.name.toLowerCase() === String(name).toLowerCase());
		if (own > 0) picked.unshift(...picked.splice(own, 1));
	}
	const out = picked.map((p, i) => {
		const ll = localToLonLat(p.x, p.z, center);
		const o = { id: p.id ?? `p${i}`, name: p.name, cls: p.cls, lon: +ll.lon.toFixed(5), lat: +ll.lat.toFixed(5) };
		if (p.gen) Object.assign(o, { gen: p.gen, instr: p.instr });
		return o;
	});
	if (!out.length) out.push({ id: 'p0', name, cls: 'centre', lon: center.lon, lat: center.lat });
	return out;
}

/**
 * Buduje region. params: { id, name, center, size, terrain: 'standard' | 'detailed', buildings, places? }.
 * io: { mapTile(x, y) → { buf, cached }, heightTile(z, x, y) → Float32Array 256², progress(p, label), signal,
 * parallel }. Zwraca { meta (bez rozmiaru plików), data: { 'height.bin.gz': Uint16Array, 'cover.bin.gz': Uint8Array,
 * 'shore.bin.gz': Uint8Array, 'osm.json.gz': string } } – dane do spakowania gzipem przez wołającego.
 */
export async function buildRegion(params, io) {
	const { id, name, center, size, buildings = 'all', terrain = 'standard' } = params;
	const { signal, progress = () => {} } = io;
	const parallel = io.parallel ?? 8;
	const detailed = terrain === 'detailed';
	const hz = detailed ? 13 : 12, n = detailed ? 4096 : 2048, coverRes = 4096, half = size / 2;

	// 1. mapa: kafel po kaflu – pobranie (albo pamięć), dekodowanie, konwersja, rastrowanie pokrycia
	const list = tilesFor(center, size, MAP_Z);
	const osm = empty();
	const cover = new Uint8Array(coverRes * coverRes).fill(UNSET);
	const allPlaces = [];
	let done = 0, bytes = 0, fromCache = 0;
	progress(0, `Mapa: 0 / ${list.length} kafli`);
	await pool(list, parallel, async ([x, y]) => {
		const t = await io.mapTile(x, y);
		bytes += t.buf.byteLength;
		if (t.cached) fromCache++;
		if (t.buf.byteLength) {
			const out = convertTile(decodeTile(t.buf, LAYERS), MAP_Z, x, y, { center, half, buildings });
			for (const k of ['roads', 'rails', 'buildings', 'waterways', 'stations', 'platforms']) for (const o of out[k]) osm[k].push(o);
			for (const c of out.cover) rasterizePolygon(cover, coverRes, size, c.rings, c.cls, COVER_PRIORITY);
			allPlaces.push(...out.places);
		}
		done++;
		if (done % 8 === 0 || done === list.length) {
			progress((done / list.length) * 0.72, `Mapa: ${done} / ${list.length} kafli · ${(bytes / 1e6).toFixed(0)} MB${fromCache ? ` (${fromCache} z pamięci)` : ''}`);
		}
	}, signal);
	for (let i = 0; i < cover.length; i++) if (cover[i] === UNSET) cover[i] = COVER.crop;

	// 2. wysokości: kafle Terrarium → siatka n×n (dwuliniowo, jak w narzędziu wypiekania)
	const hList = tilesFor(center, size, hz, 2000);
	const tiles = new Map();
	done = 0;
	await pool(hList, parallel, async ([x, y]) => {
		tiles.set(`${x}/${y}`, await io.heightTile(hz, x, y));
		done++;
		progress(0.72 + (done / hList.length) * 0.13, `Rzeźba terenu: ${done} / ${hList.length} kafli`);
	}, signal);
	progress(0.86, 'Siatka wysokości');
	const px = (gx, gy) => tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)?.[(gy & 255) * 256 + (gx & 255)] ?? 0;
	const raw = new Float32Array(n * n), cell = size / n;
	for (let j = 0; j < n; j++) {
		if (j % 256 === 0 && signal?.aborted) throw new Error('cancelled');
		for (let i = 0; i < n; i++) {
			const { lon, lat } = localToLonLat(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, center);
			const fx = lonToTileX(lon, hz) * 256 - 0.5, fy = latToTileY(lat, hz) * 256 - 0.5;
			const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
			raw[j * n + i] = (px(x, y) * (1 - u) + px(x + 1, y) * u) * (1 - v) + (px(x, y + 1) * (1 - u) + px(x + 1, y + 1) * u) * v;
		}
	}
	tiles.clear();

	// 3. woda, brzegi, miejsca startu
	progress(0.9, 'Tafle wody i brzegi');
	await new Promise((r) => setTimeout(r, 0));
	const { h16, s8, min, max, percent } = packTerrain(raw, cover, n, coverRes, size);
	const places = startPlaces(allPlaces, params);
	const counts = Object.fromEntries(Object.entries(osm).map(([k, v]) => [k, v.length]));
	const meta = {
		id, name, center, size,
		bounds: regionBounds({ center, size }),
		height: { file: 'height.bin.gz', res: n, min, max },
		cover: { file: 'cover.bin.gz', res: coverRes, classes: COVER, percent },
		shore: { file: 'shore.bin.gz', res: n, metersPerUnit: SHORE_STEP, zero: 128 },
		osm: { file: 'osm.json.gz', counts },
		places,
		labels: pickLabels(allPlaces, half, center, localToLonLat),
		generated: { terrain, buildings, mapTiles: list.length, heightTiles: hList.length, downloadMB: +(bytes / 1e6).toFixed(1) },
		sources: SOURCES,
		baked: new Date().toISOString(),
	};
	return { meta, data: { 'height.bin.gz': h16, 'cover.bin.gz': cover, 'shore.bin.gz': s8, 'osm.json.gz': JSON.stringify(osm) } };
}
