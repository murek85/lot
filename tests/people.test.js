import test from 'node:test';
import assert from 'node:assert/strict';
import { PeopleSim, peopleByHour } from '../src/fauna/people.js';

const road = (cls, pts, w = 60) => [cls, w, 0, 0, 0, pts.flatMap(([x, z]) => [x * 10, z * 10]), 0];

// siatka ulic co `step` m w kwadracie ±half (klasa cls), do tego ścieżka i autostrada przez środek
const grid = (step, half = 1000, cls = 4) => {
	const out = [];
	for (let v = -half; v <= half; v += step) { out.push(road(cls, [[-half, v], [half, v]])); out.push(road(cls, [[v, -half], [v, half]])); }
	return out;
};

test('piesi: chodzą po chodnikach (obok jezdni) i ścieżkach w zabudowie, tylko z niska, w promieniu', () => {
	const roads = [...grid(100), road(7, [[50, -400], [50, 0], [50, 400]], 20), road(0, [[-500, 25], [500, 25]], 220)];
	const sim = new PeopleSim(roads, [], { coverAt: () => 'built', radius: 400, max: 200, seed: 3 });
	for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 }, 1);
	assert.ok(sim.agents.length > 100, `${sim.agents.length}`);
	for (const a of sim.agents) {
		assert.ok(Math.hypot(a.x, a.z) < 400 * 1.15 + 5);
		if (a.edge.cls === 4 && a.edge.pts[1] === a.edge.pts[3]) assert.ok(Math.abs(Math.abs(a.z - a.edge.pts[1]) - 4.3) < 0.01, `chodnik, nie jezdnia: ${a.z}`);
		if (a.edge.cls === 7 && Math.abs(a.z) > 10) assert.ok(Math.abs(a.x - 50) <= 0.6);
		assert.notEqual(a.edge.cls, 0, 'po autostradzie nikt nie chodzi');
		assert.ok(a.v > 1 && a.v < 1.7);
	}
	// kamera wysoko – nikogo nowego
	const hi = new PeopleSim(roads, [], { coverAt: () => 'built', radius: 400, seed: 3 });
	for (let i = 0; i < 30; i++) hi.step(1 / 30, { x: 0, z: 0 }, 0);
	assert.equal(hi.agents.length, 0);
	// poza zabudową – prawie pusto
	const field = new PeopleSim(roads, [], { coverAt: () => 'crop', radius: 400, max: 200, seed: 3 });
	for (let i = 0; i < 100; i++) field.step(1 / 30, { x: 0, z: 0 }, 1);
	assert.ok(field.agents.length < sim.agents.length / 5, `${field.agents.length}`);
});

test('piesi: liczba z długości chodników wokół – rzadka zabudowa, mniej ludzi', () => {
	const count = (roads) => {
		const sim = new PeopleSim(roads, [], { coverAt: () => 'built', radius: 400, max: 2000, seed: 5 });
		for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 }, 1);
		return sim.agents.length;
	};
	const dense = count(grid(100)), sparse = count(grid(400));
	assert.ok(sparse < dense / 2.5, `gęsto ${dense}, rzadko ${sparse}`);
	// ok. PER_KM na km chodnika: siatka co 100 m – ~0,02 m ulicy na m² × π·400²
	assert.ok(Math.abs(dense - 0.022 * 0.02 * Math.PI * 400 * 400) < 60, `${dense}`);
});

test('piesi: nie na trasach dwujezdniowych ani na drogach poza zabudową (także przechodząc ze skrzyżowania)', () => {
	// ulica w osiedlu (x < 0), dalej ta sama droga przez pola (x > 0); obok – główna jednokierunkowa (dwujezdniowa)
	const roads = [road(4, [[-600, 0], [0, 0]]), road(4, [[0, 0], [600, 0]]), [1, 120, 0, 0, 0, [-6000, 300, 6000, 300], 1]];
	const built = (x) => (x < 0 ? 'built' : 'crop');
	const sim = new PeopleSim(roads, [], { coverAt: (x) => built(x), radius: 700, max: 300, seed: 9 });
	for (let i = 0; i < 1500; i++) {
		sim.step(1 / 10, { x: 0, z: 0 }, 1);
		for (const a of sim.agents) {
			assert.notEqual(a.edge.cls, 1, 'trasa dwujezdniowa');
			assert.ok(a.x < 3, `pieszy zawędrował w pola: ${a.x}`);
		}
	}
	assert.ok(sim.agents.length > 0);
});

test('piesi: natężenie wg godziny', () => {
	assert.ok(peopleByHour(13) > 0.6 && peopleByHour(17) > 0.6);
	assert.ok(peopleByHour(3) < 0.1);
});
