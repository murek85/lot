// Wątek kafli otwartego świata: pobiera kafel wektorowy (OpenFreeMap z14) i kafle wysokości (Terrarium z12) –
// z IndexedDB albo z sieci (src/gen/store.js) – i składa dane kafla (src/world/chunkdata.js). Wiadomości:
// { type: 'chunk', req, x, y, origin } → { type: 'chunk', req, key, … } z buforami przekazanymi bez kopiowania.
import { fetchTile } from '../gen/store.js';
import { tileKey } from '../gen/tiles.js';
import { CHUNK_Z, HEIGHT_Z, GRID, heightTilesFor, decodeTerrarium, chunkHeights, gridNormals, chunkObjects, chunkFrame, chunkMask } from './chunkdata.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
let tpl = null;
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

self.onmessage = async (e) => {
	const { type, req, x, y, origin } = e.data;
	if (type !== 'chunk') return;
	// z – poziom kafla: CHUNK_Z (pełne kafle) albo FAR_Z (daleki teren: rzeźba z Terrarium tego samego poziomu, samo pokrycie)
	const Z = e.data.z ?? CHUNK_Z, far = Z !== CHUNK_Z, HZ = far ? Z : HEIGHT_Z;
	try {
		const t0 = performance.now();
		const url = (await mapTemplate()).replace('{z}', Z).replace('{x}', x).replace('{y}', y);
		const [mapT, ...hts] = await Promise.all([
			fetchTile(tileKey('ofm', Z, x, y), url),
			...heightTilesFor(x, y, Z, HZ).map(async ([hx, hy]) => [`${hx}/${hy}`, await heightTile(hx, hy, HZ)]),
		]);
		const F = chunkFrame(x, y, origin, Z);
		const H = chunkHeights(x, y, new Map(hts), Z, HZ);
		const g = gridNormals(H, F.w / (GRID - 1), F.h / (GRID - 1));
		const { osm, cover } = chunkObjects(mapT.buf, x, y, origin, Z);
		const mask = far ? new Uint8Array(0) : chunkMask(osm, F);
		const msg = {
			type: 'chunk', req, key: `${x}/${y}`, x, y, z: Z,
			frame: { x0: F.x0, z0: F.z0, w: F.w, h: F.h },
			heights: g.heights, normals: g.normals, min: g.min, max: g.max, cover, mask,
			osm: far ? { roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [], places: [] } : osm,
			ms: performance.now() - t0, cached: mapT.cached,
		};
		self.postMessage(msg, [g.heights.buffer, g.normals.buffer, cover.buffer, mask.buffer]);
	} catch (err) {
		self.postMessage({ type: 'error', req, key: `${x}/${y}`, message: String(err?.message ?? err) });
	}
};
