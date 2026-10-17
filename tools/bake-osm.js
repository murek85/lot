// Wypieka obiekty z OpenStreetMap dla regionu: drogi i dukty, tory, budynki, cieki, linie energetyczne, szpalery,
// stacje, przejazdy i perony → data/regions/<id>/osm.json.gz (współrzędne lokalne w decymetrach).
// Overpass bywa przeciążony: kafelki pobierane po kolei, z kilkoma serwerami, ponowieniami i pamięcią w tools/.cache.
// Użycie: npm run bake:osm -- [id regionu]   Dane © współtwórcy OpenStreetMap, licencja ODbL.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { REGIONS } from '../src/regions.js';
import { regionBounds } from '../src/geo.js';
import { collect } from './lib/osm.js';

const HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const CACHE = path.join(import.meta.dirname, '.cache', 'osm');
const TILES = 8;
const args = process.argv.slice(2);
const CACHED_ONLY = args.includes('--cached-only'); // złóż plik z już pobranych kafelków (do szybkich prób)
const region = REGIONS[args.find((a) => !a.startsWith('--')) || 'bory-tucholskie'];
const OUT = path.join(import.meta.dirname, '..', 'data', 'regions', region.id);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
	const key = crypto.createHash('sha1').update(query).digest('hex');
	const file = path.join(CACHE, key + '.json');
	if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
	if (CACHED_ONLY) return null;
	for (let attempt = 0; attempt < 24; attempt++) {
		const host = HOSTS[attempt % HOSTS.length];
		try {
			const res = await fetch(host, {
				method: 'POST',
				headers: { 'User-Agent': 'lot-prototyp/0.1 (gra; wypiekanie terenu)', 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'data=' + encodeURIComponent(query),
			});
			if (!res.ok) throw new Error(`${res.status}`);
			const text = await res.text();
			const json = JSON.parse(text);
			if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
			fs.mkdirSync(CACHE, { recursive: true });
			fs.writeFileSync(file, text);
			return json;
		} catch (e) {
			log(`  ${new URL(host).host}: ${String(e.message || e).slice(0, 80)} – ponawiam`);
			await sleep(Math.min(120000, 8000 + attempt * 8000));
		}
	}
	return null; // kafelek pominięty – kolejne uruchomienie spróbuje znowu (pobrane są w pamięci podręcznej)
}

const b = regionBounds(region);
const responses = [];
let missing = 0;
for (let j = 0; j < TILES; j++) {
	for (let i = 0; i < TILES; i++) {
		const s = b.south + ((b.north - b.south) * j) / TILES, n = b.south + ((b.north - b.south) * (j + 1)) / TILES;
		const w = b.west + ((b.east - b.west) * i) / TILES, e = b.west + ((b.east - b.west) * (i + 1)) / TILES;
		const bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
		const q = `[out:json][timeout:180];(
way[highway](${bb});
way[railway](${bb});
way[building](${bb});
way[waterway~"^(river|canal|stream|ditch|drain)$"](${bb});
way[power~"^(line|minor_line)$"](${bb});
way[natural=tree_row](${bb});
node[railway~"^(station|halt|level_crossing|crossing)$"](${bb});
);out geom qt;`;
		if (!CACHED_ONLY) log(`Kafelek ${j * TILES + i + 1}/${TILES * TILES}`);
		const res = await overpass(q);
		if (res) responses.push(res);
		else missing++;
		if (!CACHED_ONLY) await sleep(1500);
	}
}

const data = collect(responses, region.center);
const compact = {
	version: 1,
	attribution: '© OpenStreetMap contributors (ODbL)',
	roads: data.roads.map((r) => [r.cls, Math.round(r.width * 10), r.surface, r.bridge, r.layer, r.c]),
	rails: data.rails.map((r) => [r.kind, r.service, r.bridge, r.layer, r.c]),
	buildings: data.buildings.map((x) => [x.type, Math.round(x.height * 10), x.roof, x.known ? 1 : 0, x.c]),
	waterways: data.waterways.map((x) => [Math.round(x.width * 10), x.c]),
	power: data.power.map((x) => [x.minor, x.c]),
	treeRows: data.treeRows.map((x) => [x.c]),
	stations: data.stations.map((x) => [x.halt, x.p, x.name]),
	crossings: data.crossings.map((x) => [x.barrier, x.p]),
	platforms: data.platforms.map((x) => [x.c]),
};
fs.mkdirSync(OUT, { recursive: true });
const gz = zlib.gzipSync(JSON.stringify(compact), { level: 9 });
fs.writeFileSync(path.join(OUT, 'osm.json.gz'), gz);
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
meta.osm = {
	file: 'osm.json.gz',
	counts: Object.fromEntries(Object.entries(compact).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])),
};
if (!meta.sources.some((s) => /OpenStreetMap/.test(s.name))) meta.sources.push({ name: 'OpenStreetMap', license: 'ODbL, © współtwórcy OpenStreetMap' });
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
if (missing) log(`Brakuje ${missing} z ${TILES * TILES} kafelków – uruchom ponownie, gdy Overpass będzie mniej obciążony`);
log(`Gotowe: osm.json.gz ${(gz.length / 1e6).toFixed(1)} MB – ${JSON.stringify(meta.osm.counts)}`);
