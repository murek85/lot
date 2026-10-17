// Wypieka region gry z otwartych danych do data/regions/<id>/:
//   height.bin.gz – wysokość (Uint16, siatka heightRes²) z AWS Terrain Tiles (Terrarium, z12 ≈ 23 m w Polsce),
//   cover.bin.gz  – pokrycie terenu (Uint8, siatka coverRes², klasy COVER) z ESA WorldCover 2021 (10 m),
//   shore.bin.gz  – odległość od brzegu wody ze znakiem (Uint8, siatka heightRes²),
//   meta.json     – granice, zakresy, źródła i licencje.
// Użycie: npm run bake -- [id regionu]   (domyślnie bory-tucholskie; pobrane dane w tools/.cache)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REGIONS } from '../src/regions.js';
import { localToLonLat, lonToTileX, latToTileY, terrariumHeight, regionBounds } from '../src/geo.js';
import { fetchCached, pool } from './lib/net.js';
import { decodePng } from './lib/png.js';
import { openCog } from './lib/cog.js';
import { COVER, worldCoverClass, flattenWater, signedShoreDistance } from './lib/terrain.js';

const ZOOM = 12;
const TERRARIUM = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
const WORLDCOVER = (lat3, lon3) => {
	const ns = lat3 >= 0 ? `N${String(lat3).padStart(2, '0')}` : `S${String(-lat3).padStart(2, '0')}`;
	const ew = lon3 >= 0 ? `E${String(lon3).padStart(3, '0')}` : `W${String(-lon3).padStart(3, '0')}`;
	return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
};
const WC_PX = 12000; // pikseli WorldCover na stopień

const region = REGIONS[process.argv[2] || 'bory-tucholskie'];
if (!region) {
	console.error(`Nieznany region. Dostępne: ${Object.keys(REGIONS).join(', ')}`);
	process.exit(1);
}
const OUT = path.join(import.meta.dirname, '..', 'data', 'regions', region.id);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${s}`);

// Środek komórki (i, j) siatki n×n → długość/szerokość.
function cellLonLat(i, j, n) {
	const cell = region.size / n;
	return localToLonLat(-region.size / 2 + (i + 0.5) * cell, -region.size / 2 + (j + 0.5) * cell, region.center);
}

async function bakeHeight() {
	const n = region.heightRes;
	const b = regionBounds(region);
	const tx0 = Math.floor(lonToTileX(b.west, ZOOM)), tx1 = Math.floor(lonToTileX(b.east, ZOOM));
	const ty0 = Math.floor(latToTileY(b.north, ZOOM)), ty1 = Math.floor(latToTileY(b.south, ZOOM));
	const list = [];
	for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) list.push([x, y]);
	log(`Wysokości: ${list.length} kafelków Terrarium z${ZOOM}`);
	const tiles = new Map();
	await pool(list, 8, async ([x, y]) => {
		const png = decodePng(await fetchCached(TERRARIUM(x, y)));
		const h = new Float32Array(256 * 256);
		for (let k = 0; k < h.length; k++) {
			const p = k * png.channels;
			h[k] = terrariumHeight(png.data[p], png.data[p + 1], png.data[p + 2]);
		}
		tiles.set(`${x}/${y}`, h);
	});
	const px = (gx, gy) => {
		const t = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
		return t[(gy % 256) * 256 + (gx % 256)];
	};
	const out = new Float32Array(n * n);
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const { lon, lat } = cellLonLat(i, j, n);
			const fx = lonToTileX(lon, ZOOM) * 256 - 0.5, fy = latToTileY(lat, ZOOM) * 256 - 0.5;
			const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
			out[j * n + i] = (px(x, y) * (1 - u) + px(x + 1, y) * u) * (1 - v) + (px(x, y + 1) * (1 - u) + px(x + 1, y + 1) * u) * v;
		}
	}
	return out;
}

async function bakeCover() {
	const n = region.coverRes;
	const files = new Map();
	const fileFor = (lon, lat) => {
		const lat3 = Math.floor(lat / 3) * 3, lon3 = Math.floor(lon / 3) * 3;
		const key = `${lat3},${lon3}`;
		if (!files.has(key)) files.set(key, { lat3, lon3, cog: openCog(WORLDCOVER(lat3, lon3)) });
		return files.get(key);
	};
	// Najpierw lista potrzebnych kafelków, potem równoległe pobieranie, na końcu próbkowanie.
	const needed = new Map();
	const sample = new Array(n * n);
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const { lon, lat } = cellLonLat(i, j, n);
			const f = fileFor(lon, lat);
			const px = Math.floor((lon - f.lon3) * WC_PX), py = Math.floor((f.lat3 + 3 - lat) * WC_PX);
			sample[j * n + i] = [f, px, py];
		}
	}
	for (const f of files.values()) f.cog = await f.cog;
	for (const [f, px, py] of sample) {
		const tx = Math.floor(px / f.cog.tileW), ty = Math.floor(py / f.cog.tileH);
		needed.set(`${f.lat3},${f.lon3},${tx},${ty}`, [f, tx, ty]);
	}
	log(`Pokrycie: ${needed.size} kafelków WorldCover (${files.size} plik(i))`);
	let done = 0;
	await pool([...needed.values()], 6, async ([f, tx, ty]) => {
		await f.cog.tile(tx, ty);
		if (++done % 10 === 0) log(`  ${done}/${needed.size}`);
	});
	const out = new Uint8Array(n * n);
	for (let k = 0; k < sample.length; k++) {
		const [f, px, py] = sample[k];
		const { tileW, tileH } = f.cog;
		const tile = await f.cog.tile(Math.floor(px / tileW), Math.floor(py / tileH));
		out[k] = worldCoverClass(tile[(py % tileH) * tileW + (px % tileW)]);
	}
	return out;
}

function waterMask(cover, coverRes, n) {
	const k = coverRes / n;
	const mask = new Uint8Array(n * n);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		let w = 0;
		for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) if (cover[(j * k + dy) * coverRes + i * k + dx] === COVER.water) w++;
		mask[j * n + i] = w * 2 >= k * k ? 1 : 0;
	}
	return mask;
}

const gz = (arr) => zlib.gzipSync(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), { level: 9 });

const rawHeight = await bakeHeight();
const cover = await bakeCover();
const n = region.heightRes, cell = region.size / n;
const water = waterMask(cover, region.coverRes, n);
log('Gładzenie tafli wody i odległość od brzegu');
const height = flattenWater(rawHeight, water, n, Math.round(6000 / cell));
const shore = signedShoreDistance(water, n);

let hMin = Infinity, hMax = -Infinity;
for (const h of height) { if (h < hMin) hMin = h; if (h > hMax) hMax = h; }
hMin = Math.floor(hMin) - 1; hMax = Math.ceil(hMax) + 1;
const h16 = new Uint16Array(n * n);
for (let i = 0; i < h16.length; i++) h16[i] = Math.round(((height[i] - hMin) / (hMax - hMin)) * 65535);
const SHORE_STEP = 3; // metry na jednostkę; 128 = brzeg
const s8 = new Uint8Array(n * n);
for (let i = 0; i < s8.length; i++) s8[i] = Math.max(0, Math.min(255, Math.round(128 + (shore[i] * cell) / SHORE_STEP)));

const counts = Object.fromEntries(Object.keys(COVER).map((k) => [k, 0]));
const names = Object.keys(COVER);
for (const c of cover) counts[names[c]]++;
for (const k of names) counts[k] = +((counts[k] / cover.length) * 100).toFixed(1);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'height.bin.gz'), gz(h16));
fs.writeFileSync(path.join(OUT, 'cover.bin.gz'), gz(cover));
fs.writeFileSync(path.join(OUT, 'shore.bin.gz'), gz(s8));
const meta = {
	id: region.id,
	name: region.name,
	center: region.center,
	size: region.size,
	bounds: regionBounds(region),
	height: { file: 'height.bin.gz', res: n, min: hMin, max: hMax },
	cover: { file: 'cover.bin.gz', res: region.coverRes, classes: COVER, percent: counts },
	shore: { file: 'shore.bin.gz', res: n, metersPerUnit: SHORE_STEP, zero: 128 },
	sources: [
		{ name: 'AWS Terrain Tiles (Terrarium)', license: 'różne otwarte źródła, m.in. SRTM i EU-DEM – zob. github.com/tilezen/joerd' },
		{ name: 'ESA WorldCover 10 m 2021 v200', license: 'CC BY 4.0, © ESA WorldCover project / Copernicus Sentinel data 2021' },
	],
	baked: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
log(`Gotowe: ${path.relative(process.cwd(), OUT)} (wysokość ${hMin}–${hMax} m, pokrycie %: ${JSON.stringify(counts)})`);
