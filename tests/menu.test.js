import test from 'node:test';
import assert from 'node:assert/strict';
import { describePosition, headingDeg, PLACES, TIMES, SEASONS, WEATHER, DEFAULT_PLAN, load } from '../src/ui/places.js';

const places = [{ name: 'Tuchola', gen: 'Tucholi', instr: 'Tucholą', x: 0, z: 0 }, { name: 'Chojnice', gen: 'Chojnic', instr: 'Chojnicami', x: -20000, z: -10000 }];

test('opis położenia: „nad” blisko miejsca, inaczej odległość i kierunek od najbliższego', () => {
	assert.equal(describePosition(500, -300, places), 'nad Tucholą');
	assert.equal(describePosition(-4243, -4243, places), '6 km na płn.-zach. od Tucholi');
	assert.equal(describePosition(0, 5000, places), '5 km na płd. od Tucholi');
	assert.equal(describePosition(-19000, -14000, places), '4 km na płn. od Chojnic');
});

test('kurs w stopniach, plan domyślny wskazuje istniejące pozycje list', () => {
	assert.equal(headingDeg(0), 0);
	assert.equal(headingDeg(Math.PI / 2), 90);
	assert.equal(headingDeg(-Math.PI / 2), 270);
	assert.ok(PLACES.some((p) => p.id === DEFAULT_PLAN.place));
	assert.ok(TIMES.some((p) => p.id === DEFAULT_PLAN.time));
	assert.ok(SEASONS.some((p) => p.id === DEFAULT_PLAN.season));
	assert.ok(WEATHER.some((p) => p.id === DEFAULT_PLAN.weather));
	for (const p of PLACES) assert.ok(p.gen && p.instr, `odmiana dla ${p.name}`);
});

test('pamięć niedostępna (Node, tryb prywatny) – wartości domyślne zamiast błędu', () => {
	assert.deepEqual(load('settings', { a: 1 }), { a: 1 });
});

test('„Co nowego”: wersje od bieżącej do 0.1, bieżąca zgodna z numerem w grze i z CHANGELOG.md', async () => {
	const { readFileSync } = await import('node:fs');
	const src = readFileSync(new URL('../src/ui/menu.js', import.meta.url), 'utf8');
	const versions = [...src.matchAll(/\{ v: '(\d+\.\d+)'/g)].map((m) => m[1]);
	assert.deepEqual(versions, ['0.9', '0.8', '0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.1']);
	assert.ok(src.includes(`'PROTOTYP ${versions[0]}'`));
	const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
	assert.deepEqual([...log.matchAll(/^## (\d+\.\d+)/gm)].map((m) => m[1]), versions);
});
