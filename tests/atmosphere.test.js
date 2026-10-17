import test from 'node:test';
import assert from 'node:assert/strict';
import { transmittance, extinction, distanceToTop, hitsGround, ATMOSPHERE } from '../src/atmosphere/model.js';

const clear = { ...ATMOSPHERE, haze: 1 };

test('czyste powietrze: przepuszczalność w zenicie jak w publikacji (niebieski najsłabszy)', () => {
	const [r, g, b] = transmittance(0, 1, clear);
	assert.ok(r > 0.9 && r < 0.97, `r ${r}`);
	assert.ok(b < g && g < r);
	assert.ok(b > 0.7, `b ${b}`);
});

test('przy horyzoncie słońce czerwienieje', () => {
	const [r, g, b] = transmittance(0, 0.02, clear);
	assert.ok(r > 2 * b, `r ${r} b ${b}`);
});

test('mgiełka (więcej aerozoli) osłabia światło', () => {
	const t1 = transmittance(0, 0.3, clear)[1];
	const t10 = transmittance(0, 0.3, { ...ATMOSPHERE, haze: 10 })[1];
	assert.ok(t10 < t1);
});

test('wygaszanie maleje z wysokością', () => {
	assert.ok(extinction(0)[2] > extinction(5)[2] && extinction(5)[2] > extinction(30)[2]);
});

test('geometria: odległość do granicy atmosfery i trafienie w Ziemię', () => {
	const r = ATMOSPHERE.groundRadius;
	assert.ok(Math.abs(distanceToTop(r, 1) - 100) < 1e-6);
	assert.equal(hitsGround(r + 1, -0.5), true);
	assert.equal(hitsGround(r + 1, 0.1), false);
	assert.deepEqual(transmittance(1, -0.5), [0, 0, 0]);
});
