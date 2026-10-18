// Mikser dźwięku gry – sama matematyka (bez Web Audio, testowana w Node): częstotliwości silnika i śmigła z obrotów,
// poziomy warstw (silnik, wydech, śmigło, wiatr, toczenie po ziemi, ostrzeżenie o przeciągnięciu) z widoku,
// odległości kamery i ustawień głośności.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Brzmienie silnika samolotu: cyl – liczba cylindrów (zapłony na obrót wału = cyl/2 dla silnika czterosuwowego),
 * gear – przełożenie śmigło/wał (obroty w grze to obroty śmigła), blades – łopaty śmigła, rough – nierówność pracy
 * (gwiazdowy „kołysze”), bright – jasność wydechu (0 – basowy pomruk, 1 – ostry), body – waga dołu pasma.
 */
export const SOUND = {
	dromader: { cyl: 9, gear: 1.57, blades: 3, rough: 0.55, bright: 0.25, body: 1.0 }, // PZL ASz-62IR, 1000 KM, reduktor
	wilga: { cyl: 9, gear: 1.0, blades: 2, rough: 0.45, bright: 0.45, body: 0.75 }, // AI-14R, 260 KM
	extra: { cyl: 6, gear: 1.0, blades: 3, rough: 0.2, bright: 0.85, body: 0.65 }, // Lycoming AEIO-580, 315 KM
};

/** Częstotliwości z obrotów śmigła: zapłony (ton silnika), obrót wału (kołysanie) i przejście łopat. */
export function engineFreqs(rpm, snd) {
	const crank = (rpm * snd.gear) / 60; // obroty wału na sekundę
	return { firing: (crank * snd.cyl) / 2, crank, blade: (rpm / 60) * snd.blades };
}

/** Siła przeciągnięcia 0…1 – jak w modelu lotu (src/plane/flight.js). */
export const stallAmount = (speed, P) => clamp((P.minSpeed + 6 - speed) / 8, 0, 1);

/**
 * Poziomy warstw dźwięku (liniowe 0…1, przed głośnością główną) i barwa. s: { rpm, throttle, speed, onGround,
 * crashed, stall, view: 'menu' | 'chase' | 'cockpit' | 'free', distance (m od kamery), P (parametry lotu) }.
 * vol: { engine, ambient } z ustawień.
 */
export function layerLevels(s, vol = { engine: 1, ambient: 1 }) {
	const P = s.P;
	const rpmN = clamp((s.rpm - P.rpm[0] * 0.5) / (P.rpm[1] - P.rpm[0] * 0.5), 0, 1); // 0 jałowe … 1 pełne
	const run = s.rpm > 120 ? clamp(s.rpm / P.rpm[0], 0, 1) : 0; // silnik pracuje (wybieg po kraksie wygasa)
	const cockpit = s.view === 'cockpit';
	// odległość: w kabinie – blisko i głośno; z zewnątrz – spadek z odległością (łagodniejszy niż 1/r – gra
	// zręcznościowa: samolot zawsze słychać) i tłumienie wysokich tonów w powietrzu
	const d = cockpit ? 3 : Math.max(8, s.distance);
	const near = cockpit ? 1 : clamp(Math.pow(30 / d, 0.75), 0.08, 1);
	const air = cockpit ? 1 : clamp(Math.pow(40 / d, 0.5), 0.12, 1);
	const menu = s.view === 'menu' ? 0.55 : 1;
	const speedN = clamp(s.speed / P.vne, 0, 1.2);
	return {
		engine: run * (0.45 + 0.55 * s.throttle) * near * menu * vol.engine * (cockpit ? 1 : 0.9),
		exhaust: run * (0.15 + 0.85 * s.throttle * s.throttle) * near * menu * vol.engine * (cockpit ? 0.55 : 1),
		prop: run * rpmN * rpmN * near * menu * vol.engine * (cockpit ? 0.6 : 1),
		wind: (s.crashed ? 0 : Math.pow(speedN, 2.2)) * (cockpit ? 0.9 : 0.55 * air) * menu * vol.ambient,
		ground: s.onGround && !s.crashed ? clamp(s.speed / 25, 0, 1) * near * vol.ambient : 0,
		stall: s.view !== 'menu' && s.game !== 'paused' && !s.onGround && !s.crashed && s.stall > 0.2 ? (cockpit ? 0.5 : 0.22) * vol.engine : 0,
		// barwa: filtr silnika otwiera się z gazem; z zewnątrz – tłumienie powietrza, w kabinie – kabina dławi górę
		engineCutoff: (380 + 2600 * s.throttle) * (cockpit ? 0.7 : air),
		windCutoff: 250 + 2200 * speedN * (cockpit ? 0.8 : 1),
	};
}

/** Głośność główna: ustawienie (krzywa kwadratowa – suwak brzmi liniowo), wyciszenie i stan gry. */
export function masterGain(volume, muted, game) {
	if (muted || game === 'loading') return 0;
	return volume * volume * (game === 'paused' ? 0.35 : 1);
}
