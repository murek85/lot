// npm run pack:tiles: własne kafle gry z data/tiles/lot/ (tysiące plików z bake:tiles) → po jednym pliku na obszar
// (województwo): data/tiles/lot/<obszar>.pmtiles (PMTiles v3, src/gen/pmtiles.js) z kaflami, które według opisu
// tiles.json należą do obszaru – wektorowe z14 (gzip), pokrycie i wysokości z14 i z11. Na serwer gry: tiles.json
// i pliki .pmtiles; po wypieczeniu kolejnego województwa – tylko jego plik i nowy tiles.json (kafle na granicy
// przechodzą do nowego obszaru; w starszym archiwum zostają, ale gra bierze je z nowego). Gra czyta kafle przez
// HTTP Range, a bez archiwum obszaru – z luźnych plików (src/world/lotsource.js). bake:tiles pakuje sam wypieczone
// obszary.
// Użycie: npm run pack:tiles [-- <obszar…>]   (bez obszarów – wszystkie z opisu)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { writePmtiles, lotTileId } from '../src/gen/pmtiles.js';
import { readManifest } from '../src/gen/lotmanifest.js';

const ROOT = path.join(import.meta.dirname, '..');
export const TILES_DIR = path.join(ROOT, 'data/tiles/lot');

/**
 * Pakuje obszary (domyślnie wszystkie z tiles.json) do <dir>/<obszar>.pmtiles. Zwraca [{ id, tiles, bytes, file }].
 * Kafel bez pliku (np. wysokości poza zasięgiem NMT) – pomijany; gra przyjmie go jak brakujący.
 */
export function packTiles(dir = TILES_DIR, ids = null, given = null) {
	const manifestFile = path.join(dir, 'tiles.json');
	if (!given && !fs.existsSync(manifestFile)) throw new Error(`brak ${manifestFile} – najpierw npm run bake:tiles`);
	// given – opis jeszcze niezapisany (bake:tiles zapisuje tiles.json dopiero po spakowaniu archiwów)
	const manifest = given ?? JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
	const own = readManifest(manifest);
	const out = [];
	for (const id of ids ?? Object.keys(manifest.areas ?? {})) {
		const area = manifest.areas?.[id];
		if (!area) throw new Error(`obszaru ${id} nie ma w ${manifestFile}`);
		const tiles = [];
		const add = (kind, z, key) => {
			const [x, y] = key.split('/').map(Number);
			const f = path.join(dir, kind, String(z), String(x), `${y}.${kind ? 'bin.gz' : 'pbf'}`);
			if (!fs.existsSync(f)) return;
			// kafle wektorowe leżą bez kompresji – w archiwum gzip (~40% mniej); rastry są już spakowane
			const data = fs.readFileSync(f);
			tiles.push({ id: lotTileId(kind, z, x, y), data: kind ? data : zlib.gzipSync(data, { level: 9 }) });
		};
		// tylko to, czego gra używa: wektorowe z14 (daleki teren z11 – mapa OpenFreeMap), pokrycie i wysokości z14 i z11
		for (const [k, a] of own.area14) if (a === id) { add('', 14, k); add('cover', 14, k); add('height', 14, k); }
		for (const [k, a] of own.area11) if (a === id) { add('cover', 11, k); add('height', 11, k); }
		const file = path.join(dir, `${id}.pmtiles`);
		if (!tiles.length) { fs.rmSync(file, { force: true }); continue; } // obszar bez kafli (przejęte przez sąsiadów)
		const bytes = writePmtiles(tiles, { area: id, built: area.built, version: manifest.version }, {
			compress: (d) => zlib.gzipSync(d, { level: 9 }), minZoom: 11, maxZoom: 14, bounds: area.bounds,
		});
		const tmp = `${file}.tmp`;
		fs.writeFileSync(tmp, bytes);
		fs.renameSync(tmp, file); // gra nie trafi na plik w połowie zapisu
		out.push({ id, tiles: tiles.length, bytes: bytes.length, file });
	}
	// dawny jeden plik dla wszystkich obszarów (data/tiles/lot.pmtiles) – zastąpiony plikami obszarów
	fs.rmSync(path.join(dir, '..', 'lot.pmtiles'), { force: true });
	return out;
}

// uruchomione wprost (npm run pack:tiles), nie zaimportowane przez bake:tiles
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
	const t0 = Date.now();
	const ids = process.argv.slice(2);
	for (const r of packTiles(TILES_DIR, ids.length ? ids : null)) {
		console.log(`${path.relative(ROOT, r.file)}: ${r.tiles} kafli, ${(r.bytes / 1e6).toFixed(1)} MB`);
	}
	console.log(`Gotowe (${((Date.now() - t0) / 1000).toFixed(1)} s) – na serwer: data/tiles/lot/tiles.json i pliki .pmtiles`);
}
