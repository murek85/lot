import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlight, stepFlight, propRpm, DROMADER } from '../src/plane/flight.js';
import { airfoil, profileSection } from '../src/plane/geo.js';

const flat = () => 100;
const run = (s, input, seconds, ground = flat) => {
	let ev = null;
	for (let t = 0; t < seconds; t += 1 / 60) ev = stepFlight(s, input, 1 / 60, ground) || ev;
	return ev;
};
const idle = { roll: 0, pitch: 0, throttle: 0 };

test('lot poziomy: kurs i wysokość stałe, prędkość dąży do przelotowej', () => {
	const s = createFlight({ y: 600, heading: 1 });
	run(s, idle, 20);
	assert.ok(Math.abs(s.heading - 1) < 1e-6);
	assert.ok(Math.abs(s.y - 600) < 1);
	assert.ok(s.speed > DROMADER.minSpeed && s.speed < DROMADER.maxSpeed);
});

test('przechył w prawo skręca w prawo (kurs rośnie), zakręt skoordynowany', () => {
	const s = createFlight({ y: 800, heading: 0 });
	run(s, { roll: 1, pitch: 0, throttle: 0 }, 3);
	assert.ok(s.bank > 0.9);
	assert.ok(s.heading > 0.2 && s.heading < Math.PI);
	const omega = (9.81 * Math.tan(s.bank)) / s.speed;
	assert.ok(omega > 0.15 && omega < 0.5, `prędkość kątowa ${omega}`);
});

test('puszczone lotki – samolot sam się poziomuje', () => {
	const s = createFlight({ y: 800, bank: 0.8 });
	run(s, idle, 2);
	assert.ok(Math.abs(s.bank) < 0.05);
});

test('wznoszenie kosztuje prędkość, nurkowanie ją daje', () => {
	const up = createFlight({ y: 500 }), down = createFlight({ y: 2000 });
	run(up, { roll: 0, pitch: 1, throttle: 0 }, 6);
	run(down, { roll: 0, pitch: -1, throttle: 0 }, 6);
	assert.ok(up.y > 570 && up.speed < DROMADER.cruise);
	assert.ok(down.y < 1900 && down.speed > DROMADER.cruise);
});

test('za wolno – nos opada (przeciągnięcie), a po nabraniu prędkości samolot z niego wychodzi', () => {
	const s = createFlight({ y: 1500, speed: 31, throttle: 0 });
	let minGamma = 1;
	for (let t = 0; t < 4; t += 1 / 60) {
		stepFlight(s, { roll: 0, pitch: 1, throttle: 0 }, 1 / 60, flat);
		minGamma = Math.min(minGamma, s.gamma);
	}
	assert.ok(minGamma < -0.05, `najmniejszy kąt ścieżki ${minGamma}`);
	assert.ok(s.speed > 33);
});

test('łagodne przyziemienie i kraksa przy stromym zderzeniu', () => {
	const soft = createFlight({ y: 103, gamma: -0.02, speed: 40 });
	assert.equal(run(soft, { roll: 0, pitch: -0.15, throttle: 0 }, 3), 'touchdown');
	assert.ok(soft.onGround && !soft.crashed);
	const hard = createFlight({ y: 200, gamma: -0.5, speed: 70 });
	assert.equal(run(hard, { roll: 0, pitch: -1, throttle: 0 }, 5), 'crash');
	assert.ok(hard.crashed);
	assert.equal(propRpm(hard), 0);
});

test('gaz w granicach 0..1', () => {
	const s = createFlight();
	run(s, { roll: 0, pitch: 0, throttle: 1 }, 5);
	assert.equal(s.throttle, 1);
	run(s, { roll: 0, pitch: 0, throttle: -1 }, 5);
	assert.equal(s.throttle, 0);
});

test('profil skrzydła: zamknięty obrys, grubość ~15% cięciwy', () => {
	const pts = profileSection(airfoil(24, 0.15), 0, 1);
	const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
	assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 1);
	const t = Math.max(...ys) - Math.min(...ys);
	assert.ok(t > 0.13 && t < 0.2, `grubość ${t}`);
});

test('część profilu (lotka): obrys tylko między zadanymi ułamkami cięciwy', () => {
	const pts = profileSection(airfoil(24, 0.15), 0.765, 1);
	assert.ok(pts.every(([x]) => x >= 0.765 - 1e-9 && x <= 1 + 1e-9));
	assert.ok(pts.length > 6);
});

test('stroboskop: dwa krótkie błyski na okres, błyskacz: impuls raz na okres', async () => {
	const { strobeAt, beaconAt } = await import('../src/plane/lights.js');
	let flashes = 0, prev = 0;
	for (let t = 0; t < 1.1; t += 0.005) { const v = strobeAt(t); if (v && !prev) flashes++; prev = v; }
	assert.equal(flashes, 2);
	assert.ok(beaconAt(0.108) > 0.9 && beaconAt(0.5) < 0.01);
});

test('Extra 330: pełna beczka przy trzymanych lotkach, po puszczeniu w pobliżu poziomu wraca do poziomu', async () => {
	const { createFlight, stepFlight, EXTRA } = await import('../src/plane/flight.js');
	const s = createFlight({ y: 1000, speed: 70, heading: 0 });
	let turned = 0, prev = 0;
	for (let i = 0; i < 160; i++) { // 1,6 s × 300°/s ≈ 480°
		stepFlight(s, { roll: 1, pitch: 0, throttle: 0 }, 0.01, () => 0, EXTRA);
		let d = s.bank - prev; d = Math.atan2(Math.sin(d), Math.cos(d));
		turned += d; prev = s.bank;
	}
	assert.ok(turned > 2 * Math.PI, `obrót ${turned}`);
	// puszczone po ~120° nadmiaru – przechył zostaje (lot nożowy/na plecach), aż pilot sam wyprowadzi
	for (let i = 0; i < 200 && Math.abs(s.bank) > 0.9; i++) stepFlight(s, { roll: 1, pitch: 0, throttle: 0 }, 0.01, () => 0, EXTRA);
	for (let i = 0; i < 300; i++) stepFlight(s, { roll: 0, pitch: 0, throttle: 0 }, 0.01, () => 0, EXTRA);
	assert.ok(Math.abs(s.bank) < 0.05, `poziom ${s.bank}`);
	assert.ok(Number.isFinite(s.heading) && Number.isFinite(s.turnRate));
});

test('Wilga leci wolniej niż Dromader, zanim przeciągnie', async () => {
	const { createFlight, stepFlight, WILGA, DROMADER } = await import('../src/plane/flight.js');
	const slow = (P) => {
		const s = createFlight({ y: 1000, speed: P.cruise, throttle: 0 });
		for (let i = 0; i < 3000; i++) stepFlight(s, { roll: 0, pitch: 0.4, throttle: -1 }, 0.02, () => 0, P);
		return s.speed;
	};
	assert.ok(slow(WILGA) < slow(DROMADER) - 8);
});

test('hangar: każda maszyna ma spójne parametry lotu, akrobacyjne – prędkość beczki', async () => {
	const { AIRCRAFT } = await import('../src/plane/aircraft.js');
	for (const a of Object.values(AIRCRAFT)) {
		const P = a.flight;
		assert.ok(P.minSpeed < P.cruise && P.cruise < P.maxSpeed && P.maxSpeed < P.vne, a.id);
		assert.ok(P.rpm[0] < P.rpm[1] && P.gearHeight > 1, a.id);
		if (P.aerobatic) assert.ok(P.rollRate > 1, a.id);
	}
});

test('An-2 leci najwolniej w hangarze, Orlik najszybciej', async () => {
	const { AIRCRAFT } = await import('../src/plane/aircraft.js');
	const all = Object.values(AIRCRAFT).map((a) => a.flight);
	assert.equal(Math.min(...all.map((P) => P.minSpeed)), AIRCRAFT.an2.flight.minSpeed);
	assert.equal(Math.max(...all.map((P) => P.maxSpeed)), AIRCRAFT.orlik.flight.maxSpeed);
});
