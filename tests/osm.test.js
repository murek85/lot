import test from 'node:test';
import assert from 'node:assert/strict';
import { roadInfo, buildingInfo, collect } from '../tools/lib/osm.js';
import { densify, ribbon, rasterizeMask } from '../src/roads.js';
import { minRect, polygonArea2, addBuilding } from '../src/buildings.js';
import { alongLine } from '../src/details.js';
import { rng } from '../src/clouds/noise3d.js';

test('klasy dróg i szerokości z tagów', () => {
	assert.deepEqual(roadInfo({ highway: 'primary' }), { cls: 1, width: 9, surface: 0, oneway: 0 });
	// kierunek: tag, odwrotny, autostrada i rondo domyślnie jednokierunkowe, chyba że oneway=no
	assert.equal(roadInfo({ highway: 'primary', oneway: 'yes' }).oneway, 1);
	assert.equal(roadInfo({ highway: 'primary', oneway: '-1' }).oneway, -1);
	assert.equal(roadInfo({ highway: 'motorway' }).oneway, 1);
	assert.equal(roadInfo({ highway: 'motorway_link' }).oneway, 1);
	assert.equal(roadInfo({ highway: 'tertiary', junction: 'roundabout' }).oneway, 1);
	assert.equal(roadInfo({ highway: 'motorway', oneway: 'no' }).oneway, 0);
	assert.equal(roadInfo({ highway: 'secondary_link' }).cls, 2);
	assert.equal(roadInfo({ highway: 'residential', lanes: '4' }).width, 12.8);
	assert.equal(roadInfo({ highway: 'track' }).surface, 4);
	assert.equal(roadInfo({ highway: 'service', surface: 'paving_stones' }).surface, 1);
	assert.equal(roadInfo({ highway: 'proposed' }), null);
});

test('budynki: wysokość z pięter, domyślna z rodzaju, dach z tagu', () => {
	assert.equal(buildingInfo({ building: 'apartments', 'building:levels': '5' }).height, 15.6);
	assert.equal(buildingInfo({ building: 'apartments', 'building:levels': '5' }).known, true);
	assert.equal(buildingInfo({ building: 'house' }).known, false);
	assert.equal(buildingInfo({ building: 'church' }).type, 6);
	assert.equal(buildingInfo({ building: 'yes', 'roof:shape': 'gabled' }).roof, 1);
	assert.equal(buildingInfo({ building: 'garage', height: '2,8' }).height, 2.8);
});

test('zbieranie odpowiedzi Overpass: bez duplikatów z nakładających się kafelków', () => {
	const center = { lon: 17.65, lat: 53.64 };
	const way = { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lon: 17.65, lat: 53.64 }, { lon: 17.651, lat: 53.64 }] };
	const st = { type: 'node', id: 2, lon: 17.66, lat: 53.65, tags: { railway: 'station', name: 'Tuchola' } };
	const out = collect([{ elements: [way, st] }, { elements: [way] }], center);
	assert.equal(out.roads.length, 1);
	assert.equal(out.stations[0].name, 'Tuchola');
	assert.ok(Math.abs(out.roads[0].c[2] - 659) < 2); // 0,001° długości na 53,64° N ≈ 65,9 m = 659 dm
});

test('wstęga drogi: odcinki ≤ 12 m, przód trójkątów w górę, szerokość zachowana', () => {
	const pts = densify([0, 0, 100, 0]);
	assert.equal(pts.length / 2, 10);
	const rb = ribbon(pts, 3, () => 5);
	for (let t = 0; t < rb.idx.length; t += 3) {
		const [a, b, c] = [rb.idx[t], rb.idx[t + 1], rb.idx[t + 2]].map((i) => [rb.pos[i * 3], rb.pos[i * 3 + 2]]);
		const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
		assert.ok(cy > 0, 'trójkąt skierowany w górę');
	}
	assert.ok(Math.abs(Math.abs(rb.pos[2] - rb.pos[5]) - 6) < 1e-9);
});

test('maska dróg obejmuje pas wokół osi', () => {
	const m = rasterizeMask([{ pts: [-50, 0, 50, 0], half: 2 }], 200, 200, 1);
	assert.equal(m[100 * 200 + 100], 255); // środek
	assert.equal(m[103 * 200 + 100], 0); // 3,5 m od osi > 3 m
});

test('najmniejszy prostokąt otaczający obrócony kwadrat i prostokąt', () => {
	const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
	const rect = [[-10, -4], [10, -4], [10, 4], [-10, 4]].flatMap(([x, z]) => [x * c - z * s, x * s + z * c]);
	const r = minRect(rect);
	assert.ok(Math.abs(r.area - 160) < 1e-6);
	assert.ok(Math.abs(Math.max(r.w, r.h) - 20) < 1e-6);
});

test('budynek: ściany z normalnymi na zewnątrz, dach dwuspadowy nad ścianami', () => {
	const pts = [0, 0, 10, 0, 10, 6, 0, 6];
	assert.ok(polygonArea2(pts) > 0);
	const b = { pos: [], nrm: [], kind: [], uv: [], wall: [], roof: [], idx: [], count: 0 };
	addBuilding(b, pts, 100, 3, 1, [1, 1, 1], [1, 0, 0], 0.5);
	for (let i = 0; i < b.count; i++) {
		if (b.kind[i] !== 0 || b.nrm[i * 3 + 1] !== 0) continue;
		// środek budynku (5, 3) leży po wewnętrznej stronie ściany
		const x = b.pos[i * 3], z = b.pos[i * 3 + 2];
		assert.ok((5 - x) * b.nrm[i * 3] + (3 - z) * b.nrm[i * 3 + 2] < 0.01);
	}
	const ys = b.pos.filter((_, i) => i % 3 === 1);
	assert.ok(Math.max(...ys) > 104 && Math.min(...ys) === 100);
});

test('aleja: drzewa co ~step po obu stronach w zadanej odległości', () => {
	const trees = alongLine([0, 0, 200, 0], 10, 5, [-1, 1], rng(1));
	assert.ok(trees.length > 30 && trees.length < 50);
	assert.ok(trees.every(([, z]) => Math.abs(Math.abs(z) - 5) < 0.7));
});
