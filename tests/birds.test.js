import test from 'node:test';
import assert from 'node:assert/strict';
import { BirdSim, speciesWeights, SPECIES } from '../src/fauna/birds.js';

const day = { sunY: 0.5, day: 180, hour: 14, weather: {} };

test('ptaki: gatunki wg pory dnia, roku i pogody', () => {
	assert.ok(Object.values(speciesWeights({ ...day, sunY: -0.2 })).every((w) => w === 0), 'noc – brak');
	assert.ok(Object.values(speciesWeights({ ...day, weather: { storm: true } })).every((w) => w === 0), 'burza – brak');
	assert.equal(speciesWeights({ ...day, day: 20 }).stork, 0, 'bociany zimą odlatują');
	assert.ok(speciesWeights(day).stork > 0);
	const snow = speciesWeights({ ...day, day: 20, weather: { precip: { type: 'snow' } } });
	assert.equal(snow.starling, 0);
	assert.ok(snow.crow > 0);
	assert.ok(speciesWeights({ ...day, sunY: 0.05 }).starling > speciesWeights(day).starling, 'o zmierzchu stada szpaków');
});

test('ptaki: gatunek z miejsca, wysokość nad terenem, stado trzyma się razem, samolot płoszy i zderza', () => {
	const sim = new BirdSim({ coverAt: (x) => (x < 0 ? 'water' : 'crop'), groundAt: () => 100, radius: 2000, seed: 9 });
	sim.weights = speciesWeights(day);
	for (let i = 0; i < 600; i++) sim.step(1 / 30, { x: 0, z: 0 });
	assert.ok(sim.groups.length > 4);
	for (const g of sim.groups) {
		assert.ok(SPECIES[g.id].cover.includes(g.x < -300 ? 'water' : g.x > 300 ? 'crop' : SPECIES[g.id].cover[0]) || Math.abs(g.x) < 600);
		for (const b of g.birds) assert.ok(b.y >= 102 - 1e-6 && b.y < 100 + 450, `wysokość ${b.y}`);
		if (SPECIES[g.id].flock && g.birds.length > 3) {
			const spread = Math.max(...g.birds.map((b) => Math.hypot(b.x - g.x, b.z - g.z)));
			assert.ok(spread < 120, `stado ${g.id} rozproszone na ${spread} m`);
		}
	}
	// samolot przelatuje przez stado – płoszenie i zderzenie
	const g = sim.groups.find((x) => x.birds.length > 3) ?? sim.groups[0];
	const b = g.birds[0];
	sim.step(1 / 30, { x: 0, z: 0 }, { x: b.x, y: b.y, z: b.z });
	assert.ok(sim.events.some((e) => e.type === 'scare'));
	assert.ok(sim.events.some((e) => e.type === 'strike'));
});
