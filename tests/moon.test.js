import test from 'node:test';
import assert from 'node:assert/strict';
import { nightSky, moonIllumination, equatorialToScene, localSiderealTime, daysSinceJ2000 } from '../src/moon.js';
import { sunPosition, sunDirection, dayOfYear } from '../src/sun.js';

const LAT = 53.6, LON = 17.9;
const at = (month, day, hUtc) => {
	const d = dayOfYear(month, day, 2026);
	const p = sunPosition(d, hUtc, LAT, LON);
	return { sun: sunDirection(p.azimuth, p.elevation), sky: nightSky(2026, d, hUtc, LAT, LON) };
};

test('fazy Księżyca: pełnia 29.06.2026, nów 15.06.2026, kwadra pomiędzy', () => {
	const full = at(6, 29, 23.95), fresh = at(6, 15, 2.9), quarter = at(6, 21, 22);
	assert.ok(moonIllumination(full.sun, full.sky.moonDir) > 0.99);
	assert.ok(moonIllumination(fresh.sun, fresh.sky.moonDir) < 0.01);
	const q = moonIllumination(quarter.sun, quarter.sky.moonDir);
	assert.ok(q > 0.35 && q < 0.65, `kwadra ${q}`);
});

test('sfera niebieska: obrót ortonormalny, biegun świata na wysokości równej szerokości geograficznej', () => {
	const m = equatorialToScene(localSiderealTime(daysSinceJ2000(2026, 180, 0), LON), LAT);
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
		const dotij = m[i][0] * m[j][0] + m[i][1] * m[j][1] + m[i][2] * m[j][2];
		assert.ok(Math.abs(dotij - (i === j ? 1 : 0)) < 1e-9);
	}
	// biegun (0, 0, 1) w układzie równikowym → w scenie: na północ (−z) i w górę o 53,6°
	const pole = [m[0][2], m[1][2], m[2][2]];
	assert.ok(Math.abs(Math.asin(pole[1]) * 180 / Math.PI - LAT) < 1e-6);
	assert.ok(pole[2] < 0 && Math.abs(pole[0]) < 1e-9);
});

test('pełnia wschodzi wieczorem na południowym wschodzie, zachodzi rano na południowym zachodzie', () => {
	const evening = at(6, 29, 19.5).sky.moonDir, morning = at(6, 30, 2.5).sky.moonDir;
	assert.ok(evening[0] > 0 && evening[2] > 0, 'wieczorem na wschodzie i południu');
	assert.ok(morning[0] < 0 && morning[2] > 0, 'rano na zachodzie i południu');
});

test('światła osad: okna najczęściej zapalone wieczorem, najrzadziej nad ranem; latarnie na przemian co odstęp', async () => {
	const { windowsLit, lampPositions } = await import('../src/citylights.js');
	assert.ok(windowsLit(21.5) > 0.4 && windowsLit(4) < 0.1 && windowsLit(12) <= 0.12);
	const lamps = lampPositions([0, 0, 340, 0], 34, 4);
	assert.equal(lamps.length, 10);
	assert.ok(lamps.every(([, z], i) => z === (i % 2 ? -4 : 4)));
});
