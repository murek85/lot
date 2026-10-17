import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, sunDirection, dayOfYear } from '../src/sun.js';

const DEG = 180 / Math.PI;
const LAT = 53.64, LON = 17.65;

test('dzień roku', () => {
	assert.equal(dayOfYear(1, 1), 1);
	assert.equal(dayOfYear(6, 21), 172);
	assert.equal(dayOfYear(12, 31), 365);
});

test('przesilenie letnie: słońce w górowaniu ~59,8° nad Tucholą, od południa', () => {
	// górowanie ok. 12:50 czasu letniego (10:50 UTC) – szukamy maksimum
	let best = { elevation: -1 };
	for (let h = 9; h < 13; h += 1 / 60) {
		const p = sunPosition(dayOfYear(6, 21), h, LAT, LON);
		if (p.elevation > best.elevation) best = { ...p, h };
	}
	assert.ok(Math.abs(best.elevation * DEG - (90 - LAT + 23.44)) < 0.3, `wysokość ${best.elevation * DEG}`);
	assert.ok(Math.abs(best.azimuth * DEG - 180) < 1.5, `azymut ${best.azimuth * DEG}`);
	assert.ok(Math.abs(best.h - 10.85) < 0.15, `godzina UTC ${best.h}`);
});

test('wschód latem na północnym wschodzie, zachód na północnym zachodzie', () => {
	const d = dayOfYear(6, 21);
	const morning = sunPosition(d, 2.5, LAT, LON); // 4:30 czasu letniego
	const evening = sunPosition(d, 19.3, LAT, LON); // 21:18
	assert.ok(morning.azimuth * DEG > 30 && morning.azimuth * DEG < 60);
	assert.ok(evening.azimuth * DEG > 300 && evening.azimuth * DEG < 330);
});

test('kierunek do słońca w układzie sceny (x – wschód, z – południe)', () => {
	const [x, y, z] = sunDirection(Math.PI / 2, 0); // wschód, horyzont
	assert.ok(Math.abs(x - 1) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z) < 1e-9);
	const s = sunDirection(Math.PI, Math.PI / 4); // południe, 45°
	assert.ok(s[2] > 0.7 && Math.abs(s[0]) < 1e-9);
});
