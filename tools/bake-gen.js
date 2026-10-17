// Wypieka region wbudowany z kafli wektorowych OpenStreetMap (OpenFreeMap, z14) i kafli wysokości Terrarium – tym
// samym rdzeniem co generator w grze (src/gen/build.js) – do data/regions/<id>/ (te same pliki co npm run bake).
// Regiony z polem gen w src/regions.js. Pobrane kafle zostają w tools/.cache/tiles (kolejne wypieczenia bez sieci).
// Użycie: npm run bake:gen -- <id regionu>   (np. zabrze, beskid-slaski)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REGIONS } from '../src/regions.js';
import { buildRegion, MAP_Z } from '../src/gen/build.js';
import { terrariumHeight } from '../src/geo.js';
import { decodePng } from './lib/png.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const TERRARIUM = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
const CACHE = path.join(import.meta.dirname, '.cache', 'tiles');
const UA = 'lot-prototyp/0.8 (gra; wypiekanie regionow)';

const id = process.argv[2];
const region = REGIONS[id];
if (!region?.gen) {
	const ids = Object.values(REGIONS).filter((r) => r.gen).map((r) => r.id);
	console.error(`Nieznany region. Regiony z kafli: ${ids.join(', ')}`);
	process.exit(1);
}
const OUT = path.join(import.meta.dirname, '..', 'data', 'regions', region.id);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} s] ${s}`);

/** Kafel z pamięci podręcznej albo z sieci; 204/404 – kafel bez danych (pusty plik). */
async function cached(key, url) {
	const file = path.join(CACHE, key);
	if (fs.existsSync(file)) return { buf: fs.readFileSync(file), cached: true };
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { headers: { 'User-Agent': UA } });
			let buf;
			if (res.status === 204 || res.status === 404) buf = Buffer.alloc(0);
			else if (!res.ok) throw new Error(`${res.status} ${url}`);
			else buf = Buffer.from(await res.arrayBuffer());
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, buf);
			return { buf, cached: false };
		} catch (e) {
			if (attempt >= 4) throw e;
			await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
	}
}

const tpl = (await (await fetch(OFM, { headers: { 'User-Agent': UA } })).json()).tiles[0];
let last = {};
const { meta, data } = await buildRegion({ id: region.id, name: region.name, center: region.center, size: region.size, ...region.gen }, {
	parallel: 8,
	// dziennik: zmiana etapu i co czwarta część etapu
	progress: (p, label) => {
		if (!label) return;
		const stage = label.split(':')[0], m = label.match(/(\d+) \/ (\d+)/), q = m ? Math.floor((4 * m[1]) / m[2]) : 0;
		if (stage !== last.stage || q !== last.q) log(label);
		last = { stage, q, label };
	},
	mapTile: async (x, y) => {
		const t = await cached(`ofm/${MAP_Z}/${x}/${y}.pbf`, tpl.replace('{z}', MAP_Z).replace('{x}', x).replace('{y}', y));
		return { buf: new Uint8Array(t.buf.buffer, t.buf.byteOffset, t.buf.byteLength), cached: t.cached };
	},
	heightTile: async (z, x, y) => {
		const { buf } = await cached(`terrarium/${z}/${x}/${y}.png`, TERRARIUM(z, x, y));
		const h = new Float32Array(256 * 256);
		if (!buf.length) return h;
		const png = decodePng(buf);
		for (let k = 0; k < h.length; k++) {
			const p = k * png.channels;
			h[k] = terrariumHeight(png.data[p], png.data[p + 1], png.data[p + 2]);
		}
		return h;
	},
});

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, v] of Object.entries(data)) {
	const raw = typeof v === 'string' ? Buffer.from(v) : Buffer.from(v.buffer, v.byteOffset, v.byteLength);
	const gz = zlib.gzipSync(raw, { level: 9 });
	fs.writeFileSync(path.join(OUT, name), gz);
	total += gz.length;
	log(`  ${name}: ${(gz.length / 1e6).toFixed(1)} MB`);
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
log(`Gotowe: ${path.relative(process.cwd(), OUT)} – ${(total / 1e6).toFixed(1)} MB, ${meta.osm.counts.buildings} budynków, ` +
	`${meta.osm.counts.roads} dróg, wysokość ${meta.height.min}–${meta.height.max} m, miejsca: ${meta.places.map((p) => p.name).join(', ')}`);
