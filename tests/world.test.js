import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkFrame, heightTilesFor, chunkHeights, gridNormals, chunkObjects, chunkMask, shiftOsm, GRID, COVER_RES, CHUNK_Z, MASK_RES, FAR_Z } from '../src/world/chunkdata.js';
import { tilesAround, gridHeightAt } from '../src/world/streamer.js';
import { worldRegion, WORLD_SIZE } from '../src/world/world.js';
import { COVER } from '../src/gen/terrain.js';
import { lonToTileX, latToTileY, lonLatToLocal, localToLonLat } from '../src/geo.js';

const ORIGIN = { lon: 18.7856, lat: 50.3249 }; // Zabrze
const TX = Math.floor(lonToTileX(ORIGIN.lon, CHUNK_Z)), TY = Math.floor(latToTileY(ORIGIN.lat, CHUNK_Z));

test('Otwarty świat: rama kafla z14 – ~1,56 km, sąsiednie kafle stykają się bez szczeliny', () => {
	const a = chunkFrame(TX, TY, ORIGIN), b = chunkFrame(TX + 1, TY, ORIGIN), c = chunkFrame(TX, TY + 1, ORIGIN);
	assert.ok(a.w > 1500 && a.w < 1600, `szerokość ${a.w}`);
	assert.ok(Math.abs(a.h - a.w) < 30, 'kafel prawie kwadratowy');
	assert.ok(Math.abs(a.x0 + a.w - b.x0) < 1e-6);
	assert.ok(Math.abs(a.z0 + a.h - c.z0) < 1e-6);
	// początek układu leży w kaflu, w którym jest
	assert.ok(a.x0 <= 0 && a.x0 + a.w >= 0 && a.z0 <= 0 && a.z0 + a.h >= 0);
});

test('Otwarty świat: kafle wysokości z12 dla kafla z14 – jeden do czterech, zawsze ten nad kaflem', () => {
	const hs = heightTilesFor(TX, TY);
	assert.ok(hs.length >= 1 && hs.length <= 4);
	assert.ok(hs.some(([x, y]) => x === TX >> 2 && y === TY >> 2));
});

test('Otwarty świat: siatka wysokości z marginesem, normalne na stoku i płaskim', () => {
	// płaszczyzna nachylona: wysokość rośnie na wschód (x kafla Terrarium)
	const tiles = new Map();
	for (const [x, y] of heightTilesFor(TX, TY)) {
		const t = new Float32Array(256 * 256);
		for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) t[j * 256 + i] = 300 + (x * 256 + i) * 0.5 - (TX >> 2) * 128;
		tiles.set(`${x}/${y}`, t);
	}
	const H = chunkHeights(TX, TY, tiles);
	assert.equal(H.length, (GRID + 2) ** 2);
	const F = chunkFrame(TX, TY, ORIGIN);
	const g = gridNormals(H, F.w / (GRID - 1), F.h / (GRID - 1));
	assert.equal(g.heights.length, GRID * GRID);
	assert.ok(g.max > g.min);
	const k = 32 * GRID + 32;
	assert.ok(g.normals[k * 3] < 0, 'normalna odchylona na zachód (w dół stoku)');
	assert.ok(Math.abs(g.normals[k * 3 + 2]) < 1e-3);
	const flat = gridNormals(new Float32Array((GRID + 2) ** 2).fill(250), 24, 24);
	assert.equal(flat.normals[k * 3 + 1], 1);
	assert.equal(flat.min, 250);
});

test('Otwarty świat: pusty kafel wektorowy – pola uprawne i brak obiektów', () => {
	const { osm, cover } = chunkObjects(new ArrayBuffer(0), TX, TY, ORIGIN);
	assert.equal(cover.length, COVER_RES * COVER_RES);
	assert.ok(cover.every((c) => c === COVER.crop));
	assert.equal(osm.roads.length, 0);
	assert.equal(osm.buildings.length, 0);
});

test('Otwarty świat: kafle wokół punktu – od najbliższego, w promieniu', () => {
	const t = tilesAround(0, 0, 5000, ORIGIN);
	assert.equal(`${t[0].x}/${t[0].y}`, `${TX}/${TY}`);
	for (let i = 1; i < t.length; i++) assert.ok(t[i].d >= t[i - 1].d);
	assert.ok(t.length > 30 && t.length < 60, `${t.length} kafli`);
	assert.equal(new Set(t.map((c) => `${c.x}/${c.y}`)).size, t.length);
	// przesunięcie o kafel na wschód – pierwszy kafel też o jeden dalej
	const F = chunkFrame(TX + 1, TY, ORIGIN);
	const t2 = tilesAround(F.cx, F.cz, 1000, ORIGIN);
	assert.equal(t2[0].x, TX + 1);
});

test('Otwarty świat: wysokość na trójkątach siatki kafla jak na GPU', () => {
	const F = chunkFrame(TX, TY, ORIGIN);
	const heights = new Float32Array(GRID * GRID);
	heights[1] = 10; // wierzchołek (1, 0)
	const ch = { frame: { x0: F.x0, z0: F.z0, w: F.w, h: F.h }, heights };
	const cx = F.w / (GRID - 1), cz = F.h / (GRID - 1);
	assert.ok(Math.abs(gridHeightAt(ch, F.x0 + cx, F.z0) - 10) < 1e-4);
	assert.equal(gridHeightAt(ch, F.x0, F.z0), 0);
	// na przekątnej (1,0)–(0,1) w połowie: 5
	assert.ok(Math.abs(gridHeightAt(ch, F.x0 + cx / 2, F.z0 + cz / 2) - 5) < 1e-4);
	// w drugim trójkącie (bliżej (1,1)) wysokość też z wierzchołka (1,0)
	assert.ok(Math.abs(gridHeightAt(ch, F.x0 + cx * 0.75, F.z0 + cz * 0.75) - 2.5) < 1e-4);
});

test('Otwarty świat: region zastępczy – środek w miejscu startu, start w (0, 0)', () => {
	const r = worldRegion({ name: 'Łódź', lon: 19.456, lat: 51.759 });
	assert.equal(r.meta.id, 'world-lodz');
	assert.equal(r.size, WORLD_SIZE);
	assert.equal(r.osm, null);
	const p = lonLatToLocal(r.meta.places[0].lon, r.meta.places[0].lat, r.meta.center);
	assert.ok(Math.hypot(p.x, p.z) < 1e-6);
	assert.equal(r.meta.cover.classes, COVER);
	assert.ok(Math.abs(r.meta.center.merc.k - Math.cos((51.759 * Math.PI) / 180)) < 1e-12, 'rzut Mercatora o skali startu');
});

test('Otwarty świat: maska dróg, torów i rzek kafla – pas wzdłuż osi, poza nim pusto', () => {
	const F = chunkFrame(TX, TY, ORIGIN);
	const zMid = F.z0 + F.h / 2, dm = (x, z) => [Math.round(x * 10), Math.round(z * 10)];
	const osm = {
		roads: [[3, 70, 0, 0, 0, [...dm(F.x0, zMid), ...dm(F.x0 + F.w, zMid)], 0]], // droga 7 m przez środek, wschód–zachód
		rails: [], waterways: [[120, [...dm(F.x0 + 300, F.z0), ...dm(F.x0 + 300, F.z0 + F.h)]]], // rzeka 12 m z północy na południe
	};
	const m = chunkMask(osm, F);
	assert.equal(m.length, MASK_RES * MASK_RES);
	const at = (x, z) => m[Math.floor(((z - F.z0) / F.h) * MASK_RES) * MASK_RES + Math.floor(((x - F.x0) / F.w) * MASK_RES)];
	assert.equal(at(F.x0 + 900, zMid), 255, 'na drodze');
	assert.equal(at(F.x0 + 900, zMid + 5), 255, 'pobocze (3,5 m + 3 m)');
	assert.equal(at(F.x0 + 900, zMid + 30), 0, 'obok drogi');
	assert.equal(at(F.x0 + 300 + 10, F.z0 + 200), 255, 'pas nadbrzeżny rzeki');
	assert.equal(at(F.x0 + 300 + 40, F.z0 + 200), 0);
});

import { addPlaces } from '../src/world/maptiles.js';

test('Otwarty świat: miejscowości z kafli – kolejność ważności, bez powtórzeń, bez nieznanych klas', () => {
	const list = [];
	assert.equal(addPlaces(list, [{ name: 'Brynów', cls: 'suburb', x: 0, z: 0 }, { name: 'Katowice', cls: 'city', x: 10, z: 10 }]), 2);
	assert.equal(addPlaces(list, [{ name: 'Katowice', cls: 'city', x: 500, z: 0 }, { name: 'Pole', cls: 'locality', x: 0, z: 0 }, { name: 'Mysłowice', cls: 'town', x: 9000, z: 0 }]), 1);
	assert.deepEqual(list.map((p) => p.name), ['Katowice', 'Mysłowice', 'Brynów']);
	// ta sama nazwa daleko – inna miejscowość
	assert.equal(addPlaces(list, [{ name: 'Brynów', cls: 'suburb', x: 30000, z: 0 }]), 1);
});

const MERC = { ...ORIGIN, merc: { k: Math.cos((ORIGIN.lat * Math.PI) / 180) } };

test('Otwarty świat: rzut Mercatora – odwracalny, skala 1 przy starcie, przesunięcie początku to czyste przesunięcie', () => {
	const p = lonLatToLocal(19.3, 50.6, MERC), q = localToLonLat(p.x, p.z, MERC);
	assert.ok(Math.abs(q.lon - 19.3) < 1e-9 && Math.abs(q.lat - 50.6) < 1e-9);
	// skala przy początku jak w rzucie równoodległościowym
	const a = lonLatToLocal(ORIGIN.lon + 0.01, ORIGIN.lat - 0.01, MERC), b = lonLatToLocal(ORIGIN.lon + 0.01, ORIGIN.lat - 0.01, ORIGIN);
	assert.ok(Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 1);
	// nowy początek 50 km dalej – każdy punkt przesuwa się o ten sam wektor (bez szwów między kaflami)
	const c2 = { ...localToLonLat(28160, -42240, MERC), merc: MERC.merc };
	for (const [lon, lat] of [[18.5, 50.1], [19.9, 51.0], [19.2, 50.4]]) {
		const u = lonLatToLocal(lon, lat, MERC), v = lonLatToLocal(lon, lat, c2);
		assert.ok(Math.abs(u.x - v.x - 28160) < 1e-6 && Math.abs(u.z - v.z + 42240) < 1e-6);
	}
	// kafle z14 w Mercatorze – równe kwadraty
	const f1 = chunkFrame(TX, TY, MERC), f2 = chunkFrame(TX + 3, TY + 5, MERC);
	assert.ok(Math.abs(f1.w - f2.w) < 1e-6 && Math.abs(f1.h - f2.h) < 1e-6 && Math.abs(f1.w - f1.h) < 1e-6);
});

test('Otwarty świat: przesunięcie obiektów kafla o nowy początek', () => {
	const osm = { roads: [[3, 70, 0, 0, 0, [100, 200, 300, 400], 0]], rails: [[0, 0, 0, 0, [0, 0, 10, 10]]], buildings: [[0, 80, -1, 0, [50, 50, 60, 60]]], waterways: [[30, [1, 2]]], platforms: [[[5, 5]]], stations: [[0, [7, 7], 'X']], places: [{ name: 'A', cls: 'village', x: 1000, z: 2000 }] };
	shiftOsm(osm, 14080, -28160);
	assert.deepEqual(osm.roads[0][5], [100 - 140800, 200 + 281600, 300 - 140800, 400 + 281600]);
	assert.deepEqual(osm.stations[0][1], [7 - 140800, 7 + 281600]);
	assert.deepEqual([osm.places[0].x, osm.places[0].z], [1000 - 14080, 2000 + 28160]);
	assert.equal(osm.platforms[0][0][0], 5 - 140800);
});

test('Otwarty świat: daleki teren – kafel z11 i jego kafle wysokości z11 (z sąsiadami na margines)', () => {
	const fx = TX >> 3, fy = TY >> 3;
	const hs = heightTilesFor(fx, fy, FAR_Z, FAR_Z).map(([x, y]) => `${x}/${y}`);
	assert.ok(hs.includes(`${fx}/${fy}`), 'sam kafel');
	assert.equal(hs.length, 9);
	const F = chunkFrame(fx, fy, MERC, FAR_Z);
	assert.ok(F.w > 12000 && F.w < 13500, `bok ${F.w}`);
	// kafel z11 to dokładnie 8 × 8 kafli z14
	const n = chunkFrame(fx * 8, fy * 8, MERC);
	assert.ok(Math.abs(n.x0 - F.x0) < 1e-6 && Math.abs(n.w * 8 - F.w) < 1e-6);
});

import { tileEntries, pickEvictions } from '../src/gen/store.js';
import { tilesAround as around } from '../src/world/streamer.js';

test('Pamięć kafli: najdawniej używane wylatują do 90% limitu, kafle bez wpisu – pierwsze', () => {
	const infos = new Map([['a', { t: 100, n: 400 }], ['b', { t: 300, n: 400 }], ['c', { t: 200, n: 400 }]]);
	const e = tileEntries(['a', 'b', 'c', 'old'], infos);
	assert.deepEqual(e.find((x) => x[0] === 'old'), ['old', 0, 30000]);
	assert.deepEqual(pickEvictions(e, 1e6).remove, [], 'mieści się');
	const r = pickEvictions(e, 1000);
	assert.deepEqual(r.remove, ['old', 'a']); // 31 200 → 1200 → 800 B (≤ 900)
	assert.ok(r.total <= 900);
});

test('Otwarty świat: kafle wokół punktu z przesunięciem środka kafla względem punktu', () => {
	const t = around(0, 0, 3000, ORIGIN);
	for (const c of t) assert.ok(Math.abs(Math.hypot(c.dx, c.dz) - c.d) < 1e-6);
	// kafel na wschód ma dx > 0, na północ dz < 0
	const e = t.find((c) => c.x === TX + 1 && c.y === TY), n = t.find((c) => c.x === TX && c.y === TY - 1);
	assert.ok(e.dx > 0 && n.dz < 0);
});

import { buildBuildingTiles } from '../src/buildgeo.js';
import { convertLotTile } from '../src/gen/lottiles.js';
import { readPoly, inPoly } from '../tools/lib/poly.js';

test('Budynki: geometria w tablicach (wątek kafli) – dom z dachem dwuspadowym, wysokość z terenu', () => {
	const house = [0, 60, 1, 0, [0, 0, 120, 0, 120, 80, 0, 80, 0, 0]]; // 12 × 8 m, dach dwuspadowy
	const r = buildBuildingTiles([house], () => 250);
	assert.equal(r.count, 1);
	assert.equal(r.tiles.length, 1);
	const t = r.tiles[0];
	assert.ok(t.pos.length > 0 && t.idx.length % 3 === 0);
	let minY = Infinity, maxY = -Infinity;
	for (let i = 1; i < t.pos.length; i += 3) { minY = Math.min(minY, t.pos[i]); maxY = Math.max(maxY, t.pos[i]); }
	assert.ok(minY < 250 && maxY > 253, `ściany od ${minY} do ${maxY}`);
});

test('Własne kafle: znaczniki OSM → drogi z nawierzchnią i kierunkiem, budynki z rodzajem i dachem, linie, szpalery', () => {
	const ext = 4096;
	const L = (features) => ({ extent: ext, features });
	const tile = { layers: {
		roads: L([{ type: 2, geom: [[100, 100, 2000, 100]], props: { highway: 'residential', surface: 'sett', oneway: 'yes' } },
			{ type: 2, geom: [[0, 50, 50, 50]], props: { highway: 'primary', tunnel: 'yes' } }]),
		buildings: L([{ type: 3, geom: [[500, 500, 600, 500, 600, 600, 500, 600, 500, 500]], props: { building: 'church', 'roof:shape': 'gabled' } }]),
		power: L([{ type: 2, geom: [[0, 1000, 4096, 1000]], props: { power: 'minor_line' } }]),
		tree_rows: L([{ type: 2, geom: [[0, 2000, 300, 2000]], props: {} }]),
		crossings: L([{ type: 1, geom: [[700, 700]], props: { 'crossing:barrier': 'full' } }, { type: 1, geom: [[-5, 700]], props: {} }]),
		places: L([{ type: 1, geom: [[2000, 2000]], props: { place: 'town', name: 'Gliwice', population: '170000' } }]),
	} };
	const o = convertLotTile(tile, CHUNK_Z, TX, TY, { center: ORIGIN });
	assert.equal(o.roads.length, 1, 'tunel pominięty');
	const [cls, w10, surface, bridge, , , oneway] = o.roads[0];
	assert.deepEqual([cls, surface, bridge, oneway], [4, 2, 0, 1]);
	assert.ok(w10 > 0);
	assert.equal(o.buildings[0][0], 6, 'kościół');
	assert.equal(o.buildings[0][2], 1, 'dach dwuspadowy');
	assert.equal(o.power[0][0], 1);
	assert.equal(o.treeRows.length, 1);
	assert.equal(o.crossings.length, 1, 'punkt spoza kafla pominięty');
	assert.equal(o.crossings[0][0], 1);
	assert.equal(o.places[0].name, 'Gliwice');
	assert.ok(o.places[0].rank < 99);
});

test('Obszar własnych kafli: plik .poly i punkt w wielokącie (z otworem)', () => {
	const rings = readPoly('obszar\n1\n 18 50\n 20 50\n 20 52\n 18 52\nEND\n!2\n 18.9 50.9\n 19.1 50.9\n 19.1 51.1\n 18.9 51.1\nEND\nEND\n');
	assert.equal(rings.length, 2);
	assert.ok(rings[1].hole);
	assert.ok(inPoly(rings, 19.5, 51.5));
	assert.ok(!inPoly(rings, 19, 51), 'otwór');
	assert.ok(!inPoly(rings, 21, 51));
});

import { tilesInPoly, tileInPoly } from '../tools/lib/poly.js';
import { encodeTiles, decodeTiles, readManifest, mergeArea, tilesBounds } from '../src/gen/lotmanifest.js';

test('Własne kafle: sąsiednie województwa bez pasa kafli na granicy', () => {
	const box = (w, e) => readPoly(`p\n1\n ${w} 50\n ${e} 50\n ${e} 50.2\n ${w} 50.2\nEND\nEND\n`);
	const a = box(19, 19.137), b = box(19.137, 19.3), kraj = box(18.5, 19.8);
	// dawniej: tylko kafle w całości wewnątrz województwa – kafle przecięte granicą nie należały do żadnego
	const inA = new Set(tilesInPoly(a, 14, 'inside')), inB = new Set(tilesInPoly(b, 14, 'inside'));
	const both = tilesInPoly(box(19, 19.3), 14, 'inside');
	assert.ok(both.some((k) => !inA.has(k) && !inB.has(k)), 'pas na granicy');
	// teraz: kafle dotykające województwa i w całości wewnątrz wyciągu (kraju)
	const pick = (r) => tilesInPoly(r, 14, 'touch').filter((k) => tileInPoly(kraj, 14, k, 'inside'));
	const union = new Set([...pick(a), ...pick(b)]);
	assert.ok(both.every((k) => union.has(k)), 'bez pasa');
	// wierzchołek wąskiego cypla w kaflu – kafel dotyka obszaru, choć żaden z 9 punktów nie leży w wielokącie
	const spike = readPoly('p\n1\n 19.0001 50.0\n 19.0002 50.0\n 19.00015 50.0003\nEND\nEND\n');
	assert.equal(tilesInPoly(spike, 14, 'touch').length, 1);
});

test('Własne kafle: opis v4 – maski kafli, obszar wypieczony później przejmuje kafle na granicy', () => {
	const keys = ['9057/5537', '9056/5536', '9063/5543', '9064/5544'];
	const enc = encodeTiles(keys);
	assert.equal(Object.keys(enc).length, 2);
	assert.ok(Object.values(enc).every((h) => /^[0-9a-f]{16}$/.test(h)));
	assert.deepEqual(decodeTiles(enc).sort(), [...keys].sort());
	// stary opis v3 (listy) – czytany, znacznik z nazwą obszaru
	const v3 = { version: 3, heightRes: 131, areas: { slaskie: { bounds: [18, 49.4, 20, 51.1], built: '2026-10-18', z14: ['9057/5537', '9058/5537'], z11: ['1132/692'] } } };
	const r3 = readManifest(v3);
	assert.equal(r3.z14.get('9057/5537'), 'v3-slaskie-2026-10-18');
	assert.ok(r3.heights && r3.areas[0].z14.has('9058/5537'));
	// małopolskie przejmuje wspólny kafel; śląskie zachowuje resztę i swój znacznik
	const m = mergeArea(v3, 'malopolskie', { bounds: tilesBounds(['9058/5537', '9059/5537']), built: '2026-10-19T10:00', z14: ['9058/5537', '9059/5537'], z11: ['1132/692'] }, { heightRes: 131 });
	assert.equal(m.version, 4);
	const r4 = readManifest(m);
	assert.equal(r4.z14.get('9057/5537'), 'v4-slaskie-2026-10-18');
	assert.equal(r4.z14.get('9058/5537'), 'v4-malopolskie-2026-10-19T10:00');
	assert.equal(r4.z11.get('1132/692'), 'v4-malopolskie-2026-10-19T10:00');
	assert.deepEqual([...r4.areas.find((a) => a.id === 'slaskie').z14], ['9057/5537']);
	// prostokąt śląskiego zawężony do jego kafli
	const [w, s, e, n] = r4.areas.find((a) => a.id === 'slaskie').bounds;
	assert.ok(w < 19.0238 && e > 19.0238 && e - w < 0.03 && s < 50.2649 && n > 50.2649);
	// obszar, któremu nie zostały kafle – wypada
	assert.deepEqual(Object.keys(mergeArea(m, 'x', { bounds: [0, 0, 0, 0], built: 'b', z14: ['9057/5537'], z11: [] }).areas).sort(), ['malopolskie', 'x']);
});

import { shoreDistance, resampleCover, lotHeights, fillHeights } from '../src/world/chunkdata.js';

test('Otwarty świat: odległość od brzegu w wodzie (głębia, piana), woda przecięta brzegiem kafla bez fałszywego brzegu', () => {
	const R = 32, c = new Uint8Array(R * R).fill(COVER.grass);
	// jezioro: kolumny 8…31 (sięga prawej krawędzi kafla)
	for (let j = 0; j < R; j++) for (let i = 8; i < R; i++) c[j * R + i] = COVER.water;
	const d = shoreDistance(c, R, 6);
	assert.equal(d[16 * R + 4], 0, 'ląd');
	assert.equal(d[16 * R + 8], 6, 'pierwszy piksel wody – 1 piksel od brzegu');
	assert.ok(d[16 * R + 20] > d[16 * R + 10], 'dalej od brzegu – głębiej');
	assert.ok(Math.abs(d[16 * R + 31] - 23 * 6) <= 6, 'przy krawędzi kafla – odległość od prawdziwego brzegu');
});

test('Otwarty świat: raster pokrycia innej rozdzielczości i wysokości GUGiK (decymetry)', () => {
	const old = new Uint8Array(128 * 128).fill(COVER.forest);
	old[0] = COVER.water;
	const r = resampleCover(old);
	assert.equal(r.length, COVER_RES * COVER_RES);
	assert.equal(r[0], COVER.water);
	assert.equal(r[COVER_RES + 1], COVER.water, 'piksel 128² → 2×2 piksele 256²');
	assert.equal(r[COVER_RES * COVER_RES - 1], COVER.forest);
	const h = lotHeights(new Int16Array([8007, -25, 0]).buffer);
	assert.deepEqual([...h].map((v) => +v.toFixed(1)), [800.7, -2.5, 0]);
});

test('Wysokości GUGiK: brak danych poza Polską (znacznik) uzupełniany z drugiego źródła', () => {
	const h = lotHeights(new Int16Array([5000, -32768, 4980, -32768]).buffer);
	assert.ok(Number.isNaN(h[1]) && Number.isNaN(h[3]));
	assert.equal(fillHeights(h, new Float32Array([1, 702.5, 3, 699])), 2);
	assert.deepEqual([...h].map((v) => +v.toFixed(1)), [500, 702.5, 498, 699]);
});

import { riverArrays, railArrays, bridgeArrays, detailArrays } from '../src/objgeo.js';

test('Obiekty w tablicach (wątek kafli): rzeka, tor z mostem, peron ze zdegenerowanym obrysem, aleje i linia', () => {
	const flat = () => 200;
	const line = (pts) => pts.flatMap(([x, z]) => [x * 10, z * 10]);
	const rv = riverArrays([[150, line([[0, 0], [300, 0]])], [10, line([[0, 50], [100, 50]])]], flat);
	assert.ok(rv.mesh.count > 0 && rv.mesh.idx instanceof Uint32Array);
	assert.equal(rv.lines.length, 2, 'rów 1 m – tylko linia maski');
	const rl = railArrays([[0, 0, 1, 0, line([[0, 0], [100, 0]])]], (x) => 200 + x * 0.1);
	const ys = [...rl.mesh.pos].filter((_, i) => i % 3 === 1);
	assert.ok(Math.abs(ys[0] - 200.9) < 1e-3 && Math.abs(ys.at(-1) - 210.9) < 1e-3, 'most – prosta między przyczółkami');
	const osm = { roads: [[3, 70, 0, 1, 0, line([[0, 0], [60, 0]]), 0]], rails: [], platforms: [[line([[5, 5], [5, 5], [5, 5], [5, 5]])]] };
	const br = bridgeArrays(osm, flat);
	assert.equal(br.bridges, 1);
	assert.ok([...br.pos].every(Number.isFinite), 'bez NaN z peronu-punktu');
	const det = { roads: [[3, 70, 0, 0, 0, line([[0, 0], [400, 0]]), 0]], treeRows: [[line([[0, 100], [200, 100]])]], power: [[0, line([[0, 300], [200, 300], [400, 300]])]] };
	const a = detailArrays(det, flat, () => 0, { water: 6, built: 4, forest: 1 }, Infinity, 7);
	const b = detailArrays(det, flat, () => 0, { water: 6, built: 4, forest: 1 }, Infinity, 7);
	assert.ok(a.treeCount > 10);
	assert.equal(a.trees.length, a.treeCount * 16);
	assert.deepEqual([...a.trees.slice(0, 16)], [...b.trees.slice(0, 16)], 'ten sam los – te same drzewa');
	assert.ok(a.pylons.count > 0 && a.wires.length > 0);
});

test('PMTiles: zapis i odczyt archiwum kafli (katalog główny i liście, powtórzone dane)', async () => {
	const zlib = await import('node:zlib');
	const { writePmtiles, PmtilesReader, lotTileId, zxyToTileId, parseHeader } = await import('../src/gen/pmtiles.js');
	// numery kafli jak w specyfikacji
	assert.equal(zxyToTileId(0, 0, 0), 0);
	assert.equal(zxyToTileId(1, 0, 0), 1);
	assert.equal(zxyToTileId(1, 1, 0), 4);
	assert.equal(zxyToTileId(2, 0, 0), 5);
	const tiles = [];
	for (let x = 0; x < 120; x++) for (let y = 0; y < 50; y++) {
		tiles.push({ id: lotTileId('', 14, 9000 + x, 5400 + y), data: new Uint8Array([x, y, 1]) });
		tiles.push({ id: lotTileId('height', 14, 9000 + x, 5400 + y), data: new Uint8Array(y % 2 ? [7, 7] : [x, y, 2, 2]) });
	}
	for (const leafSize of [4096, 500]) {
		const file = writePmtiles(tiles, { areas: { test: { built: 'x' } } }, { compress: (d) => zlib.gzipSync(d), leafSize, minZoom: 14, maxZoom: 14 });
		const h = parseHeader(file.buffer);
		assert.equal(h.addressed, tiles.length);
		assert.ok(h.contents < tiles.length); // powtórzone [7, 7] zapisane raz
		let reads = 0;
		const read = async (o, n) => { reads++; return file.slice(o, o + n).buffer; };
		const r = await new PmtilesReader(read, (b) => new Uint8Array(zlib.gunzipSync(b))).open();
		assert.deepEqual(r.metadata, { areas: { test: { built: 'x' } } });
		assert.deepEqual([...new Uint8Array(await r.get(lotTileId('', 14, 9007, 5433)))], [7, 33, 1]);
		assert.deepEqual([...new Uint8Array(await r.get(lotTileId('height', 14, 9119, 5449)))], [7, 7]);
		assert.deepEqual([...new Uint8Array(await r.get(lotTileId('height', 14, 9118, 5448)))], [118, 48, 2, 2]);
		assert.equal(await r.get(lotTileId('cover', 14, 9007, 5433)), null);
		assert.equal(await r.get(lotTileId('', 14, 9200, 5433)), null);
		if (leafSize === 500) assert.ok(h.leafLength > 0 && reads > 3);
	}
});

test('PMTiles: zły nagłówek – komunikat z początkiem odpowiedzi', async () => {
	const { parseHeader } = await import('../src/gen/pmtiles.js');
	const html = new TextEncoder().encode('<!DOCTYPE html><html>');
	assert.throws(() => parseHeader(html.buffer), /PMTiles v3 \(21 B, początek: 3c 21 44 .*„<!DOCTYPE html><”\)/);
});
