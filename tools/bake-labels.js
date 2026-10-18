// Dopisuje do meta.json regionu nazwy miejscowości (labels) z warstwy „place” kafli wektorowych OpenFreeMap (z14) –
// do opisu położenia i map. Bez przeliczania terenu i obiektów (dla regionów już wypieczonych, także Borów
// Tucholskich z WorldCover/Overpass). Kafle z tools/.cache/tiles (wspólne z npm run bake:gen).
// Użycie: npm run bake:labels -- <id regionu>
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS } from '../src/regions.js';
import { decodeTile } from '../src/gen/mvt.js';
import { tilesFor } from '../src/gen/tiles.js';
import { convertTile, pickLabels } from '../src/gen/convert.js';
import { localToLonLat } from '../src/geo.js';

const OFM = 'https://tiles.openfreemap.org/planet';
const CACHE = path.join(import.meta.dirname, '.cache', 'tiles');
const UA = 'lot-prototyp/0.17 (gra; nazwy miejscowosci)';
const Z = 14;

const region = REGIONS[process.argv[2]];
if (!region) { console.error(`Nieznany region. Dostępne: ${Object.keys(REGIONS).join(', ')}`); process.exit(1); }
const metaFile = path.join(import.meta.dirname, '..', 'data', 'regions', region.id, 'meta.json');
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

const tpl = (await (await fetch(OFM, { headers: { 'User-Agent': UA } })).json()).tiles[0];
async function tile(x, y) {
	const file = path.join(CACHE, `ofm/${Z}/${x}/${y}.pbf`);
	if (fs.existsSync(file)) return fs.readFileSync(file);
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { headers: { 'User-Agent': UA } });
			const buf = res.status === 204 || res.status === 404 ? Buffer.alloc(0) : res.ok ? Buffer.from(await res.arrayBuffer()) : null;
			if (!buf) throw new Error(`${res.status}`);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, buf);
			return buf;
		} catch (e) {
			if (attempt >= 4) throw e;
			await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
	}
}

const list = tilesFor(region.center, region.size, Z);
const places = [];
let done = 0, next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
	while (next < list.length) {
		const [x, y] = list[next++];
		const buf = await tile(x, y);
		if (buf.length) places.push(...convertTile(decodeTile(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), ['place']), Z, x, y, { center: region.center, half: region.size / 2, buildings: 'none' }).places);
		if (++done % 100 === 0) console.log(`  ${done} / ${list.length} kafli`);
	}
}));
meta.labels = pickLabels(places, region.size / 2, region.center, localToLonLat);
if (!meta.sources.some((s) => s.name.startsWith('OpenFreeMap'))) meta.sources.push({ name: 'OpenFreeMap (schemat OpenMapTiles)', license: '© OpenMapTiles, dane © współtwórcy OpenStreetMap (ODbL)' });
fs.writeFileSync(metaFile, JSON.stringify(meta, null, '\t') + '\n');
const by = {};
for (const l of meta.labels) by[l.cls] = (by[l.cls] ?? 0) + 1;
console.log(`${region.id}: ${meta.labels.length} nazw ${JSON.stringify(by)} – np. ${meta.labels.slice(0, 8).map((l) => l.name).join(', ')}`);
