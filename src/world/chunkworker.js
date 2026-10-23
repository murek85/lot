// Wątek kafli otwartego świata: pobiera kafel wektorowy (OpenFreeMap z14) i kafle wysokości (Terrarium z12) –
// z IndexedDB albo z sieci (src/gen/store.js) – i składa dane kafla (src/world/chunkdata.js). Wiadomości:
// { type: 'chunk', req, x, y, origin } → { type: 'chunk', req, key, … } z buforami przekazanymi bez kopiowania.
import { fetchTile, gunzipBlob } from '../gen/store.js';
import { tileKey } from '../gen/tiles.js';
import { lotSource } from './lotsource.js';
import { buildBuildingTiles } from '../buildgeo.js';
import { riverArrays, railArrays, bridgeArrays, detailArrays } from '../objgeo.js';
import { landmarkArrays } from '../gen/landmarkgeo.js';
import { COVER } from '../gen/terrain.js';
import { densify, ribbon } from '../gfx/ribbon.js';
import { roadCrossings, CROSSING } from '../gen/crossings.js';
import { gridHeightAt } from './streamer.js';
import { CHUNK_Z, HEIGHT_Z, GRID, LOT_GRID, COVER_RES, lotHeights, fillHeights, shoreDistance, heightTilesFor, decodeTerrarium, chunkHeights, gridNormals, chunkObjects, chunkObjectsLot, chunkFrame, chunkMask, chunkOcclusion } from './chunkdata.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
let tpl = null;
// własne kafle gry (tools/bake-tiles.js): archiwa województw data/tiles/lot/<obszar>.pmtiles albo luźne pliki (src/world/lotsource.js);
// kafel → znacznik wypieczenia jego obszaru w kluczach pamięci kafli – po ponownym wypieczeniu obszaru nie wracają
// jego stare kafle z IndexedDB, a kafle pozostałych obszarów zostają
const lotTiles = () => lotSource().then((s) => s.own);
/** Kafel własny: wektorowy (pbf), pokrycie albo wysokości (gzip) – { buf, cached }. */
const lotFile = async (kind, z, x, y) => (await lotSource()).file(kind, z, x, y);
async function lotCover(z, x, y) {
	const t = await lotFile('cover', z, x, y);
	return t.buf.byteLength ? gunzipBlob(new Blob([t.buf])) : null;
}
/** Wysokości GUGiK kafla (z14 – siatka LOT_GRID², z11 – GRID², z marginesem) albo null. */
async function lotHeight(x, y, z = 14) {
	const own = await lotTiles();
	if (z === 14 ? !own.heights : !own.farHeights) return null;
	const t = await lotFile('height', z, x, y);
	return t.buf.byteLength ? lotHeights(await gunzipBlob(new Blob([t.buf]))) : null;
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
		// wysokości: GUGiK (własne kafle, ~12 m) albo Terrarium (~24 m)
		// daleki teren w obszarze własnych kafli – też GUGiK (bez uskoku na styku z bliskim terenem)
		const lotH = useLot ? await lotHeight(x, y) : far && own.z11.has(key) ? await lotHeight(x, y, Z) : null;
		const needTerrarium = !lotH || lotH.some(Number.isNaN);
		const heightsP = needTerrarium ? Promise.all(heightTilesFor(x, y, Z, HZ).map(async ([hx, hy]) => [`${hx}/${hy}`, await heightTile(hx, hy, HZ)])) : null;
		let mapT, osm, cover;
		const F = chunkFrame(x, y, origin, Z);
		if (useLot) {
			// własne kafle: obiekty z pełnymi znacznikami OSM, pokrycie z WorldCover
			const [vt, cv] = await Promise.all([lotFile('', Z, x, y), lotCover(Z, x, y)]);
			mapT = vt;
			({ osm, cover } = chunkObjectsLot(vt.buf, cv, x, y, origin, Z));
		} else {
			const url = (await mapTemplate()).replace('{z}', Z).replace('{x}', x).replace('{y}', y);
			mapT = await fetchTile(tileKey('ofm', Z, x, y), url);
			({ osm, cover } = chunkObjects(mapT.buf, x, y, origin, Z));
			// daleki teren w obszarze własnych kafli – pokrycie z WorldCover zamiast uproszczonych wielokątów mapy z11
			if (far && own.z11.has(key)) { const cv = await lotCover(Z, x, y); if (cv) cover = new Uint8Array(cv); }
		}
		const n = lotH && !far ? LOT_GRID : GRID;
		let H = lotH;
		if (!H) H = chunkHeights(x, y, new Map(await heightsP), Z, HZ);
		else if (needTerrarium) {
			// braki danych GUGiK (poza Polską: kafle przy granicy – Tatry, Beskidy, Sudety) – z Terrarium na tej samej siatce
			// co kafel (bliski – 129², daleki – 65²); inna siatka dawała odczyty poza tablicą (NaN: ściany, czarny obraz)
			fillHeights(H, chunkHeights(x, y, new Map(await heightsP), Z, HZ, n));
		}
		const g = gridNormals(H, F.w / (n - 1), F.h / (n - 1), n);
		// odległość od brzegu dla wody (głębia, piana); daleki teren – bez brzegów (głęboko)
		const shore = far ? new Uint8Array(cover.length).fill(255) : shoreDistance(cover, COVER_RES, F.w / COVER_RES);
		const mask = far ? new Uint8Array(0) : chunkMask(osm, F);
		// przyciemnienie gruntu przy budynkach i skraju lasu (daleki teren – bez)
		const occ = far ? new Uint8Array(0) : chunkOcclusion(osm, cover, F);
		const msg = {
			type: 'chunk', req, key: `${x}/${y}`, x, y, z: Z, n, shore, occ,
			frame: { x0: F.x0, z0: F.z0, w: F.w, h: F.h },
			heights: g.heights, normals: g.normals, min: g.min, max: g.max, cover, mask,
			// daleki kafel: bez obiektów, tylko miejscowości (mapy, miejsca startu)
			osm: far ? { roads: [], rails: [], buildings: [], waterways: [], power: [], landmarks: [], treeRows: [], stations: [], crossings: [], platforms: [], places: osm.places } : osm,
			ms: performance.now() - t0, cached: mapT.cached, source: useLot ? 'lot' : 'ofm',
		};
		// dane do późniejszej budowy obiektów (wysokości – kopia, oryginał odchodzi do wątku głównego)
		if (!far) remember(msg.key, { origin, osm, frame: msg.frame, n, heights: g.heights.slice(), cover: cover.slice() });
		// quiet – wczytanie tylko na potrzeby obiektów (bez odpowiedzi do wątku głównego)
		if (!e.quiet) self.postMessage(msg, [g.heights.buffer, g.normals.buffer, cover.buffer, mask.buffer, shore.buffer, occ.buffer]);
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

/**
 * Wstęgi dróg kafla w jednej siatce (kolejność rysowania od polnych do głównych – kolejność indeksów), na końcu
 * przejścia dla pieszych (src/gen/crossings.js) – na wierzchu jezdni. way – jezdnia jednokierunkowa (pasy ruchu bez osi).
 */
function roadArrays(osm, hAt) {
	const g = { pos: [], side: [], dist: [], idx: [], width: [], surf: [], cls: [], way: [], count: 0 };
	const add = (rb, width, surface, cls, way) => {
		for (const v of rb.pos) g.pos.push(v);
		for (let i = 0; i < rb.side.length; i++) { g.side.push(rb.side[i]); g.dist.push(rb.dist[i]); g.width.push(width); g.surf.push(surface); g.cls.push(cls); g.way.push(way); }
		for (const v of rb.idx) g.idx.push(v);
		g.count += rb.side.length;
	};
	for (const [cls, w10, surface, bridge, , c, oneway] of [...osm.roads].sort((a, b) => b[0] - a[0])) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
		if (pts.length < 4) continue;
		pts = densify(pts);
		const width = w10 / 10, n = pts.length / 2;
		let hFn = (x, z) => hAt(x, z) + 0.25;
		if (bridge) { const h0 = hAt(pts[0], pts[1]), h1 = hAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]); let i = 0; hFn = () => h0 + (h1 - h0) * (n > 1 ? i++ / (n - 1) : 0) + 0.6; }
		add(ribbon(pts, width / 2, hFn, g.count), width, surface, cls, oneway || cls === 0 ? 1 : 0);
	}
	// zebry: 2 cm nad jezdnią
	for (const z of roadCrossings(osm.roads, osm.buildings)) add(ribbon(z.pts, z.width / 2, (x, zz) => hAt(x, zz) + 0.27, g.count), z.width, 0, CROSSING, 0);
	const F = (a) => new Float32Array(a);
	return { pos: F(g.pos), side: F(g.side), dist: F(g.dist), width: F(g.width), surf: F(g.surf), cls: F(g.cls), way: F(g.way), idx: new Uint32Array(g.idx), count: g.count };
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
		// sfera otaczająca liczona tutaj (w wątku głównym computeBoundingSphere po setkach tysięcy wierzchołków to ~7 ms)
		const sphere = (p) => {
			let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
			for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]); }
			const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
			let r2 = 0;
			for (let i = 0; i < p.length; i += 3) r2 = Math.max(r2, (p[i] - c[0]) ** 2 + (p[i + 1] - c[1]) ** 2 + (p[i + 2] - c[2]) ** 2);
			return [...c, Math.sqrt(r2)];
		};
		const tiles = b.tiles.map((t) => ({
			sphere: sphere(t.pos),
			pos: new Float32Array(t.pos), nrm: new Float32Array(t.nrm), kind: new Float32Array(t.kind), uv: new Float32Array(t.uv),
			wall: new Float32Array(t.wall), roof: new Float32Array(t.roof), light: new Float32Array(t.light), idx: new Uint32Array(t.idx),
		}));
		const roads = roadArrays(d.osm, hAt);
		// rzeki, tory, mosty i perony, aleje i linie energetyczne (te same funkcje co w regionach – src/objgeo.js)
		const R = COVER_RES, f = d.frame;
		const coverAt = (px, pz) => {
			const i = Math.floor(((px - f.x0) / f.w) * R), j = Math.floor(((pz - f.z0) / f.h) * R);
			return i < 0 || j < 0 || i >= R || j >= R ? -1 : d.cover[j * R + i];
		};
		const rivers = riverArrays(d.osm.waterways, hAt).mesh;
		const rails = railArrays(d.osm.rails, hAt).mesh;
		const bridges = bridgeArrays(d.osm, hAt);
		const details = detailArrays(d.osm, hAt, coverAt, COVER, Infinity, (x * 7919 + y) % 100000);
		const landmarks = landmarkArrays(d.osm.landmarks ?? [], hAt);
		const transfer = [];
		const take = (o) => { for (const v of Object.values(o)) if (ArrayBuffer.isView(v)) transfer.push(v.buffer); };
		for (const t of tiles) take(t);
		for (const o of [roads, rivers, rails, bridges, details, details.pylons, landmarks.body, landmarks.rotor]) take(o);
		self.postMessage({
			type: 'objects', req, key, origin, buildings: { tiles, count: b.count, structures: b.structures, beacons: b.beacons },
			roads, rivers: { mesh: rivers, lines: [] }, rails: { mesh: rails, lines: [] }, bridges, details, landmarks, ms: performance.now() - t0,
		}, transfer);
	} catch (err) {
		self.postMessage({ type: 'error', req, key, message: String(err?.message ?? err) });
	}
}

self.onmessage = (e) => {
	if (e.data.type === 'chunk') chunkMsg(e);
	else if (e.data.type === 'objects') objectsMsg(e);
};
