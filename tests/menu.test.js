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
	assert.deepEqual(versions, ['0.32', '0.31', '0.30', '0.29', '0.28', '0.27', '0.26', '0.25', '0.24', '0.23', '0.22', '0.21', '0.20', '0.19', '0.18', '0.17', '0.16', '0.15', '0.14', '0.13', '0.12', '0.11', '0.10', '0.9', '0.8', '0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.1']);
	assert.ok(src.includes(`'PROTOTYP ${versions[0]}'`));
	const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
	assert.deepEqual([...log.matchAll(/^## (\d+\.\d+)/gm)].map((m) => m[1]), versions);
});

test('zegar: upływ z tempem, przez północ do następnego dnia, po 31 grudnia – 1 stycznia', async () => {
	const { advanceClock, TIME_SPEEDS, DEFAULT_PLAN } = await import('../src/ui/places.js');
	assert.deepEqual(advanceClock(12, 100, 60, 0), { hour: 12, day: 100 });
	assert.ok(Math.abs(advanceClock(12, 100, 3600, 1).hour - 13) < 1e-9);
	assert.ok(Math.abs(advanceClock(12, 100, 60, 60).hour - 13) < 1e-9, '×60: minuta = godzina');
	const c = advanceClock(23.5, 100, 3600, 1);
	assert.ok(Math.abs(c.hour - 0.5) < 1e-9 && c.day === 101);
	assert.equal(advanceClock(23.9, 365, 3600, 1).day, 1);
	assert.ok(TIME_SPEEDS.some((s) => s.id === DEFAULT_PLAN.timeSpeed));
	assert.deepEqual(TIME_SPEEDS.map((s) => s.rate), [0, 1, 10, 60]);
});

test('nawigacja: współrzędne, wiatr względem samolotu, granica mapy, opis położenia z dzielnicą', async () => {
	const { formatLatLon, relativeWind, edgeWarning } = await import('../src/ui/nav.js');
	const { describePosition: dp } = await import('../src/ui/places.js');
	assert.equal(formatLatLon(50.3249, 18.7857), '50°19′ N 18°47′ E');
	// lot na północ (kurs 0), wiatr wieje na południe (z północy) – czołowy
	assert.ok(relativeWind(0, 10, 0).text.includes('czołowy'));
	assert.ok(relativeWind(0, -10, 0).text.includes('w ogon'));
	assert.ok(relativeWind(-10, 0, 0).text.includes('z prawej'), 'wieje na zachód = z prawej przy kursie na północ');
	assert.equal(relativeWind(0, 0, 1).text, 'cisza');
	assert.equal(edgeWarning(0, 0, 23000), null);
	const e = edgeWarning(21500, 0, 23000);
	assert.ok(e && e.text.includes('1,5 km') && e.deg === 270, e?.text);
	assert.ok(edgeWarning(24000, 0, 23000).text.startsWith('Poza mapą'));
	const pl = [
		{ name: 'Zabrze', gen: 'Zabrza', instr: 'Zabrzem', cls: 'city', x: 0, z: 0 },
		{ name: 'Biskupice', cls: 'suburb', x: 1500, z: -800 },
		{ name: 'Kopienice', cls: 'hamlet', x: 9000, z: 0 },
	];
	assert.equal(dp(1400, -700, pl), 'nad Zabrzem · Biskupice');
	assert.equal(dp(200, 300, pl), 'nad Zabrzem');
	assert.equal(dp(9100, 50, pl), 'nad miejscowością Kopienice');
	assert.equal(dp(0, -7000, pl), '7 km na płn. od Zabrza', 'odniesienie do miasta, nie bliższego przysiółka');
});

test('minimapa: przeliczenie świat → mapa, północ u góry i kurs u góry, skale', async () => {
	const { worldToMap, SCALES } = await import('../src/ui/minimap.js');
	const near = (a, b) => assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${a} ≠ ${b}`);
	// punkt 100 m na północ od samolotu, 1 px/m
	near(worldToMap(0, -100, 0, 0, 1, false, 0), [0, -100]);
	// kurs na wschód, kurs u góry: punkt na wschodzie jest „przed” samolotem – u góry
	near(worldToMap(100, 0, 0, 0, 1, true, Math.PI / 2), [0, -100]);
	// a punkt na północy – po lewej
	near(worldToMap(0, -100, 0, 0, 1, true, Math.PI / 2), [-100, 0]);
	assert.deepEqual(SCALES.map((s) => s.km), [2, 5, 15]);
});

test('cel lotu: odległość, kurs do celu, skręt, czas dolotu', async () => {
	const { targetInfo } = await import('../src/ui/nav.js');
	// cel 10 km na wschód, lecimy na północ z 50 m/s
	const t = targetInfo(0, 0, 0, 50, 10000, 0);
	assert.ok(Math.abs(t.bearing - 90) < 1e-9 && Math.abs(t.turn - 90) < 1e-9 && Math.abs(t.eta - 200) < 1e-9);
	assert.ok(t.text.startsWith('10 km · 3 min · skręć 90° w prawo'), t.text);
	assert.ok(targetInfo(0, 0, 0, 50, 0, -5000).text.includes('na kursie'));
	assert.ok(targetInfo(0, 0, 0, 50, -3000, 0).text.includes('w lewo'));
	assert.ok(targetInfo(0, 0, 0, 50, 100, 100).text.includes('nad celem'));
});
