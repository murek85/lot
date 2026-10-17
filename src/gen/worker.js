// Worker generatora regionów: pobiera kafle wektorowe OpenFreeMap (z14, schemat OpenMapTiles) i kafle wysokości
// Terrarium, kafel po kaflu zapisuje je w IndexedDB (ponowne generowanie i przyszłe strumieniowanie bez pobierania),
// składa z nich region w formacie gry (te same pliki co data/regions/<id>/) i zapisuje go w magazynie.
// Wiadomości: { type: 'estimate' | 'generate', req, params } → { type: 'progress' | 'done' | 'error', req, … };
// { type: 'cancel' } przerywa bieżącą pracę.
import { decodeTile } from './mvt.js';
import { tilesFor, tileKey } from './tiles.js';
import { convertTile, rasterizePolygon, pickPlaces, COVER, COVER_PRIORITY, UNSET } from './convert.js';
import { packTerrain } from './terrain.js';
import { fetchTile, saveRegion, gzip, persist } from './store.js';
import { localToLonLat, lonToTileX, latToTileY, terrariumHeight, regionBounds } from '../geo.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
const MAP_Z = 14;
const LAYERS = ['transportation', 'building', 'waterway', 'water', 'landcover', 'landuse', 'poi', 'place'];
const PARALLEL = 8;

let abort = null;

self.onmessage = async (e) => {
	const { type, req, params } = e.data;
	if (type === 'cancel') { abort?.abort(); return; }
	abort = new AbortController();
	const signal = abort.signal;
	const progress = (p, label) => self.postMessage({ type: 'progress', req, p, label });
	try {
		const result = type === 'estimate' ? await estimate(params, signal) : await generate(params, signal, progress);
		self.postMessage({ type: 'done', req, result });
	} catch (err) {
		self.postMessage({ type: 'error', req, message: signal.aborted ? 'cancelled' : String(err?.message ?? err) });
	}
};

let tileUrl = null;
/** Szablon adresu kafli z TileJSON (OpenFreeMap zmienia wersję co kilka dni – adres bez stałej daty). */
async function mapTemplate(signal) {
	if (tileUrl) return tileUrl;
	const tj = await (await fetch(OFM, { signal })).json();
	tileUrl = tj.tiles[0];
	return tileUrl;
}

/** Równoległe przetwarzanie listy (najwyżej n naraz) z przerwaniem. */
async function pool(list, n, fn, signal) {
	let next = 0;
	const worker = async () => {
		while (next < list.length) {
			if (signal.aborted) throw new Error('cancelled');
			const i = next++;
			await fn(list[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
}

async function mapTile(x, y, signal) {
	const tpl = await mapTemplate(signal);
	const url = tpl.replace('{z}', MAP_Z).replace('{x}', x).replace('{y}', y);
	return fetchTile(tileKey('ofm', MAP_Z, x, y), url, signal);
}

const empty = () => ({ roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [] });

/** Szacunek przed generowaniem: 9 kafli rozłożonych po regionie → liczba obiektów, rozmiar pobierania, obciążenie. */
async function estimate(params, signal) {
	const { center, size, buildings = 'all', terrain = 'standard' } = params;
	const list = tilesFor(center, size, MAP_Z);
	const hz = terrain === 'detailed' ? 13 : 12;
	const heightTiles = tilesFor(center, size, hz).length;
	// próbki w siatce 3×3 (środki dziewiątych części regionu) – bliżej typowej gęstości niż sam środek
	const xs = [...new Set(list.map((t) => t[0]))], ys = [...new Set(list.map((t) => t[1]))];
	const pick = (arr, k) => arr[Math.min(arr.length - 1, Math.floor(((k + 0.5) / 3) * arr.length))];
	const samples = [];
	for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) samples.push([pick(xs, a), pick(ys, b)]);
	let bytes = 0, nb = 0, nr = 0, cached = 0;
	await pool(samples, PARALLEL, async ([x, y]) => {
		const t = await mapTile(x, y, signal);
		bytes += t.buf.byteLength;
		if (t.cached) cached++;
		if (!t.buf.byteLength) return;
		const out = convertTile(decodeTile(t.buf, ['transportation', 'building']), MAP_Z, x, y, { center, half: size / 2, buildings });
		nb += out.buildings.length;
		nr += out.roads.length;
	}, signal);
	const k = list.length / samples.length;
	const est = {
		mapTiles: list.length, heightTiles,
		buildings: Math.round(nb * k), roads: Math.round(nr * k),
		downloadMB: (bytes * k + heightTiles * (hz === 13 ? 90e3 : 110e3)) / 1e6,
	};
	// obciążenie gry: budynki to większość trójkątów sceny (Bory Tucholskie: 73 tys. – płynnie)
	est.load = est.buildings < 150e3 ? 'low' : est.buildings < 350e3 ? 'medium' : 'high';
	return est;
}

async function heightTile(z, x, y, signal) {
	const t = await fetchTile(tileKey('terrarium', z, x, y), TERRARIUM(z, x, y), signal);
	const h = new Float32Array(256 * 256);
	if (!t.buf.byteLength) return h; // brak kafla – poziom morza
	const bmp = await createImageBitmap(new Blob([t.buf], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
	const cv = new OffscreenCanvas(256, 256);
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	const d = ctx.getImageData(0, 0, 256, 256, { colorSpace: 'srgb' }).data;
	for (let k = 0; k < h.length; k++) h[k] = terrariumHeight(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]);
	return h;
}

async function generate(params, signal, progress) {
	const { id, name, center, size, buildings = 'all', terrain = 'standard' } = params;
	const detailed = terrain === 'detailed';
	const hz = detailed ? 13 : 12, n = detailed ? 4096 : 2048, coverRes = 4096, half = size / 2;
	await persist();

	// 1. mapa: kafel po kaflu – pobranie (albo magazyn), dekodowanie, konwersja, rastrowanie pokrycia
	const list = tilesFor(center, size, MAP_Z);
	const osm = empty();
	const cover = new Uint8Array(coverRes * coverRes).fill(UNSET);
	const allPlaces = [];
	let done = 0, bytes = 0, fromCache = 0;
	progress(0, `Mapa: 0 / ${list.length} kafli`);
	await pool(list, PARALLEL, async ([x, y]) => {
		const t = await mapTile(x, y, signal);
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
	await pool(hList, PARALLEL, async ([x, y]) => {
		tiles.set(`${x}/${y}`, await heightTile(hz, x, y, signal));
		done++;
		progress(0.72 + (done / hList.length) * 0.13, `Rzeźba terenu: ${done} / ${hList.length} kafli`);
	}, signal);
	progress(0.86, 'Siatka wysokości');
	const px = (gx, gy) => tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)?.[(gy & 255) * 256 + (gx & 255)] ?? 0;
	const raw = new Float32Array(n * n), cell = size / n;
	for (let j = 0; j < n; j++) {
		if (j % 256 === 0 && signal.aborted) throw new Error('cancelled');
		for (let i = 0; i < n; i++) {
			const { lon, lat } = localToLonLat(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, center);
			const fx = lonToTileX(lon, hz) * 256 - 0.5, fy = latToTileY(lat, hz) * 256 - 0.5;
			const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
			raw[j * n + i] = (px(x, y) * (1 - u) + px(x + 1, y) * u) * (1 - v) + (px(x, y + 1) * (1 - u) + px(x + 1, y + 1) * u) * v;
		}
	}
	tiles.clear();

	// 3. woda, brzegi, zapis
	progress(0.9, 'Tafle wody i brzegi');
	await new Promise((r) => setTimeout(r, 0));
	const { h16, s8, min, max, percent } = packTerrain(raw, cover, n, coverRes, size);
	const places = pickPlaces(allPlaces, half).map((p, i) => {
		const ll = localToLonLat(p.x, p.z, center);
		return { id: `p${i}`, name: p.name, cls: p.cls, lon: +ll.lon.toFixed(5), lat: +ll.lat.toFixed(5) };
	});
	if (!places.length) places.push({ id: 'p0', name: name, cls: 'centre', lon: center.lon, lat: center.lat });
	progress(0.94, 'Zapis regionu');
	const counts = Object.fromEntries(Object.entries(osm).map(([k, v]) => [k, v.length]));
	const files = {
		'height.bin.gz': await gzip(h16),
		'cover.bin.gz': await gzip(cover),
		'shore.bin.gz': await gzip(s8),
		'osm.json.gz': await gzip(JSON.stringify(osm)),
	};
	const meta = {
		id, name, center, size,
		bounds: regionBounds({ center, size }),
		height: { file: 'height.bin.gz', res: n, min, max },
		cover: { file: 'cover.bin.gz', res: coverRes, classes: COVER, percent },
		shore: { file: 'shore.bin.gz', res: n, metersPerUnit: 3, zero: 128 },
		osm: { file: 'osm.json.gz', counts },
		places,
		generated: { terrain, buildings, mapTiles: list.length, heightTiles: hList.length, downloadMB: +(bytes / 1e6).toFixed(1) },
		bytes: Object.values(files).reduce((a, b) => a + b.size, 0),
		sources: [
			{ name: 'AWS Terrain Tiles (Terrarium)', license: 'różne otwarte źródła, m.in. SRTM i EU-DEM – zob. github.com/tilezen/joerd' },
			{ name: 'OpenFreeMap (schemat OpenMapTiles)', license: '© OpenMapTiles, dane © współtwórcy OpenStreetMap (ODbL)' },
		],
		baked: new Date().toISOString(),
	};
	await saveRegion(meta, files);
	progress(1, 'Gotowe');
	return meta;
}
