import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkFrame, heightTilesFor, chunkHeights, gridNormals, chunkObjects, chunkMask, GRID, COVER_RES, CHUNK_Z, MASK_RES } from '../src/world/chunkdata.js';
import { tilesAround, gridHeightAt } from '../src/world/streamer.js';
import { worldRegion, WORLD_SIZE } from '../src/world/world.js';
import { COVER } from '../src/gen/terrain.js';
import { lonToTileX, latToTileY, lonLatToLocal } from '../src/geo.js';

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
