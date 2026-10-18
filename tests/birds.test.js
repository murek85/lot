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

test('modele ptaków: każdy gatunek, symetria skrzydeł, stawy, lotki u szybowników', async () => {
	const { MODELS, buildBird } = await import('../src/fauna/birdmodels.js');
	for (const id of Object.keys(SPECIES)) {
		assert.ok(MODELS[id], `model ${id}`);
		const b = buildBird(MODELS[id]);
		assert.equal(b.pos.length / 3, b.col.length / 3);
		assert.ok(b.idx.every((i) => i < b.pos.length / 3));
		// rozpiętość 1: końce skrzydeł na ±0,5, symetrycznie
		const xs = b.pos.filter((_, i) => i % 3 === 0);
		assert.ok(Math.abs(Math.max(...xs) - 0.5) < 0.02 && Math.abs(Math.min(...xs) + 0.5) < 0.02, id);
		assert.ok(b.joints.shoulder < b.joints.wrist && b.joints.wrist < 0.5);
		assert.ok(b.idx.length / 3 < 300, 'lekkie bryły');
	}
	// szybowniki (bocian, myszołów, wrona) mają rozcapierzone lotki – więcej trójkątów niż mewa i szpak
	assert.ok(buildBird(MODELS.buzzard).idx.length > buildBird(MODELS.gull).idx.length);
});

test('ptaki: kurs, przechył w zakręcie i pochylenie przy wznoszeniu', () => {
	const sim = new BirdSim({ coverAt: () => 'crop', groundAt: () => 0, radius: 2000, seed: 4 });
	sim.weights = speciesWeights(day);
	for (let i = 0; i < 300; i++) sim.step(1 / 30, { x: 0, z: 0 });
	const birds = sim.birds;
	assert.ok(birds.length > 0);
	for (const b of birds) {
		assert.ok(Number.isFinite(b.yaw) && Number.isFinite(b.bank) && Number.isFinite(b.pitch));
		assert.ok(Math.abs(b.bank) <= 1.11 && Math.abs(b.pitch) < 1.2);
		assert.ok(b.glideK >= 0 && b.glideK <= 1);
	}
	// zakręcający ptak przechyla się w stronę zakrętu
	assert.ok(birds.some((b) => Math.abs(b.bank) > 0.05));
});
