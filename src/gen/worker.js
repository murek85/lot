// Worker generatora regionów: pobiera kafle wektorowe OpenFreeMap (z14, schemat OpenMapTiles) i kafle wysokości
// Terrarium, kafel po kaflu zapisuje je w IndexedDB (ponowne generowanie i przyszłe strumieniowanie bez pobierania),
// składa z nich region w formacie gry (te same pliki co data/regions/<id>/) i zapisuje go w magazynie.
// Wiadomości: { type: 'estimate' | 'generate', req, params } → { type: 'progress' | 'done' | 'error', req, … };
// { type: 'cancel' } przerywa bieżącą pracę.
import { decodeTile } from './mvt.js';
import { tilesFor, tileKey } from './tiles.js';
import { convertTile } from './convert.js';
import { buildRegion, pool, MAP_Z } from './build.js';
import { fetchTile, saveRegion, gzip, persist } from './store.js';
import { terrariumHeight } from '../geo.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
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

async function mapTile(x, y, signal) {
	const tpl = await mapTemplate(signal);
	const url = tpl.replace('{z}', MAP_Z).replace('{x}', x).replace('{y}', y);
	return fetchTile(tileKey('ofm', MAP_Z, x, y), url, signal);
}

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
	await persist();
	const { meta, data } = await buildRegion(params, {
		signal, progress, parallel: PARALLEL,
		mapTile: (x, y) => mapTile(x, y, signal),
		heightTile: (z, x, y) => heightTile(z, x, y, signal),
	});
	progress(0.94, 'Zapis regionu');
	const files = {};
	for (const [k, v] of Object.entries(data)) files[k] = await gzip(v);
	meta.bytes = Object.values(files).reduce((a, b) => a + b.size, 0);
	await saveRegion(meta, files);
	progress(1, 'Gotowe');
	return meta;
}
