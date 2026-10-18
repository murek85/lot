import test from 'node:test';
import assert from 'node:assert/strict';
import { PeopleSim, peopleByHour } from '../src/fauna/people.js';

const road = (cls, pts, w = 60) => [cls, w, 0, 0, 0, pts.flatMap(([x, z]) => [x * 10, z * 10]), 0];

test('piesi: chodzą po chodnikach (obok jezdni) i ścieżkach w zabudowie, tylko z niska, w promieniu', () => {
	const roads = [road(4, [[-500, 0], [0, 0], [500, 0]]), road(7, [[0, -400], [0, 0], [0, 400]], 20), road(0, [[-500, 50], [500, 50]], 220)];
	const sim = new PeopleSim(roads, [], { coverAt: () => 'built', radius: 400, max: 200, seed: 3 });
	for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 }, 1);
	assert.ok(sim.agents.length > 100, `${sim.agents.length}`);
	for (const a of sim.agents) {
		assert.ok(Math.hypot(a.x, a.z) < 400 * 1.15 + 5);
		if (a.edge.cls === 4 && Math.abs(a.x) > 10) assert.ok(Math.abs(Math.abs(a.z) - 4.3) < 0.01, `chodnik, nie jezdnia: ${a.z}`);
		if (a.edge.cls === 7 && Math.abs(a.z) > 10) assert.ok(Math.abs(a.x) <= 0.6);
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
	assert.ok(field.agents.length < sim.agents.length / 3);
});

test('piesi: natężenie wg godziny', () => {
	assert.ok(peopleByHour(13) > 0.6 && peopleByHour(17) > 0.6);
	assert.ok(peopleByHour(3) < 0.1);
});
