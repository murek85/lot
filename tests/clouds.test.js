import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, worley3, perlin3, shapeNoise, detailNoise, weatherMap } from '../src/clouds/noise3d.js';

test('generator losowy jest powtarzalny', () => {
	const a = rng(5), b = rng(5);
	for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

test('szumy są okresowe – brak szwu na krawędzi kafelka', () => {
	const w = worley3(4, 1), p = perlin3(4, 2);
	for (const [x, y, z] of [[0.13, 0.5, 0.71], [0.99, 0.02, 0.4], [0.5, 0.5, 0.5]]) {
		assert.ok(Math.abs(w(x, y, z) - w(x + 1, y, z - 1)) < 1e-6);
		assert.ok(Math.abs(p(x, y, z) - p(x, y + 1, z + 2)) < 1e-6);
	}
});

test('Worley: 1 w punkcie cechy, wartości w 0..1', () => {
	const w = worley3(3, 9);
	let max = 0, min = 1;
	for (let i = 0; i < 2000; i++) {
		const v = w(Math.random(), Math.random(), Math.random());
		max = Math.max(max, v);
		min = Math.min(min, v);
	}
	assert.ok(min >= 0 && max <= 1 && max > 0.8);
});

test('tekstury mają właściwe rozmiary i zróżnicowane wartości', () => {
	const s = shapeNoise(16), d = detailNoise(8), w = weatherMap(32);
	assert.equal(s.length, 16 ** 3);
	assert.equal(d.length, 8 ** 3);
	assert.equal(w.length, 32 * 32 * 2);
	const spread = (a) => Math.max(...a) - Math.min(...a);
	assert.ok(spread(s) > 100 && spread(d) > 100);
	const cov = w.filter((_, i) => i % 2 === 0);
	const share = cov.filter((v) => v > 128).length / cov.length;
	assert.ok(share > 0.15 && share < 0.85, `udział zachmurzonych komórek ${share}`);
});
