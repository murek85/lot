// Wątek sieci ruchu otwartego świata: z kafli wokół samolotu (odczyt z pamięci kafli, przeliczenie jak w wątku kafli,
// pamięć ostatnich kafli) graf dróg dla samochodów i graf torów dla pociągów, z siatkami krawędzi – spakowane do
// tablic liczbowych (src/traffic/graph.js: packNetwork). Wiadomości: { type: 'net', req, roads: [[x, y]…],
// rails: [[x, y]…], origin } → { type: 'net', req, cars, trains, stations, ms }.
import { fetchTile } from '../gen/store.js';
import { tileKey } from '../gen/tiles.js';
import { CHUNK_Z, chunkObjects, chunkObjectsLot } from './chunkdata.js';
import { buildRoadGraph, edgeGrid, packNetwork } from '../traffic/graph.js';
import { railsAsRoads } from '../traffic/trains.js';

const OFM = 'https://tiles.openfreemap.org/planet';
// komórki siatek krawędzi – dzielniki kroku przesunięcia początku układu (14 080 m), siatki przesuwa się w całości
export const GRID_CARS = 256, GRID_TRAINS = 640;
let tpl = null, originKey = '';
const LOT = new URL('../../data/tiles/lot/', import.meta.url).href;
let lotp = null;
let lotStamp = '';
const lotTiles = () => (lotp ??= fetch(`${LOT}tiles.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
	.then((m) => {
		lotStamp = `v${m?.version ?? 0}-${Object.values(m?.areas ?? {}).map((a) => a.built).join('.')}`;
		return new Set(Object.values(m?.areas ?? {}).flatMap((a) => a.z14));
	}));
const cache = new Map(); // "x/y" → osm kafla (ostatnio używane)

async function osmOf(x, y, origin) {
	const k = `${x}/${y}`;
	if (cache.has(k)) { const v = cache.get(k); cache.delete(k); cache.set(k, v); return v; }
	// te same drogi co w scenie: własne kafle w ich obszarze, poza nim – OpenFreeMap (jak src/world/chunkworker.js)
	let osm;
	if ((await lotTiles()).has(k)) {
		const t = await fetchTile(`lot/${lotStamp}/${CHUNK_Z}/${x}/${y}`, `${LOT}${CHUNK_Z}/${x}/${y}.pbf`);
		({ osm } = chunkObjectsLot(t.buf, null, x, y, origin));
	} else {
		tpl ??= (await (await fetch(OFM)).json()).tiles[0];
		const t = await fetchTile(tileKey('ofm', CHUNK_Z, x, y), tpl.replace('{z}', CHUNK_Z).replace('{x}', x).replace('{y}', y));
		({ osm } = chunkObjects(t.buf, x, y, origin));
	}
	const v = { roads: osm.roads, rails: osm.rails, stations: osm.stations };
	cache.set(k, v);
	if (cache.size > 600) cache.delete(cache.keys().next().value);
	return v;
}

self.onmessage = async (e) => {
	const { type, req, roads, rails, origin } = e.data;
	if (type !== 'net') return;
	try {
		const t0 = performance.now();
		const ok = `${origin.lon},${origin.lat}`;
		if (ok !== originKey) { cache.clear(); originKey = ok; }
		const R = await Promise.all(roads.map(([x, y]) => osmOf(x, y, origin)));
		const T = await Promise.all(rails.map(([x, y]) => osmOf(x, y, origin)));
		const cg = buildRoadGraph(R.flatMap((o) => o.roads));
		const cars = packNetwork(cg, edgeGrid(cg.edges, GRID_CARS));
		const tg = buildRoadGraph(railsAsRoads(T.flatMap((o) => o.rails)), { maxClass: 2 });
		const trains = packNetwork(tg, edgeGrid(tg.edges, GRID_TRAINS));
		const stations = T.flatMap((o) => o.stations);
		self.postMessage({ type: 'net', req, cars: cars.packed, trains: trains.packed, stations, ms: performance.now() - t0 }, [...cars.transfer, ...trains.transfer]);
	} catch (err) {
		self.postMessage({ type: 'error', req, message: String(err?.message ?? err) });
	}
};
