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

test('dach dwuspadowy: położenie na połaci w rodzaju (okap 1 → kalenica 1,4), komin z cegły ponad kalenicą', () => {
	const pts = [0, 0, 10, 0, 10, 6, 0, 6];
	const fresh = () => ({ pos: [], nrm: [], kind: [], uv: [], wall: [], roof: [], idx: [], count: 0 });
	const b = fresh();
	addBuilding(b, pts, 100, 3, 1, [1, 1, 1], [1, 0, 0], 0.3);
	const roof = b.kind.map((k, i) => [k, b.pos[i * 3 + 1], b.uv[i * 2 + 1]]).filter(([k]) => k >= 1 && k < 1.5);
	const ridgeY = Math.max(...roof.map(([, y]) => y));
	for (const [k, y, v] of roof) {
		if (k === 1) assert.ok(y < 103 && v === 0); // okap: nisko, v = 0
		else { assert.equal(k, 1.4); assert.equal(y, ridgeY); assert.ok(v > 3); } // kalenica: v – długość połaci (> 3 m w poziomie)
	}
	// komin: dodatkowe wierzchołki z cegły, ponad kalenicą, ściany bez okien (v < 0)
	const c = fresh();
	addBuilding(c, pts, 100, 3, 1, [1, 1, 1], [1, 0, 0], 0.3, true);
	assert.equal(c.count - b.count, 20); // 4 ściany i wierzch
	const brick = [...Array(c.count).keys()].filter((i) => Math.abs(c.wall[i * 3] - 0.26) < 1e-6);
	assert.equal(brick.length, 20);
	assert.ok(brick.some((i) => c.pos[i * 3 + 1] > ridgeY + 0.5));
	assert.ok(brick.filter((i) => c.kind[i] === 0).every((i) => c.uv[i * 2 + 1] < 0));
});

test('aleja: drzewa co ~step po obu stronach w zadanej odległości', () => {
	const trees = alongLine([0, 0, 200, 0], 10, 5, [-1, 1], rng(1));
	assert.ok(trees.length > 30 && trees.length < 50);
	assert.ok(trees.every(([, z]) => Math.abs(Math.abs(z) - 5) < 0.7));
});

test('przejścia dla pieszych: skrzyżowania z drogą wyższej klasy w zabudowie, bez styków odcinków i bez arterii', async () => {
	const { roadCrossings } = await import('../src/gen/crossings.js');
	const dm = (pts) => pts.map((v) => Math.round(v * 10));
	// krzyżówka: wojewódzka (klasa 2, 7 m) wschód–zachód przez (0, 0), osiedlówka (klasa 4) z północy do niej
	const main = [2, 70, 0, 0, 0, dm([-100, 0, 0, 0, 100, 0]), 0];
	const side = [4, 55, 0, 0, 0, dm([0, -100, 0, 0]), 0];
	const houses = [[-20, 20], [20, 20], [-20, -20], [20, -30]].map(([x, z]) => [0, 60, 0, 1, dm([x, z, x + 8, z, x + 8, z + 8, x, z + 8])]);
	const zebras = roadCrossings([main, side], houses);
	assert.equal(zebras.length, 3); // dwa wyloty wojewódzkiej i jeden osiedlówki
	for (const z of zebras) {
		const mx = (z.pts[0] + z.pts[2]) / 2, mz = (z.pts[1] + z.pts[3]) / 2;
		assert.ok(Math.hypot(mx, mz) > 3.5 + 2.5 && Math.hypot(mx, mz) < 12); // za krawędzią najszerszej drogi
	}
	// bez zabudowy – nie ma
	assert.equal(roadCrossings([main, side], []).length, 0);
	// same osiedlówki – nie ma
	assert.equal(roadCrossings([[4, 55, 0, 0, 0, main[5], 0], side], houses).length, 0);
	// styk dwóch odcinków tej samej ulicy (dwa wyloty) – nie jest skrzyżowaniem
	const a = [2, 70, 0, 0, 0, dm([-100, 0, 0, 0]), 0], b = [2, 70, 0, 0, 0, dm([0, 0, 100, 0]), 0];
	assert.equal(roadCrossings([a, b], houses).length, 0);
	// szeroka arteria (ponad 14 m) – zebry tylko na bocznej ulicy
	const wide = [1, 180, 0, 0, 0, main[5], 1];
	assert.equal(roadCrossings([wide, side], houses).length, 1);
});

test('punkty orientacyjne: rodzaj i wymiary ze znaczników, geometria i światła przeszkodowe', async () => {
	const { landmarkInfo, LANDMARK } = await import('../src/gen/osmtags.js');
	const { landmarkArrays } = await import('../src/gen/landmarkgeo.js');
	assert.deepEqual(landmarkInfo({ power: 'generator', 'generator:source': 'wind', height: '120', 'rotor:diameter': '112' }), { kind: LANDMARK.wind, height: 120, rotor: 112 });
	assert.equal(landmarkInfo({ power: 'generator', 'generator:source': 'solar' }), null);
	assert.equal(landmarkInfo({ power: 'generator', 'generator:method': 'wind_turbine' }).rotor, 90); // domyślnie: 100 m, wirnik 0,9 H
	assert.equal(landmarkInfo({ man_made: 'chimney', height: '12' }), null); // kominy domów – pomijane
	assert.equal(landmarkInfo({ man_made: 'chimney', height: '150 m' }).height, 150);
	assert.equal(landmarkInfo({ man_made: 'mineshaft' }), null); // szyb bez wieży
	assert.equal(landmarkInfo({ man_made: 'mineshaft', headframe: 'yes' }).kind, LANDMARK.headframe);
	assert.equal(landmarkInfo({ man_made: 'tower', 'tower:type': 'communication', height: '90' }).kind, LANDMARK.mast);
	assert.equal(landmarkInfo({ man_made: 'tower', 'tower:type': 'observation' }), null);
	// wiatrak: wieża w bryłach, gondola i trzy łopaty w wirniku (łopaty obracane – aSpin > 0), światło na gondoli
	const w = landmarkArrays([[LANDMARK.wind, 0, 0, 1000, 900]], () => 200);
	assert.ok(w.body.count > 0);
	const spin = [...w.rotor.spin];
	assert.equal(spin.filter((s) => s > 0).length, 12);
	assert.ok(w.rotor.top.every((v, i) => (i % 3 === 1 ? v === 300 : v === 0)));
	assert.equal(w.beacons.length, 1);
	assert.ok(w.beacons[0][1] > 300);
	// wysoki komin: pasy i dwa światła; bez wysokości terenu – pomijany
	assert.equal(landmarkArrays([[LANDMARK.chimney, 0, 0, 1200, 0]], () => 0).beacons.length, 2);
	assert.equal(landmarkArrays([[LANDMARK.chimney, 0, 0, 1200, 0]], () => NaN).body.count, 0);
});

test('stadion: otwór nad boiskiem, trybuny w obrysie bez okien, dziedziniec zwykłego budynku', async () => {
	const { buildBuildingTiles } = await import('../src/buildgeo.js');
	const sq = (x, z, r, ccw = true) => { const p = [x - r, z - r, x + r, z - r, x + r, z + r, x - r, z + r].map((v) => v * 10); return ccw ? p : [p[6], p[7], p[4], p[5], p[2], p[3], p[0], p[1]]; };
	// stadion 160 × 160 m z boiskiem 100 × 100 m; trybuna (wysoka, z OpenMapTiles – typ 1) w jego obrysie; kamienica z dziedzińcem
	const t = buildBuildingTiles([
		[3, 50, -1, 0, sq(0, 0, 80), [sq(0, 0, 50, false)]],
		[1, 250, -1, 1, sq(65, 0, 10), []],
		[1, 150, -1, 1, sq(500, 0, 30), [sq(500, 0, 12, false)]],
	], () => 0);
	assert.equal(t.count, 3);
	const all = t.tiles.flatMap((b) => b.light.filter((_, i) => i % 2 === 0));
	// stadion i trybuna – bez okien (−1), kamienica – okna (szansa > 0)
	assert.equal(all.filter((v) => v === -1).length > 0, true);
	assert.equal(all.filter((v) => v > 0).length > 0, true);
	// dach stadionu nie przykrywa boiska: żaden trójkąt dachu (kind 2) nie ma środka w (0, 0) ± 40 m
	for (const b of t.tiles) {
		for (let i = 0; i < b.idx.length; i += 3) {
			const v = [b.idx[i], b.idx[i + 1], b.idx[i + 2]];
			if (!v.every((k) => b.kind[k] === 2)) continue;
			const cx = v.reduce((s, k) => s + b.pos[k * 3], 0) / 3, cz = v.reduce((s, k) => s + b.pos[k * 3 + 2], 0) / 3;
			assert.ok(Math.abs(cx) > 40 || Math.abs(cz) > 40 || Math.abs(cx) > 400, `trójkąt dachu nad boiskiem: ${cx}, ${cz}`);
		}
	}
});
