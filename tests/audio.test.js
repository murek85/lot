import test from 'node:test';
import assert from 'node:assert/strict';
import { SOUND, engineFreqs, layerLevels, masterGain, stallAmount } from '../src/audio/mix.js';
import { DROMADER, EXTRA } from '../src/plane/flight.js';
import { AIRCRAFT } from '../src/plane/aircraft.js';

const base = { rpm: DROMADER.rpm[1], throttle: 1, speed: 60, onGround: false, crashed: false, stall: 0, view: 'chase', distance: 120, P: DROMADER };

test('dźwięk: brzmienie dla każdego samolotu, częstotliwości z obrotów', () => {
	for (const id of Object.keys(AIRCRAFT)) assert.ok(SOUND[id], `brzmienie ${id}`);
	// Dromader: śmigło 2300/min, reduktor 1,57 → wał ~3600/min, 9 cylindrów → ~270 Hz zapłonów; 3 łopaty → 115 Hz
	const f = engineFreqs(2300, SOUND.dromader);
	assert.ok(Math.abs(f.firing - 270.9) < 1, `${f.firing}`);
	assert.ok(Math.abs(f.blade - 115) < 0.1);
	// ton rośnie z obrotami: Extra (6 cylindrów, bez reduktora) – 40 Hz na jałowym, 135 Hz przy pełnym gazie
	assert.ok(Math.abs(engineFreqs(2700, SOUND.extra).firing - 135) < 0.1);
	assert.ok(Math.abs(engineFreqs(800, SOUND.extra).firing - 40) < 0.1);
});

test('dźwięk: poziomy warstw – gaz, prędkość, widok, odległość, kraksa, przeciągnięcie', () => {
	const full = layerLevels(base), idle = layerLevels({ ...base, throttle: 0, rpm: DROMADER.rpm[0] });
	assert.ok(full.engine > idle.engine && full.exhaust > idle.exhaust && full.prop > idle.prop);
	assert.ok(layerLevels({ ...base, distance: 600 }).engine < full.engine * 0.3, 'z daleka ciszej');
	assert.ok(layerLevels({ ...base, view: 'cockpit' }).engine > full.engine, 'w kabinie głośniej');
	assert.ok(layerLevels({ ...base, speed: 90 }).wind > layerLevels({ ...base, speed: 40 }).wind);
	const crash = layerLevels({ ...base, crashed: true, rpm: 0 });
	assert.equal(crash.engine, 0);
	assert.equal(crash.wind, 0);
	assert.equal(layerLevels({ ...base, stall: stallAmount(31, DROMADER) }).stall > 0, true);
	assert.equal(layerLevels({ ...base, stall: 1, view: 'menu' }).stall, 0, 'brzęczyk nie w menu');
	assert.ok(layerLevels({ ...base, onGround: true, speed: 20 }).ground > 0);
	assert.equal(layerLevels({ ...base, P: EXTRA, rpm: EXTRA.rpm[1] }).engine > 0, true);
	for (const v of Object.values(full)) assert.ok(Number.isFinite(v));
});

test('dźwięk: głośność główna – wyciszenie, wczytywanie, przygaszenie na pauzie', () => {
	assert.equal(masterGain(0.8, true, 'flying'), 0);
	assert.equal(masterGain(0.8, false, 'loading'), 0);
	assert.ok(masterGain(0.8, false, 'paused') < masterGain(0.8, false, 'flying'));
	assert.ok(Math.abs(masterGain(1, false, 'menu') - 1) < 1e-9);
});
