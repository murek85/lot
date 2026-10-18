import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadGraph, joinRoads, edgeGrid, pointAt } from '../src/traffic/graph.js';
import { TrafficSim, trafficByHour } from '../src/traffic/sim.js';

// drogi: [klasa, szerokość×10, nawierzchnia, most, warstwa, współrzędne (dm), jednokierunkowa]
const road = (cls, pts, oneway = 0, bridge = 0) => [cls, 70, 0, bridge, 0, pts.flatMap(([x, z]) => [x * 10, z * 10]), oneway];

test('graf: węzły na końcach i we wspólnych punktach, kierunki jednokierunkowych', () => {
	const g = buildRoadGraph([
		road(1, [[0, 0], [100, 0], [200, 0]]), // przez skrzyżowanie w (100, 0)
		road(2, [[100, -100], [100, 0], [100, 100]], 1), // jednokierunkowa na południe
	], { join: false });
	assert.equal(g.edges.length, 4);
	assert.equal(g.nodes.length, 5);
	const center = g.nodes.find((n) => n.x === 100 && n.z === 0);
	// z węzła centralnego: dwukierunkowa w obie strony (2) + jednokierunkowa dalej na południe (1)
	assert.equal(center.out.length, 3);
	const north = g.nodes.find((n) => n.z === -100);
	assert.equal(north.out.length, 1, 'wjazd w jednokierunkową tylko od jej początku');
	const p = pointAt(g.edges[0], 50);
	assert.deepEqual([p.x, p.z, p.tx, p.tz], [50, 0, 1, 0]);
});

test('łączenie dróg bez wspólnego punktu: przecięcie X i koniec przy drodze (T), most bez połączenia', () => {
	const roads = [
		road(1, [[0, 0], [200, 0]]),
		road(2, [[100, -100], [100, 100]]), // przecina bez wspólnego punktu
		road(3, [[50, 50], [50, 1]]), // kończy się 1 m od drogi głównej
		road(1, [[150, -50], [150, 50]], 0, 1), // most nad drogą – bez połączenia
	];
	const j = joinRoads(roads);
	const has = (r, x, z) => { for (let i = 0; i < r[5].length; i += 2) if (r[5][i] === x * 10 && r[5][i + 1] === z * 10) return true; return false; };
	assert.ok(has(j[0], 100, 0) && has(j[1], 100, 0), 'wspólny punkt przecięcia');
	assert.ok(has(j[2], 50, 0) && has(j[0], 50, 0), 'koniec przyciągnięty do drogi');
	assert.ok(!has(j[0], 150, 0), 'most się nie łączy');
	const g = buildRoadGraph(roads);
	const deg1 = g.nodes.filter((n) => g.edges.filter((e) => e.a === n.id || e.b === n.id).length === 1).length;
	assert.equal(deg1, 7, 'końce: 2 + 2 + 1 (T) + 2 (most)');
});

test('ruch: pojazdy się pojawiają, jadą z prędkością drogi, jednokierunkową tylko z prądem, znikają daleko', () => {
	const roads = [road(0, [[-3000, 0], [3000, 0]], 1), road(3, [[0, -2000], [0, 2000]])];
	const g = buildRoadGraph(roads);
	const sim = new TrafficSim(g, edgeGrid(g.edges), { radius: 1500, max: 500, seed: 3 });
	for (let i = 0; i < 600; i++) sim.step(1 / 30, { x: 0, z: 0 });
	assert.ok(sim.agents.length > 10, `${sim.agents.length} pojazdów`);
	for (const a of sim.agents) {
		assert.ok(Math.hypot(a.x, a.z) < 1500 * 1.13);
		if (a.edge.cls === 0) assert.ok(a.hx > 0.99, 'autostrada (jednokierunkowa) – tylko na wschód');
		assert.ok(a.v <= 33 * 1.15 * 1.01);
	}
	// odstępy na pasie
	for (const l of sim.lanes.values()) {
		const s = l.map((a) => a.s).sort((p, q) => p - q);
		for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] > 2, `odstęp ${s[i] - s[i - 1]}`);
	}
	// prawostronny: na dwukierunkowej (oś x = 0) jadący na południe (hz > 0) są po zachodniej stronie (x < 0)
	for (const a of sim.agents.filter((a) => a.edge.cls === 3 && Math.abs(a.z) > 50)) assert.ok(a.hz > 0 ? a.x < 0 : a.x > 0);
});

test('natężenie ruchu: szczyty rano i po południu, noc spokojna', () => {
	assert.ok(trafficByHour(7.5) > 0.8 && trafficByHour(16.5) > 0.8);
	assert.ok(trafficByHour(3) < 0.2);
	assert.ok(trafficByHour(12) > trafficByHour(22));
});

import { TrainSim, railsAsRoads, makeConsist, CARS } from '../src/traffic/trains.js';

// tory: [rodzaj, bocznica, most, warstwa, współrzędne (dm)]
const rail = (pts, kind = 0, service = 0) => [kind, service, 0, 0, pts.flatMap(([x, z]) => [x * 10, z * 10])];

test('pociągi: tory na graf (bez nieczynnych), składy z długością', () => {
	const r = railsAsRoads([rail([[0, 0], [10, 0]]), rail([[0, 0], [10, 0]], 0, 1), rail([[0, 0], [10, 0]], 1), rail([[0, 0], [10, 0]], 2)]);
	assert.deepEqual(r.map((x) => x[0]), [0, 1, 2]);
	let s = 1;
	const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
	for (const t of ['emu', 'ic', 'freight', 'narrow']) {
		const c = makeConsist(t, random);
		const sum = c.cars.reduce((a, b) => a + b.len, 0) + c.cars.length - 1;
		assert.ok(Math.abs(sum - c.length) < 1e-9);
		assert.ok(c.cars.every((x) => CARS[x.kind]));
	}
});

test('pociągi: jadą po szlaku, stają na stacji, na końcu toru zawracają; ostrego rozjazdu nie biorą', () => {
	// szlak wschód–zachód 0…8 km, stacja w połowie, ostra odnoga (90°) w 2 km
	const rails = [rail([[0, 0], [2000, 0], [8000, 0]]), rail([[2000, 0], [2000, 3000]])];
	const sim = new TrainSim(rails, [[0, [40000, 200], 'Środek']], { radius: 9000, max: 1, seed: 5 });
	assert.equal([...sim.stops.values()].flat().length, 1);
	let stopped = false, reversed = false, onBranch = false, lastDir = null;
	for (let i = 0; i < 20 * 60 * 15; i++) {
		sim.step(0.05, { x: 4000, z: 0 });
		const tr = sim.trains[0];
		if (!tr) continue;
		const h = tr.cars[0];
		if (tr.dwell > 0 && Math.abs(h.x - 4000) < 400) stopped = true;
		if (h.z > 30) onBranch = true;
		if (lastDir !== null && Math.sign(h.hx) !== lastDir && Math.abs(h.hx) > 0.9) reversed = true;
		if (Math.abs(h.hx) > 0.9) lastDir = Math.sign(h.hx);
		for (const c of tr.cars) assert.ok(Math.abs(c.z) < 1 || c.z > 30 || c.x > 1990, 'wagony na torze');
	}
	assert.ok(sim.trains.length === 1);
	assert.ok(!onBranch, 'odnoga pod kątem prostym – pominięta');
	assert.ok(reversed, 'zawrócił na końcu toru');
	if (sim.trains[0].type !== 'freight') assert.ok(stopped, 'postój na stacji');
});

import { packNetwork, unpackNetwork, projectToGraph } from '../src/traffic/graph.js';

test('sieć spakowana do tablic i z powrotem – te same krawędzie, węzły, drogi i siatka', () => {
	const roads = [road(0, [[-3000, 0], [0, 0], [3000, 0]], 1), road(3, [[0, -2000], [0, 0], [0, 2000]]), road(4, [[500, 10], [900, 600]])];
	const g = buildRoadGraph(roads), grid = edgeGrid(g.edges);
	const { packed, transfer } = packNetwork(g, grid);
	assert.ok(transfer.every((b) => b instanceof ArrayBuffer));
	const u = unpackNetwork(structuredClone(packed));
	assert.equal(u.graph.edges.length, g.edges.length);
	for (const e of g.edges) {
		const f = u.graph.edges[e.id];
		for (const k of ['a', 'b', 'cls', 'oneway', 'way']) assert.equal(f[k], e[k], k);
		assert.ok(Math.abs(f.len - e.len) < 1e-3);
		assert.deepEqual([...f.pts], [...e.pts]);
		assert.deepEqual([...f.cum], [...e.cum]);
	}
	for (const n of g.nodes) assert.deepEqual(u.graph.nodes[n.id].out, n.out);
	assert.deepEqual(u.graph.ways.map((w) => w.first), g.ways.map((w) => w.first));
	for (const [k, ids] of grid.map) assert.deepEqual([...u.grid.map.get(k)], ids);
});

test('przepięcie na nową sieć: punkt na drodze w kierunku jazdy; poprzeczna i daleka – nie', () => {
	const g = buildRoadGraph([road(3, [[-1000, 0], [1000, 0]]), road(3, [[200, -500], [200, 500]])]), grid = edgeGrid(g.edges);
	const hit = projectToGraph(g, grid, 50, 1.5, -1, 0);
	assert.ok(hit);
	const e = g.edges[hit.edge];
	assert.equal(hit.dir, -1);
	const p = pointAt(e, hit.s);
	assert.ok(Math.hypot(p.x - 50, p.z) < 1e-3, 'rzut na oś drogi');
	assert.equal(projectToGraph(g, grid, 50, 30, -1, 0), null, 'za daleko');
	assert.equal(g.edges[projectToGraph(g, grid, 201, 300, 0, 1).edge].pts[0], 200, 'droga N–S, jazda na południe');
});

test('ruch: przebudowa sieci (otwarty świat) – pojazdy zostają na drogach, jadą dalej', () => {
	const roads = [road(2, [[-3000, 0], [3000, 0]]), road(3, [[0, -2000], [0, 2000]])];
	const g = buildRoadGraph(roads);
	const sim = new TrafficSim(g, edgeGrid(g.edges), { radius: 1500, max: 300, seed: 4 });
	for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 });
	const n = sim.agents.length;
	// nowa sieć z tych samych dróg, pociętych inaczej (jak kafle) – te same miejsca
	const g2 = buildRoadGraph([road(2, [[-3000, 0], [-700, 0]]), road(2, [[-700, 0], [3000, 0]]), ...roads.slice(1)]);
	const pos = sim.agents.map((a) => [a.x, a.z]);
	sim.rebind(g2, edgeGrid(g2.edges));
	assert.equal(sim.agents.length, n);
	sim.agents.forEach((a, i) => { sim.place(a); assert.ok(Math.hypot(a.x - pos[i][0], a.z - pos[i][1]) < 0.5); });
	for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 });
	assert.ok(sim.agents.length > n * 0.5);
});

test('pociągi: przebudowa sieci – pociąg zostaje na torze i jedzie w tę samą stronę', () => {
	const rails = [rail([[0, 0], [8000, 0]])];
	const sim = new TrainSim(rails, [], { radius: 9000, max: 1, seed: 6 });
	for (let i = 0; i < 200; i++) sim.step(0.05, { x: 4000, z: 0 });
	const tr = sim.trains[0];
	const hx = tr.cars[0].hx, x0 = tr.cars[0].x;
	sim.rebind([rail([[0, 0], [3000, 0]]), rail([[3000, 0], [8000, 0]])], []);
	assert.equal(sim.trains.length, 1);
	for (let i = 0; i < 20; i++) sim.step(0.05, { x: 4000, z: 0 });
	const c = sim.trains[0].cars[0];
	assert.ok(Math.abs(c.z) < 1);
	assert.equal(Math.sign(c.hx), Math.sign(hx));
	assert.ok(Math.abs(c.x - x0) < 200);
});
