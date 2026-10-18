// Własne kafle otwartego świata dla obszaru (np. województwa) → data/tiles/lot/:
//   {z}/{x}/{y}.pbf          – kafle wektorowe ze schematu tools/tiles/lot-schema.yml (Planetiler, z11–z14):
//                              surowe znaczniki OSM – drogi, tory, budynki z rodzajem i dachem, cieki, woda, linie
//                              energetyczne, szpalery, stacje, przejazdy, perony, miejscowości;
//   cover/{z}/{x}/{y}.bin.gz – pokrycie terenu 256² (klasy COVER) z ESA WorldCover 10 m, dla z14 i z11; w z14 drzewa
//                              z WorldCover w zabudowie OSM (osiedla, usługi, przemysł – poza lasem OSM) → zabudowa;
//   height/{z}/{x}/{y}.bin.gz – wysokości z14: 131², z11: 67² (Int16, decymetry; wierzchołki siatki + margines) z numerycznego
//                              modelu terenu GUGiK (LIDAR, usługa WCS w układzie Web Mercator);
//   tiles.json               – opis: obszary, granice, lista kafli z14 w całości wewnątrz obszaru (tylko tych gra
//                              używa – kafle na granicy wyciągu są niepełne, tam zostaje OpenFreeMap).
// Wejście w tools/.cache/tiles-src/: planetiler.jar, <obszar>-latest.osm.pbf i <obszar>.poly (Geofabrik).
// Użycie: npm run bake:tiles -- slaskie [--skip-vector] [--skip-cover] [--skip-height]
// Dane © współtwórcy OpenStreetMap (ODbL), ESA WorldCover 2021 (CC BY 4.0), GUGiK (NMT).
// Dane © współtwórcy OpenStreetMap (ODbL), ESA WorldCover 2021 (CC BY 4.0).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { lonToTileX, latToTileY } from '../src/geo.js';
import { tilePointLonLat } from '../src/gen/tiles.js';
import { worldCoverClass, COVER } from '../src/gen/terrain.js';
import { decodeTile } from '../src/gen/mvt.js';
import { rasterizePolygon } from '../src/gen/convert.js';
import { readFloatTiff } from './lib/tiff.js';
import { openCog } from './lib/cog.js';
import { pool } from './lib/net.js';
import { readPoly, inPoly } from './lib/poly.js';

const RES = 256; // piksele pokrycia na bok kafla (jak COVER_RES w src/world/chunkdata.js)
const HN = 131; // siatka wysokości kafla z14: 129 wierzchołków (~12 m) + margines po jednym z każdej strony
const WCS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF';
const WC_PX = 12000; // pikseli WorldCover na stopień
const WORLDCOVER = (lat3, lon3) => `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N${String(lat3).padStart(2, '0')}E${String(lon3).padStart(3, '0')}_Map.tif`;
const SRC = path.join(import.meta.dirname, '.cache', 'tiles-src');
const OUT = path.join(import.meta.dirname, '..', 'data', 'tiles', 'lot');
const args = process.argv.slice(2);
const area = args.find((a) => !a.startsWith('--')) || 'slaskie';
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);

// --- 1. kafle wektorowe ---
if (!args.includes('--skip-vector')) {
	log(`Planetiler: ${area}-latest.osm.pbf → ${OUT}`);
	const r = spawnSync('java', ['-Xmx6g', '-jar', path.join(SRC, 'planetiler.jar'), 'generate-custom',
		`--schema=${path.join(import.meta.dirname, 'tiles', 'lot-schema.yml')}`, `--pbf=${path.join(SRC, `${area}-latest.osm.pbf`)}`,
		`--output=${OUT}/?format=files`, '--tile_compression=none', '--minzoom=11', '--maxzoom=14', '--force', `--tmpdir=${path.join(SRC, 'tmp')}`],
	{ stdio: ['ignore', 'ignore', 'inherit'] });
	if (r.status !== 0) throw new Error(`Planetiler zakończył się kodem ${r.status}`);
}

// --- 2. obszar: wielokąt z pliku .poly, kafle z14 w całości wewnątrz ---
const rings = readPoly(fs.readFileSync(path.join(SRC, `${area}.poly`), 'utf8'));
let W = 180, E = -180, S = 90, N = -90;
for (const { pts } of rings) for (const [lon, lat] of pts) { W = Math.min(W, lon); E = Math.max(E, lon); S = Math.min(S, lat); N = Math.max(N, lat); }
const tilesIn = (z, test) => {
	const out = [];
	for (let y = Math.floor(latToTileY(N, z)); y <= Math.floor(latToTileY(S, z)); y++) {
		for (let x = Math.floor(lonToTileX(W, z)); x <= Math.floor(lonToTileX(E, z)); x++) if (test(z, x, y)) out.push([x, y]);
	}
	return out;
};
// kafel w całości wewnątrz: rogi, środki boków i środek w wielokącie (granica województwa jest gładka w skali 1,5 km)
const inside = (z, x, y) => [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]
	.every(([u, v]) => { const p = tilePointLonLat(z, x, y, u * 4096, v * 4096, 4096); return inPoly(rings, p.lon, p.lat); });
const touches = (z, x, y) => [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]
	.some(([u, v]) => { const p = tilePointLonLat(z, x, y, u * 4096, v * 4096, 4096); return inPoly(rings, p.lon, p.lat); });
const z14 = tilesIn(14, inside);
const z11 = tilesIn(11, touches);
log(`Obszar ${area}: ${z14.length} kafli z14 w całości wewnątrz, ${z11.length} kafli z11`);

// --- 3. pokrycie z WorldCover (zapytania Range do COG, wiersz po wierszu z północy) ---
const files = new Map();
const fileFor = (lon, lat) => {
	const lat3 = Math.floor(lat / 3) * 3, lon3 = Math.floor(lon / 3) * 3;
	const key = `${lat3},${lon3}`;
	if (!files.has(key)) files.set(key, { lat3, lon3, cog: openCog(WORLDCOVER(lat3, lon3)) });
	return files.get(key);
};
async function coverTiles(z, list) {
	const rows = new Map();
	for (const t of list) { if (!rows.has(t[1])) rows.set(t[1], []); rows.get(t[1]).push(t[0]); }
	let done = 0;
	for (const y of [...rows.keys()].sort((a, b) => a - b)) {
		// próbki wiersza kafli: środki komórek 128² → piksel WorldCover
		const jobs = rows.get(y).map((x) => {
			const s = new Array(RES * RES);
			for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
				const p = tilePointLonLat(z, x, y, ((i + 0.5) / RES) * 4096, ((j + 0.5) / RES) * 4096, 4096);
				const f = fileFor(p.lon, p.lat);
				s[j * RES + i] = [f, Math.floor((p.lon - f.lon3) * WC_PX), Math.floor((f.lat3 + 3 - p.lat) * WC_PX)];
			}
			return { x, s };
		});
		for (const f of files.values()) f.cog = await f.cog;
		const need = new Map();
		let minTy = Infinity;
		for (const { s } of jobs) for (const [f, px, py] of s) {
			const tx = Math.floor(px / f.cog.tileW), ty = Math.floor(py / f.cog.tileH);
			need.set(`${f.lat3},${f.lon3},${tx},${ty}`, [f, tx, ty]);
			minTy = Math.min(minTy, ty);
		}
		await pool([...need.values()], 8, ([f, tx, ty]) => f.cog.tile(tx, ty));
		for (const { x, s } of jobs) {
			const out = new Uint8Array(RES * RES);
			for (let k = 0; k < s.length; k++) {
				const [f, px, py] = s[k], { tileW, tileH } = f.cog;
				const tile = await f.cog.tile(Math.floor(px / tileW), Math.floor(py / tileH));
				out[k] = worldCoverClass(tile[(py % tileH) * tileW + (px % tileW)]);
			}
			if (z === 14) builtFromOsm(out, x, y);
			const file = path.join(OUT, 'cover', String(z), String(x), `${y}.bin.gz`);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, zlib.gzipSync(Buffer.from(out.buffer), { level: 9 }));
			done++;
		}
		// kafelki WorldCover nad bieżącym wierszem już niepotrzebne
		for (const f of files.values()) f.cog.dropAbove(minTy);
		log(`  pokrycie z${z}: ${done}/${list.length}`);
	}
}
/**
 * Drzewa z WorldCover w zabudowie (ogrody, skwery, szpalery na osiedlach) – jako zabudowa, chyba że OSM ma tam las:
 * inaczej w miastach stałyby gęste lasy 3D. Wielokąty z własnych kafli wektorowych (warstwy landuse, wood).
 */
function builtFromOsm(out, x, y) {
	const file = path.join(OUT, '14', String(x), `${y}.pbf`);
	if (!fs.existsSync(file)) return;
	const b = fs.readFileSync(file);
	const t = decodeTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), ['landuse', 'wood']);
	const mark = (layer, val) => {
		const m = new Uint8Array(RES * RES);
		for (const f of t.layers[layer]?.features ?? []) {
			if (f.type !== 3) continue;
			const rings = f.geom.map((r) => r.map((v) => v - 2048));
			rasterizePolygon(m, RES, 4096, rings, val);
		}
		return m;
	};
	const built = mark('landuse', 1), wood = mark('wood', 1);
	for (let i = 0; i < out.length; i++) if (out[i] === COVER.forest && built[i] && !wood[i]) out[i] = COVER.built;
}

/**
 * Wysokości z GUGiK (WCS, Web Mercator): środki pikseli dokładnie w wierzchołkach siatki: z14 – 129² (+ margines,
 * 131²), z11 (daleki teren) – 65² (67²); obie z tego samego modelu, więc na styku bliskiego i dalekiego terenu
 * nie ma uskoku między źródłami.
 */
async function heightTiles(list, z = 14, HN = 131) {
	const R = 6378137;
	let done = 0, skipped = 0, failed = 0;
	await pool(list, 6, async ([x, y]) => {
		const file = path.join(OUT, 'height', String(z), String(x), `${y}.bin.gz`);
		if (fs.existsSync(file)) { skipped++; return; }
		const S = (2 * Math.PI * R) / 2 ** z, c = S / (HN - 3);
		const x0 = -Math.PI * R + x * S, y1 = Math.PI * R - y * S;
		const bx = [x0 - 1.5 * c, x0 + S + 1.5 * c], by = [y1 - S - 1.5 * c, y1 + 1.5 * c];
		const url = `${WCS}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=DTM_PL-KRON86-NH_TIFF&FORMAT=image/tiff`
			+ '&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/3857&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/3857'
			+ `&SUBSET=x(${bx[0]},${bx[1]})&SUBSET=y(${by[0]},${by[1]})&SCALESIZE=x(${HN}),y(${HN})&INTERPOLATION=BILINEAR`;
		for (let attempt = 1; attempt <= 5; attempt++) {
			try {
				const res = await fetch(url, { headers: { 'User-Agent': 'lot-prototyp/0.1 (gra; wypiekanie terenu)' } });
				if (!res.ok || !String(res.headers.get('content-type')).includes('tiff')) throw new Error(`${res.status}`);
				const { width, height, data } = readFloatTiff(Buffer.from(await res.arrayBuffer()));
				if (width !== HN || height !== HN) throw new Error(`rozmiar ${width}×${height}`);
				const dm = new Int16Array(HN * HN);
				// poza Polską usługa zwraca 0 (brak danych) – znacznik −32768: gra uzupełnia tam rzeźbę z Terrarium
				for (let i = 0; i < dm.length; i++) dm[i] = data[i] === 0 || !(data[i] > -500) ? -32768 : Math.max(-32000, Math.min(32000, Math.round(data[i] * 10)));
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, zlib.gzipSync(Buffer.from(dm.buffer), { level: 9 }));
				break;
			} catch (e) {
				if (attempt === 5) { failed++; console.warn(`  wysokość ${x}/${y}: ${e.message}`); }
				else await new Promise((r) => setTimeout(r, 2000 * attempt));
			}
		}
		if (++done % 200 === 0) log(`  wysokości: ${done + skipped}/${list.length}`);
	});
	log(`  wysokości: pobrane ${done - failed}, wcześniej ${skipped}, błędy ${failed}`);
}

if (!args.includes('--skip-cover')) {
	await coverTiles(11, z11);
	await coverTiles(14, z14);
}
if (!args.includes('--skip-height')) {
	await heightTiles(z14, 14, HN);
	await heightTiles(z11, 11, 67);
}

// --- 4. opis ---
const manifestFile = path.join(OUT, 'tiles.json');
const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { areas: {} };
old.areas[area] = { bounds: [W, S, E, N], built: new Date().toISOString().slice(0, 10), z14: z14.map(([x, y]) => `${x}/${y}`), z11: z11.map(([x, y]) => `${x}/${y}` ) };
const manifest = {
	name: 'Lot nad Polską – własne kafle', version: 3, coverRes: RES, heightRes: HN, farHeightRes: 67,
	attribution: 'Dane © współtwórcy OpenStreetMap (ODbL) · ESA WorldCover 2021 (CC BY 4.0) · NMT © GUGiK',
	areas: old.areas,
};
fs.writeFileSync(manifestFile, JSON.stringify(manifest));
log(`Gotowe: ${manifestFile}`);
