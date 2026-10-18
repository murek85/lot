// Wątek kafli otwartego świata: pobiera kafel wektorowy (OpenFreeMap z14) i kafle wysokości (Terrarium z12) –
// z IndexedDB albo z sieci (src/gen/store.js) – i składa dane kafla (src/world/chunkdata.js). Wiadomości:
// { type: 'chunk', req, x, y, origin } → { type: 'chunk', req, key, … } z buforami przekazanymi bez kopiowania.
import { fetchTile, gunzipBlob } from '../gen/store.js';
import { tileKey } from '../gen/tiles.js';
import { buildBuildingTiles } from '../buildgeo.js';
import { densify, ribbon } from '../gfx/ribbon.js';
import { gridHeightAt } from './streamer.js';
import { CHUNK_Z, HEIGHT_Z, GRID, heightTilesFor, decodeTerrarium, chunkHeights, gridNormals, chunkObjects, chunkObjectsLot, chunkFrame, chunkMask } from './chunkdata.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
let tpl = null;
// własne kafle gry (tools/bake-tiles.js) – opis z listą kafli; bez niego (albo poza obszarami) – OpenFreeMap
const LOT = new URL('../../data/tiles/lot/', import.meta.url).href;
let lotp = null;
const lotTiles = () => (lotp ??= fetch(`${LOT}tiles.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => {
	const z14 = new Set(), z11 = new Set();
	for (const a of Object.values(m?.areas ?? {})) { for (const k of a.z14) z14.add(k); for (const k of a.z11 ?? []) z11.add(k); }
	return { z14, z11 };
}));
/** Raster pokrycia własnych kafli (gzip) albo null. */
async function lotCover(z, x, y) {
	const t = await fetchTile(`lotcover/${z}/${x}/${y}`, `${LOT}cover/${z}/${x}/${y}.bin.gz`);
	return t.buf.byteLength ? gunzipBlob(new Blob([t.buf])) : null;
}
const heightCache = new Map(); // "x/y" → Float32 256² (ostatnio używane)

async function mapTemplate() {
	if (!tpl) tpl = (await (await fetch(OFM)).json()).tiles[0];
	return tpl;
}

async function heightTile(x, y, HZ = HEIGHT_Z) {
	const k = `${HZ}/${x}/${y}`;
	if (heightCache.has(k)) { const v = heightCache.get(k); heightCache.delete(k); heightCache.set(k, v); return v; }
	const t = await fetchTile(tileKey('terrarium', HZ, x, y), TERRARIUM(HZ, x, y));
	let h = new Float32Array(256 * 256);
	if (t.buf.byteLength) {
		const bmp = await createImageBitmap(new Blob([t.buf], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
		const cv = new OffscreenCanvas(256, 256);
		const ctx = cv.getContext('2d', { willReadFrequently: true });
		ctx.drawImage(bmp, 0, 0);
		bmp.close();
		h = decodeTerrarium(ctx.getImageData(0, 0, 256, 256).data);
	}
	heightCache.set(k, h);
	if (heightCache.size > 48) heightCache.delete(heightCache.keys().next().value);
	return h;
}

async function chunkMsg(e) {
	const { req, x, y, origin } = e.data;
	// z – poziom kafla: CHUNK_Z (pełne kafle) albo FAR_Z (daleki teren: rzeźba z Terrarium tego samego poziomu, samo pokrycie)
	const Z = e.data.z ?? CHUNK_Z, far = Z !== CHUNK_Z, HZ = far ? Z : HEIGHT_Z;
	try {
		const t0 = performance.now();
		const own = await lotTiles(), key = `${x}/${y}`;
		const useLot = !far && own.z14.has(key);
		const heightsP = Promise.all(heightTilesFor(x, y, Z, HZ).map(async ([hx, hy]) => [`${hx}/${hy}`, await heightTile(hx, hy, HZ)]));
		let mapT, osm, cover;
		const F = chunkFrame(x, y, origin, Z);
		if (useLot) {
			// własne kafle: obiekty z pełnymi znacznikami OSM, pokrycie z WorldCover
			const [vt, cv] = await Promise.all([fetchTile(`lot/${Z}/${x}/${y}`, `${LOT}${Z}/${x}/${y}.pbf`), lotCover(Z, x, y)]);
			mapT = vt;
			({ osm, cover } = chunkObjectsLot(vt.buf, cv, x, y, origin, Z));
		} else {
			const url = (await mapTemplate()).replace('{z}', Z).replace('{x}', x).replace('{y}', y);
			mapT = await fetchTile(tileKey('ofm', Z, x, y), url);
			({ osm, cover } = chunkObjects(mapT.buf, x, y, origin, Z));
			// daleki teren w obszarze własnych kafli – pokrycie z WorldCover zamiast uproszczonych wielokątów mapy z11
			if (far && own.z11.has(key)) { const cv = await lotCover(Z, x, y); if (cv) cover = new Uint8Array(cv); }
		}
		const H = chunkHeights(x, y, new Map(await heightsP), Z, HZ);
		const g = gridNormals(H, F.w / (GRID - 1), F.h / (GRID - 1));
		const mask = far ? new Uint8Array(0) : chunkMask(osm, F);
		const msg = {
			type: 'chunk', req, key: `${x}/${y}`, x, y, z: Z,
			frame: { x0: F.x0, z0: F.z0, w: F.w, h: F.h },
			heights: g.heights, normals: g.normals, min: g.min, max: g.max, cover, mask,
			// daleki kafel: bez obiektów, tylko miejscowości (mapy, miejsca startu)
			osm: far ? { roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [], places: osm.places } : osm,
			ms: performance.now() - t0, cached: mapT.cached, source: useLot ? 'lot' : 'ofm',
		};
		// dane do późniejszej budowy obiektów (wysokości – kopia, oryginał odchodzi do wątku głównego)
		if (!far) remember(msg.key, { origin, osm, frame: msg.frame, heights: g.heights.slice() });
		// quiet – wczytanie tylko na potrzeby obiektów (bez odpowiedzi do wątku głównego)
		if (!e.quiet) self.postMessage(msg, [g.heights.buffer, g.normals.buffer, cover.buffer, mask.buffer]);
	} catch (err) {
		if (e.quiet) throw err;
		self.postMessage({ type: 'error', req, key: `${x}/${y}`, message: String(err?.message ?? err) });
	}
}

// --- obiekty kafla (budynki, drogi) liczone tutaj – wątek główny tylko tworzy z tablic siatki ---
const recent = new Map(); // "x/y" → { origin, osm, frame, heights } (ostatnio wczytane kafle z14)
function remember(key, v) {
	recent.delete(key);
	recent.set(key, v);
	if (recent.size > 64) recent.delete(recent.keys().next().value);
}
const sameOrigin = (a, b) => a.lon === b.lon && a.lat === b.lat;

/** Wstęgi dróg kafla w jednej siatce (kolejność rysowania od polnych do głównych – kolejność indeksów). */
function roadArrays(osm, hAt) {
	const g = { pos: [], side: [], dist: [], idx: [], width: [], surf: [], cls: [], count: 0 };
	for (const [cls, w10, surface, bridge, , c] of [...osm.roads].sort((a, b) => b[0] - a[0])) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
		if (pts.length < 4) continue;
		pts = densify(pts);
		const width = w10 / 10, n = pts.length / 2;
		let hFn = (x, z) => hAt(x, z) + 0.25;
		if (bridge) { const h0 = hAt(pts[0], pts[1]), h1 = hAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]); let i = 0; hFn = () => h0 + (h1 - h0) * (n > 1 ? i++ / (n - 1) : 0) + 0.6; }
		const rb = ribbon(pts, width / 2, hFn, g.count);
		for (const v of rb.pos) g.pos.push(v);
		for (let i = 0; i < rb.side.length; i++) { g.side.push(rb.side[i]); g.dist.push(rb.dist[i]); g.width.push(width); g.surf.push(surface); g.cls.push(cls); }
		for (const v of rb.idx) g.idx.push(v);
		g.count += rb.side.length;
	}
	const F = (a) => new Float32Array(a);
	return { pos: F(g.pos), side: F(g.side), dist: F(g.dist), width: F(g.width), surf: F(g.surf), cls: F(g.cls), idx: new Uint32Array(g.idx), count: g.count };
}

async function objectsMsg(e) {
	const { req, key, x, y, origin } = e.data;
	try {
		const t0 = performance.now();
		let d = recent.get(key);
		if (!d || !sameOrigin(d.origin, origin)) {
			// nie ma w pamięci (albo inny początek układu) – kafel od nowa (z magazynu – szybko)
			await chunkMsg({ data: { req: -1, x, y, origin, z: CHUNK_Z }, quiet: true });
			d = recent.get(key);
			if (!d) throw new Error('brak danych kafla');
		}
		const hAt = (px, pz) => gridHeightAt(d, px, pz);
		const b = buildBuildingTiles(d.osm.buildings, hAt);
		const tiles = b.tiles.map((t) => ({
			pos: new Float32Array(t.pos), nrm: new Float32Array(t.nrm), kind: new Float32Array(t.kind), uv: new Float32Array(t.uv),
			wall: new Float32Array(t.wall), roof: new Float32Array(t.roof), light: new Float32Array(t.light), idx: new Uint32Array(t.idx),
		}));
		const roads = roadArrays(d.osm, hAt);
		const transfer = [];
		for (const t of tiles) for (const k of Object.keys(t)) transfer.push(t[k].buffer);
		for (const k of ['pos', 'side', 'dist', 'width', 'surf', 'cls', 'idx']) transfer.push(roads[k].buffer);
		self.postMessage({ type: 'objects', req, key, origin, buildings: { tiles, count: b.count, structures: b.structures, beacons: b.beacons }, roads, ms: performance.now() - t0 }, transfer);
	} catch (err) {
		self.postMessage({ type: 'error', req, key, message: String(err?.message ?? err) });
	}
}

self.onmessage = (e) => {
	if (e.data.type === 'chunk') chunkMsg(e);
	else if (e.data.type === 'objects') objectsMsg(e);
};
