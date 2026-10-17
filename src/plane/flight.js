// Arcade'owy model lotu: przechył wyznacza skręt (zakręt skoordynowany), wznoszenie kosztuje prędkość,
// nurkowanie ją daje, za wolno – przeciągnięcie i opadanie nosa. Bez fizyki sił, ale z „czuciem” maszyny.
// Kurs 0 = północ (−z), rośnie zgodnie z ruchem wskazówek zegara (90° = wschód). Jednostki: m, s, rad.

export const DROMADER = {
	minSpeed: 30, // przeciągnięcie (~110 km/h)
	cruise: 55, // ~200 km/h
	maxSpeed: 72, // ~260 km/h przy pełnym gazie w poziomie
	vne: 95, // w nurkowaniu
	maxBank: 1.05, // 60°
	bankRate: 1.9,
	maxClimb: 0.32, // kąt ścieżki ~18°
	pitchRate: 0.55,
	throttleRate: 0.5,
	gearHeight: 1.75, // od kół do środka kadłuba
	rpm: [700, 2300], // obroty śmigła: jałowe – pełny gaz
	accel: 0.25, // jak szybko prędkość dąży do docelowej
};

/** PZL-104 Wilga 35: górnopłat STOL – bardzo wolny, łagodny, krótki start, mała prędkość przeciągnięcia. */
export const WILGA = {
	minSpeed: 17, // ~60 km/h (sloty i klapy)
	cruise: 44, // ~160 km/h
	maxSpeed: 53, // ~190 km/h
	vne: 76,
	maxBank: 1.0,
	bankRate: 1.5,
	maxClimb: 0.4, // stromo pod górę
	pitchRate: 0.6,
	throttleRate: 0.5,
	gearHeight: 1.66,
	rpm: [650, 2350],
	accel: 0.3,
};

/** Extra 330LX: samolot akrobacyjny – szybki, zwinny, pełne beczki (aerobatic: przechył bez ograniczeń). */
export const EXTRA = {
	minSpeed: 31, // ~110 km/h
	cruise: 72, // ~260 km/h
	maxSpeed: 96, // ~345 km/h
	vne: 113, // ~407 km/h
	maxBank: 1.45,
	bankRate: 3.2, // poziomowanie po puszczeniu lotek
	rollRate: 5.2, // ~300°/s
	aerobatic: true,
	maxClimb: 0.8,
	pitchRate: 1.3,
	throttleRate: 0.8,
	gearHeight: 1.29,
	rpm: [800, 2700],
	accel: 0.38,
};

export function createFlight(start = {}) {
	return {
		x: 0, y: 500, z: 0,
		heading: 0, // kurs
		gamma: 0, // kąt ścieżki (+ w górę)
		bank: 0, // przechył (+ prawe skrzydło w dół)
		speed: DROMADER.cruise,
		throttle: 0.6,
		alpha: 0.05, // kąt natarcia (tylko do wyglądu)
		onGround: false,
		crashed: false,
		...start,
	};
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, rate, dt) => v + clamp(target - v, -rate * dt, rate * dt);

/**
 * Krok symulacji. input: { roll: -1..1, pitch: -1..1 (+ = w górę), throttle: -1..1 (zmiana gazu) }.
 * groundAt(x, z) – wysokość terenu. Zwraca zdarzenie: null | 'touchdown' | 'crash'.
 */
export function stepFlight(s, input, dt, groundAt, P = DROMADER) {
	if (s.crashed) return null;
	s.throttle = clamp(s.throttle + input.throttle * P.throttleRate * dt, 0, 1);

	// przechył: wychylenie lotek ustala docelowy przechył, puszczone – samolot sam się poziomuje. Akrobacyjny:
	// lotki obracają samolot ze stałą prędkością bez ograniczeń (beczka), puszczone – trzyma przechył, a blisko
	// poziomu sam się wyrównuje
	if (P.aerobatic) {
		if (input.roll) s.bank += input.roll * P.rollRate * dt;
		const b = Math.atan2(Math.sin(s.bank), Math.cos(s.bank));
		s.bank = !input.roll && Math.abs(b) < 1.2 ? approach(b, 0, P.bankRate * 0.5, dt) : b;
	} else {
		s.bank = approach(s.bank, input.roll * P.maxBank, P.bankRate, dt);
	}
	const cb = Math.cos(s.bank);

	// ścieżka lotu: ster wysokości ustala docelowy kąt; przy małej prędkości nos opada (przeciągnięcie)
	const stall = clamp((P.minSpeed + 6 - s.speed) / 8, 0, 1);
	// na plecach ster wysokości działa odwrotnie względem ziemi (ściągnięcie drążka – nos w dół)
	let gammaTarget = input.pitch * P.maxClimb * (1 - 0.8 * stall) * (P.aerobatic ? cb : 1) - stall * 0.5;
	// w zakręcie część siły nośnej idzie w bok – bez ściągnięcia drążka samolot lekko opada (na plecach – wyraźnie)
	gammaTarget -= (1 - cb) * 0.12;
	if (s.onGround) gammaTarget = Math.max(0, gammaTarget);
	s.gamma = approach(s.gamma, gammaTarget, P.pitchRate, dt);

	// prędkość: gaz → prędkość docelowa, grawitacja na wznoszeniu i w nurkowaniu, opór w zakręcie
	const target = P.minSpeed + 6 + (P.maxSpeed - P.minSpeed - 6) * s.throttle;
	const turnDrag = Math.abs(Math.sin(s.bank)) * 2.5;
	s.speed += ((target - s.speed) * (P.accel ?? 0.25) - 9.81 * Math.sin(s.gamma) * 0.85 - turnDrag) * dt;
	s.speed = clamp(s.speed, s.onGround ? 0 : P.minSpeed * 0.75, P.vne);

	// zakręt skoordynowany: ω = g·tg(φ)/v; akrobacyjny – z poziomej składowej siły nośnej (g·sin φ / v),
	// skończony także w przechyle 90° i na plecach
	s.turnRate = s.onGround ? 0 : P.aerobatic
		? (9.81 * Math.sin(s.bank) * 1.15) / Math.max(20, s.speed)
		: (9.81 * Math.tan(s.bank)) / Math.max(20, s.speed);
	s.heading += s.turnRate * dt;
	s.heading = ((s.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

	const h = Math.cos(s.gamma) * s.speed;
	s.x += Math.sin(s.heading) * h * dt;
	s.z -= Math.cos(s.heading) * h * dt;
	s.y += Math.sin(s.gamma) * s.speed * dt;
	s.alpha = 0.04 + stall * 0.12 + Math.max(0, input.pitch) * 0.03;

	// ziemia: łagodne przyziemienie albo kraksa
	const ground = groundAt(s.x, s.z) + P.gearHeight;
	let event = null;
	if (s.y <= ground) {
		const sink = -Math.sin(s.gamma) * s.speed;
		if (!s.onGround && (sink > 4.5 || Math.abs(s.bank) > 0.35)) {
			s.crashed = true;
			event = 'crash';
		} else {
			if (!s.onGround) event = 'touchdown';
			s.onGround = true;
			s.gamma = Math.max(0, s.gamma);
			s.bank = approach(s.bank, 0, 2, dt);
		}
		s.y = ground;
	} else if (s.onGround && s.y > ground + 0.5) {
		s.onGround = false;
	}
	return event;
}

/** Obroty śmigła do animacji (na minutę). */
export const propRpm = (s, P = DROMADER) => (s.crashed ? 0 : P.rpm[0] + (P.rpm[1] - P.rpm[0]) * s.throttle);
