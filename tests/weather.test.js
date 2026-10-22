import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER, WINDS, effectiveWind, windVector, windFrom, turbulence, lightning, flashAt, rng } from '../src/weather/weather.js';

test('pogoda: opady i burza mają parametry, wiatr rośnie z wyborem', () => {
	for (const id of ['rain', 'snow', 'storm']) assert.ok(WEATHER.find((w) => w.id === id)?.precip, id);
	assert.equal(WEATHER.find((w) => w.id === 'snow').precip.type, 'snow');
	assert.ok(WEATHER.find((w) => w.id === 'storm').storm);
	for (let i = 1; i < WINDS.length; i++) assert.ok(WINDS[i].speed > WINDS[i - 1].speed);
	// burza podnosi słaby wiatr do silnego, wichury nie zmniejsza
	assert.equal(effectiveWind('storm', 'calm').id, 'strong');
	assert.equal(effectiveWind('storm', 'gale').id, 'gale');
	assert.equal(effectiveWind('clear', 'calm').id, 'calm');
});

test('wiatr: z zachodu, porywy w granicach ±25%, kierunek słownie', () => {
	for (let t = 0; t < 600; t += 7.3) {
		const w = windVector(15, t);
		assert.ok(w.x > 0, 'wieje na wschód');
		assert.ok(w.speed > 15 * 0.74 && w.speed < 15 * 1.26, `${w.speed}`);
	}
	assert.equal(windVector(0, 10).speed, 0);
	assert.equal(windFrom(10, 0), 'zachodu');
	assert.equal(windFrom(0, 10), 'północy');
});

test('turbulencja: gładka, rośnie z wiatrem, w burzy mocniej, bez wiatru brak', () => {
	assert.equal(turbulence(5, 0).strength, 0);
	assert.ok(turbulence(5, 23).strength > turbulence(5, 9).strength);
	assert.ok(turbulence(5, 15, true).strength > turbulence(5, 15).strength);
	// między klatkami (1/60 s) zmienia się nieznacznie – brak drgań z częstotliwością klatek
	const a = turbulence(10, 15), b = turbulence(10 + 1 / 60, 15);
	assert.ok(Math.abs(a.roll - b.roll) < 0.05 && Math.abs(a.lift - b.lift) < 0.05);
});

test('błyskawice: odstępy 4–14 s, odległość 1,5–12 km, grzmot z prędkością dźwięku, błysk wygasa', () => {
	const sch = lightning(rng(7));
	const hits = [];
	for (let t = 0; t < 300; t += 0.05) { const e = sch.next(0.05); if (e) hits.push({ t, ...e }); }
	assert.ok(hits.length > 15 && hits.length < 80, `${hits.length}`);
	for (let i = 1; i < hits.length; i++) assert.ok(hits[i].t - hits[i - 1].t >= 3.9);
	for (const h of hits) {
		assert.ok(h.distance >= 1500 && h.distance <= 12000);
		assert.ok(Math.abs(h.delay - h.distance / 340) < 1e-9);
	}
	assert.ok(flashAt(0.01, [0], 2000) > 0.8);
	assert.ok(flashAt(0.5, [0], 2000) < 0.01);
	assert.ok(flashAt(0.01, [0], 10000) < flashAt(0.01, [0], 2000), 'daleka błyskawica słabiej');
});

test('pory roku: barwy upraw, trawy i liści', async () => {
	const { SEASON_PALETTE, seasonPalette } = await import('../src/weather/seasons.js');
	const { SEASONS } = await import('../src/ui/places.js');
	const keys = ['rapeseed', 'cereal', 'wheat', 'ripening', 'maize', 'soil'];
	for (const s of SEASONS) {
		const p = SEASON_PALETTE[s.id];
		assert.ok(p, s.id);
		for (const k of keys) assert.ok(p.crops[k].length === 3 && p.crops[k].every((v) => v >= 0 && v < 0.5), `${s.id} ${k}`);
		assert.ok(p.autumn >= 0 && p.autumn <= 1);
	}
	assert.equal(seasonPalette('nieznana'), SEASON_PALETTE.summer);
	// wiosną kwitnący rzepak jaśniejszy i bardziej żółty niż latem; jesienią ścierniska jaśniejsze od młodych zbóż
	assert.ok(SEASON_PALETTE.spring.crops.rapeseed[0] > SEASON_PALETTE.summer.crops.rapeseed[0] * 1.5);
	assert.ok(SEASON_PALETTE.autumn.crops.cereal[0] > SEASON_PALETTE.summer.crops.cereal[0]);
	assert.ok(SEASON_PALETTE.autumn.autumn > 0 && SEASON_PALETTE.summer.autumn === 0);
	// bele słomy na ścierniskach jesienią, siano latem, fale wiatru tylko na rosnących zbożach (wiosna, lato)
	assert.equal(SEASON_PALETTE.autumn.balesStubble, 1);
	assert.ok(SEASON_PALETTE.summer.balesHay > 0 && SEASON_PALETTE.summer.balesStubble === 0);
	assert.ok(SEASON_PALETTE.spring.waves > 0 && SEASON_PALETTE.summer.waves > 0 && SEASON_PALETTE.autumn.waves === 0 && SEASON_PALETTE.winter.waves === 0);
});

test('poranna mgła w dolinach: świt przy ciszy, jesienią najwięcej, wiatr i deszcz ją rozwiewają', async () => {
	const { valleyFog } = await import('../src/weather/weather.js');
	assert.equal(valleyFog(13, 'autumn', 0, 'clear'), 0); // w południe nie ma
	assert.equal(valleyFog(2, 'autumn', 0, 'clear'), 0); // w nocy przed świtem nie ma
	assert.ok(valleyFog(6.5, 'autumn', 0, 'clear') > 0.9);
	assert.ok(valleyFog(6.5, 'summer', 0, 'clear') < valleyFog(6.5, 'autumn', 0, 'clear'));
	assert.ok(valleyFog(6.5, 'autumn', 9, 'clear') < 0.05); // silny wiatr
	assert.equal(valleyFog(6.5, 'autumn', 0, 'storm'), 0);
	assert.ok(valleyFog(9, 'autumn', 0, 'clear') < valleyFog(7, 'autumn', 0, 'clear')); // rozwiewa się z nagrzewaniem
});
