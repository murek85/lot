// Własne kafle otwartego świata dla obszarów (województw) → data/tiles/lot/:
//   {z}/{x}/{y}.pbf          – kafle wektorowe ze schematu tools/tiles/lot-schema.yml (Planetiler, z11–z14):
//                              surowe znaczniki OSM – drogi, tory, budynki z rodzajem i dachem, cieki, woda, linie
//                              energetyczne, szpalery, stacje, przejazdy, perony, miejscowości;
//   cover/{z}/{x}/{y}.bin.gz – pokrycie terenu 256² (klasy COVER) z ESA WorldCover 10 m, dla z14 i z11; w z14 drzewa
//                              z WorldCover w zabudowie OSM (osiedla, usługi, przemysł – poza lasem OSM) → zabudowa;
//   height/{z}/{x}/{y}.bin.gz – wysokości z14: 131², z11: 67² (Int16, decymetry; wierzchołki siatki + margines) z numerycznego
//                              modelu terenu GUGiK (LIDAR, usługa WCS w układzie Web Mercator);
//   tiles.json               – opis (src/gen/lotmanifest.js): obszary z czasem wypieczenia i kaflami, których gra używa;
//   <obszar>.pmtiles         – kafle obszaru w jednym pliku (tools/pack-tiles.js) – na serwer gry: tiles.json i te pliki.
// Kafle wektorowe powstają z jednego wyciągu OSM (domyślnie cała Polska – --osm=poland) w osobnym katalogu
// tools/.cache/tiles-src/vector-<wyciąg>/ (Planetiler w prostokącie obszarów); do data/tiles/lot/ – tylko kafle obszarów.
// Obszar bierze kafle z14, które go dotykają i leżą w całości wewnątrz wyciągu – kafle na granicy województw są więc
// pełne z obu stron (bez pasa OpenFreeMap między województwami) i należą do obszaru wypieczonego ostatnio. Poza
// wyciągiem (granica Polski) zostaje OpenFreeMap. --osm=<obszar> – jak dawniej: wyciąg samego obszaru, tylko kafle
// w całości wewnątrz niego.
// Wejście w tools/.cache/tiles-src/: planetiler.jar, <wyciąg>-latest.osm.pbf i pliki .poly wyciągu i obszarów (Geofabrik;
// brakujące narzędzie pobiera samo, chyba że --no-download).
// Użycie: npm run bake:tiles -- <obszar…|polska> [--osm=poland] [--rebuild-vector] [--skip-vector] [--skip-cover]
//         [--skip-height] [--no-download]     np. npm run bake:tiles -- malopolskie opolskie
// Dane © współtwórcy OpenStreetMap (ODbL), ESA WorldCover 2021 (CC BY 4.0), GUGiK (NMT).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { tilePointLonLat } from '../src/gen/tiles.js';
import { worldCoverClass, COVER } from '../src/gen/terrain.js';
import { decodeTile } from '../src/gen/mvt.js';
import { rasterizePolygon } from '../src/gen/convert.js';
import { mergeArea, tilesBounds } from '../src/gen/lotmanifest.js';
import { readFloatTiff } from './lib/tiff.js';
import { openCog } from './lib/cog.js';
import { pool } from './lib/net.js';
import { readPoly, tilesInPoly, tileInPoly } from './lib/poly.js';
import { packTiles } from './pack-tiles.js';

const RES = 256; // piksele pokrycia na bok kafla (jak COVER_RES w src/world/chunkdata.js)
const HN = 131; // siatka wysokości kafla z14: 129 wierzchołków (~12 m) + margines po jednym z każdej strony
const WCS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF';
const WC_PX = 12000; // pikseli WorldCover na stopień
const WORLDCOVER = (lat3, lon3) => `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N${String(lat3).padStart(2, '0')}E${String(lon3).padStart(3, '0')}_Map.tif`;
const GEOFABRIK = (name) => `https://download.geofabrik.de/europe/${name.startsWith('poland') ? '' : 'poland/'}${name}`;
const VOIVODESHIPS = ['dolnoslaskie', 'kujawsko-pomorskie', 'lodzkie', 'lubelskie', 'lubuskie', 'malopolskie', 'mazowieckie', 'opolskie',
	'podkarpackie', 'podlaskie', 'pomorskie', 'slaskie', 'swietokrzyskie', 'warminsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie'];
const SRC = path.join(import.meta.dirname, '.cache', 'tiles-src');
const OUT = path.join(import.meta.dirname, '..', 'data', 'tiles', 'lot');
const args = process.argv.slice(2);
const flag = (f) => args.includes(`--${f}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const areas = [...new Set(args.filter((a) => !a.startsWith('--')).flatMap((a) => (a === 'polska' ? VOIVODESHIPS : [a])))];
if (!areas.length) areas.push('slaskie');
for (const a of areas) if (!VOIVODESHIPS.includes(a)) console.warn(`Uwaga: „${a}” to nie województwo z Geofabrik (${VOIVODESHIPS.join(', ')})`);
const osm = opt('osm') ?? 'poland';
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);

/** Plik z Geofabrik w tools/.cache/tiles-src/ (pobierany, jeśli go nie ma: najpierw .part, potem zmiana nazwy). */
async function ensureFile(name) {
	const file = path.join(SRC, name);
	if (fs.existsSync(file)) return file;
	if (flag('no-download')) throw new Error(`Brak ${file} (--no-download)`);
	const res = await fetch(GEOFABRIK(name), { headers: { 'User-Agent': 'lot-prototyp/0.1 (gra; wypiekanie terenu)' } });
	if (!res.ok) throw new Error(`${res.status} ${GEOFABRIK(name)}`);
	const size = Number(res.headers.get('content-length'));
	log(`Pobieranie ${GEOFABRIK(name)}${size ? ` (${(size / 2 ** 20).toFixed(0)} MB)` : ''}`);
	fs.mkdirSync(SRC, { recursive: true });
	await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${file}.part`));
	fs.renameSync(`${file}.part`, file);
	return file;
}
const polyOf = async (name) => readPoly(fs.readFileSync(await ensureFile(`${name}.poly`), 'utf8'));

// --- 1. obszary: kafle z14 dotykające obszaru i w całości wewnątrz wyciągu, z11 – dotykające obszaru ---
const srcRings = await polyOf(osm);
const plan = [];
for (const area of areas) {
	const rings = osm === area ? srcRings : await polyOf(area);
	const z14 = osm === area ? tilesInPoly(rings, 14, 'inside')
		: tilesInPoly(rings, 14, 'touch').filter((k) => tileInPoly(srcRings, 14, k, 'inside'));
	const z11 = tilesInPoly(rings, 11, 'touch');
	// z12–z13: kafle wektorowe tylko do kompletu (gra bierze z14 i z11)
	const mid = [12, 13].map((z) => [z, tilesInPoly(rings, z, 'touch')]);
	plan.push({ area, z14, z11, mid });
	log(`Obszar ${area}: ${z14.length} kafli z14, ${z11.length} kafli z11`);
}

// --- 2. kafle wektorowe wyciągu (Planetiler do osobnego katalogu – nigdy wprost do data/tiles/lot/) ---
// tylko w prostokącie kafli z11 obszarów (--bounds; obejmuje też ich kafle z12–z14): cała Polska to kilka GB plików
// tymczasowych i kafli, obszar – kilkaset MB. Katalog zostaje, dopóki wyciąg się nie zmieni i prostokąt wystarcza.
const VEC = path.join(SRC, `vector-${osm}`);
if (!flag('skip-vector')) {
	const pbf = await ensureFile(`${osm}-latest.osm.pbf`);
	const need = tilesBounds(plan.flatMap((p) => p.z11), 11);
	const stampFile = path.join(VEC, 'lot-bounds.json');
	const prev = fs.existsSync(stampFile) && fs.existsSync(path.join(VEC, 'metadata.json')) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : null;
	const fresh = prev && prev.pbf === fs.statSync(pbf).mtimeMs
		&& prev.bounds[0] <= need[0] && prev.bounds[1] <= need[1] && prev.bounds[2] >= need[2] && prev.bounds[3] >= need[3];
	if (flag('rebuild-vector') || !fresh) {
		log(`Planetiler: ${path.basename(pbf)} → ${VEC}, prostokąt ${need.join(', ')}`);
		const r = spawnSync('java', [`-Xmx${process.env.PLANETILER_XMX ?? '6g'}`, '-jar', path.join(SRC, 'planetiler.jar'), 'generate-custom',
			`--schema=${path.join(import.meta.dirname, 'tiles', 'lot-schema.yml')}`, `--pbf=${pbf}`, `--bounds=${need.join(',')}`,
			`--output=${VEC}/?format=files`, '--tile_compression=none', '--minzoom=11', '--maxzoom=14', '--force', `--tmpdir=${path.join(SRC, 'tmp')}`],
		{ stdio: ['ignore', 'ignore', 'inherit'] });
		if (r.status !== 0) throw new Error(`Planetiler zakończył się kodem ${r.status}`);
		fs.writeFileSync(stampFile, JSON.stringify({ pbf: fs.statSync(pbf).mtimeMs, bounds: need }));
	} else log(`Kafle wektorowe ${osm} aktualne (${VEC}) – bez Planetilera (--rebuild-vector wymusza)`);
}

// kafle wektorowe obszarów z katalogu wyciągu do data/tiles/lot/
if (!flag('skip-vector')) {
	let n = 0, empty = 0;
	const copy = (z, k) => {
		const [x, y] = k.split('/'), from = path.join(VEC, String(z), x, `${y}.pbf`), to = path.join(OUT, String(z), x, `${y}.pbf`);
		if (!fs.existsSync(from)) { if (fs.existsSync(to)) fs.rmSync(to); empty++; return; } // kafel bez obiektów
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(from, to);
		n++;
	};
	for (const { z14, z11, mid } of plan) {
		for (const k of z14) copy(14, k);
		for (const k of z11) copy(11, k);
		for (const [z, list] of mid) for (const k of list) copy(z, k);
	}
	log(`Kafle wektorowe → ${OUT}: ${n} skopiowanych, ${empty} pustych`);
}
const all14 = [...new Set(plan.flatMap((p) => p.z14))].map((k) => k.split('/').map(Number));
const all11 = [...new Set(plan.flatMap((p) => p.z11))].map((k) => k.split('/').map(Number));

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

if (!flag('skip-cover')) {
	await coverTiles(11, all11);
	await coverTiles(14, all14);
}
if (!flag('skip-height')) {
	await heightTiles(all14, 14, HN);
	await heightTiles(all11, 11, 67);
}

// --- 4. opis: obszary po kolei – kafle obszaru odchodzą z wcześniej wypieczonych (kafle na granicy – do nowszego) ---
const manifestFile = path.join(OUT, 'tiles.json');
let manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { areas: {} };
const built = new Date().toISOString().slice(0, 16);
const info = {
	name: 'Lot nad Polską – własne kafle', coverRes: RES, heightRes: HN, farHeightRes: 67,
	attribution: 'Dane © współtwórcy OpenStreetMap (ODbL) · ESA WorldCover 2021 (CC BY 4.0) · NMT © GUGiK',
};
for (const { area, z14, z11 } of plan) manifest = mergeArea(manifest, area, { bounds: tilesBounds(z14) ?? [0, 0, 0, 0], built, source: osm, z14, z11 }, info);
fs.writeFileSync(manifestFile, JSON.stringify(manifest));
log(`Gotowe: ${manifestFile} (${Object.keys(manifest.areas).join(', ')}; ${(fs.statSync(manifestFile).size / 1024).toFixed(0)} kB)`);

// --- 5. po jednym pliku na wypieczony obszar dla serwera gry: data/tiles/lot/<obszar>.pmtiles ---
for (const r of packTiles(OUT, plan.map((p) => p.area))) log(`Spakowane: data/tiles/lot/${path.basename(r.file)} – ${r.tiles} kafli, ${(r.bytes / 1e6).toFixed(0)} MB`);
log('Na serwer gry: data/tiles/lot/tiles.json i pliki .pmtiles wypieczonych obszarów');
