import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeometry, decodeTile, ringArea } from '../src/gen/mvt.js';
import { tilesFor, tileToLocal, clipLine, clipRing } from '../src/gen/tiles.js';
import { convertTile, rasterizePolygon, pickPlaces, roadFrom, COVER } from '../src/gen/convert.js';
import { lonLatToLocal, lonToTileX, latToTileY } from '../src/geo.js';

const zz = (v) => (v << 1) ^ (v >> 31);

test('MVT: geometria z poleceń (MoveTo, LineTo, ClosePath), pole pierścienia', () => {
	// kwadrat 10×10 od (5,5): MoveTo(5,5) LineTo(+10,0)(0,+10)(-10,0) ClosePath
	const cmds = [9, zz(5), zz(5), 26, zz(10), 0, 0, zz(10), zz(-10), 0, 15];
	const [ring] = decodeGeometry(cmds);
	assert.deepEqual(ring, [5, 5, 15, 5, 15, 15, 5, 15, 5, 5]);
	assert.equal(ringArea(ring), 100); // zgodnie z ruchem wskazówek (y w dół) – zewnętrzny
});

test('MVT: dekodowanie kafla z warstwą, kluczami i wartościami', () => {
	// ręcznie złożony protobuf: warstwa „water” z jednym punktem i właściwością class=lake
	const bytes = [];
	const varint = (v) => { while (v >= 0x80) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; } bytes.push(v); };
	const msg = (field, body) => { varint((field << 3) | 2); varint(body.length); bytes.push(...body); };
	const enc = (fn) => { const save = bytes.splice(0); fn(); const out = bytes.splice(0); bytes.push(...save); return out; };
	const str = (s) => [...new TextEncoder().encode(s)];
	const packed = (field, arr) => msg(field, enc(() => arr.forEach(varint)));
	const feat = enc(() => { packed(2, [0, 0]); varint(3 << 3); varint(1); packed(4, [9, zz(100), zz(200)]); });
	const val = enc(() => msg(1, str('lake')));
	const layer = enc(() => { msg(1, str('water')); msg(2, feat); msg(3, str('class')); msg(4, val); varint(5 << 3); varint(4096); });
	msg(3, layer);
	const t = decodeTile(new Uint8Array(bytes));
	assert.equal(t.layers.water.extent, 4096);
	assert.deepEqual(t.layers.water.features[0], { id: 0, type: 1, props: { class: 'lake' }, geom: [[100, 200]] });
});

test('kafle: pokrycie regionu i przeliczenie na metry lokalne', () => {
	const center = { lon: 19.02, lat: 50.26 };
	const tiles = tilesFor(center, 46000, 14);
	assert.ok(tiles.length > 800 && tiles.length < 1100, `${tiles.length} kafli`);
	const x = Math.floor(lonToTileX(center.lon, 14)), y = Math.floor(latToTileY(center.lat, 14));
	assert.ok(tiles.some(([a, b]) => a === x && b === y));
	const T = tileToLocal(14, x, y, 4096, center);
	const [mx, mz] = T.pt(2048, 2048);
	assert.ok(Math.abs(mx) < 2000 && Math.abs(mz) < 2000);
	assert.ok(Math.abs(T.metersPerUnit - 0.381) < 0.01);
});

test('kafle: przycinanie linii i pierścieni do kwadratu kafla', () => {
	assert.deepEqual(clipLine([-10, 50, 50, 50, 50, 150, 120, 150], 100), [[0, 50, 50, 50, 50, 100]]);
	assert.deepEqual(clipLine([-10, -10, -5, -5], 100), []);
	assert.deepEqual(clipRing([-50, -50, 50, -50, 50, 50, -50, 50, -50, -50], 100), [0, 0, 50, 0, 50, 50, 0, 50, 0, 0]);
	assert.equal(clipRing([200, 200, 300, 200, 300, 300, 200, 200], 100), null);
});

test('konwersja kafla: drogi, tory, budynki, cieki, pokrycie, stacje i miejscowości', () => {
	const center = { lon: 19.02, lat: 50.26 };
	const x = Math.floor(lonToTileX(center.lon, 14)), y = Math.floor(latToTileY(center.lat, 14));
	const sq = (x0, y0, s) => [x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s, x0, y0];
	const L = (features) => ({ extent: 4096, features });
	const tile = { layers: {
		transportation: L([
			{ type: 2, props: { class: 'primary', surface: 'paved' }, geom: [[0, 100, 4096, 100]] },
			{ type: 2, props: { class: 'minor', brunnel: 'bridge' }, geom: [[-100, 200, 2000, 200]] },
			{ type: 2, props: { class: 'motorway', brunnel: 'tunnel' }, geom: [[0, 300, 4096, 300]] },
			{ type: 2, props: { class: 'rail', service: 'siding' }, geom: [[0, 400, 4096, 400]] },
			{ type: 2, props: { class: 'transit', subclass: 'tram' }, geom: [[0, 500, 4096, 500]] },
			{ type: 2, props: { class: 'track', surface: 'unpaved' }, geom: [[0, 600, 1000, 600]] },
			{ type: 3, props: { class: 'path', subclass: 'platform' }, geom: [sq(100, 700, 50)] },
		]),
		building: L([
			{ type: 3, props: { render_height: 30 }, geom: [sq(1000, 1000, 60), [1010, 1010, 1010, 1020, 1020, 1020, 1020, 1010, 1010, 1010]] },
			{ type: 3, props: { render_height: 4 }, geom: [sq(2000, 2000, 10)] }, // ~14,5 m² – gospodarczy
			{ type: 3, props: { render_height: 5 }, geom: [sq(3000, 3000, 2)] }, // pół m² – pominięty
		]),
		waterway: L([{ type: 2, props: { class: 'river' }, geom: [[0, 3500, 4096, 3600]] }]),
		landcover: L([{ type: 3, props: { class: 'wood' }, geom: [sq(0, 0, 4096)] }]),
		water: L([{ type: 3, props: { class: 'lake' }, geom: [sq(500, 500, 300)] }]),
		poi: L([{ type: 1, props: { class: 'railway', subclass: 'halt', name: 'Kato' }, geom: [[1500, 1500]] }]),
		place: L([{ type: 1, props: { class: 'city', name: 'Katowice', rank: 1 }, geom: [[2048, 2048]] }]),
	} };
	const out = convertTile(tile, 14, x, y, { center, half: 23000, buildings: 'all' });
	assert.equal(out.roads.length, 3);
	assert.deepEqual(out.roads[0].slice(0, 5), [1, 90, 0, 0, 0]);
	assert.equal(out.roads[1][3], 1); // most
	assert.deepEqual(out.roads[2].slice(0, 3), [6, 30, 4]);
	assert.equal(out.roads[1][5][0], out.roads[0][5][0]); // przycięta do krawędzi kafla
	assert.deepEqual(out.rails.map((r) => r.slice(0, 4)), [[0, 1, 0, 0]]);
	assert.equal(out.platforms.length, 1);
	assert.equal(out.buildings.length, 2);
	assert.deepEqual(out.buildings[0].slice(0, 4), [1, 300, -1, 1]);
	assert.equal(out.buildings[1][0], 2);
	assert.equal(out.waterways[0][0], 120);
	assert.deepEqual(out.cover.map((c) => c.cls), [COVER.forest, COVER.water]);
	assert.equal(out.stations[0][0], 1);
	assert.equal(out.stations[0][2], 'Kato');
	assert.equal(out.places[0].name, 'Katowice');
	// dziesiętne metry lokalne zgodne z rzutem gry
	const p = lonLatToLocal(center.lon, center.lat, center);
	assert.ok(Math.abs(p.x) < 1e-6);
	assert.equal(convertTile(tile, 14, x, y, { center, half: 23000, buildings: 'none' }).buildings.length, 0);
	assert.equal(convertTile(tile, 14, x, y, { center, half: 23000, buildings: 'large' }).buildings.length, 1);
	assert.equal(roadFrom('path', 'steps').id, 7);
	assert.equal(roadFrom('ferry'), null);
});

test('rastrowanie pokrycia: wielokąt z otworem, reguła parzysto-nieparzysta', () => {
	const n = 10, size = 100, grid = new Uint8Array(n * n);
	// kwadrat −40…40 m z otworem −10…10 m (układ regionu: środek 0, bok 100 m)
	const outer = [-40, -40, 40, -40, 40, 40, -40, 40, -40, -40], hole = [-10, -10, -10, 10, 10, 10, 10, -10, -10, -10];
	rasterizePolygon(grid, n, size, [outer, hole], 7);
	assert.equal(grid[1 * n + 1], 7);
	assert.equal(grid[5 * n + 5], 0);
	assert.equal(grid[0], 0);
	assert.equal(grid.filter((v) => v === 7).length, 64 - 4);
});

test('miejsca startu: miasta przed wsiami, z dala od krawędzi i od siebie', () => {
	const places = [
		{ name: 'Wieś', cls: 'village', rank: 10, x: 100, z: 0 },
		{ name: 'Miasto', cls: 'city', rank: 2, x: 0, z: 0 },
		{ name: 'Przy krawędzi', cls: 'town', rank: 5, x: 21000, z: 0 },
		{ name: 'Miasteczko', cls: 'town', rank: 6, x: 8000, z: 5000 },
		{ name: 'Szczyt', cls: 'peak', rank: 1, x: 0, z: 9000 },
	];
	assert.deepEqual(pickPlaces(places, 23000).map((p) => p.name), ['Miasto', 'Miasteczko']);
});
