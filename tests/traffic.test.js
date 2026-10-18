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
