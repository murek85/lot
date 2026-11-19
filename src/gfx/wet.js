// Mokre powierzchnie w deszczu i po nim (drogi, dachy, ziemia): wsiąknięta woda przyciemnia barwę, cienka warstwa
// wody i kałuże odbijają niebo (pod pełnym zachmurzeniem – szare), słońce w prześwitach i latarnie nocą.
import { uniform, float, vec3, max, pow, dot, normalize, reflect, smoothstep, mix, cameraPosition, floor, fract, sin, length, clamp } from 'three/tsl';
import { valueNoise, hash22 } from './noise.js';
import { cityLight } from './ground.js';

/** Zmoczenie 0..1: narasta w deszczu (~20 s), schnie po nim (~2 min) – ustawiane w src/main.js. */
export const wetness = uniform(0);
/** Natężenie padającego deszczu 0..1 (kręgi na wodzie) – ustawia main.js. */
export const rainRate = uniform(0);

/**
 * Kręgi od kropel deszczu na wodzie: nachylenie (vec2) do dodania do fal – komórki 1,6 m, każda w swojej fazie;
 * z daleka (piksel większy niż ~0,8 m) wygaszone. xz – metry (stałe względem Ziemi), t – czas, fp – wielkość piksela.
 */
export function rainRipple(xz, t, fp) {
	const rc = xz.div(1.6), h = hash22(floor(rc)), ph = fract(t.mul(0.9).add(h.x.mul(7)));
	const d = fract(rc).sub(h.mul(0.6).add(0.2)), rd = length(d).mul(1.6), front = ph.mul(1.2);
	const ring = sin(rd.sub(front).mul(18)).mul(float(1).sub(ph)).mul(float(1).sub(smoothstep(front, front.add(0.15), rd)));
	return d.div(max(rd, 0.05)).mul(ring).mul(0.35).mul(rainRate).mul(float(1).sub(smoothstep(0.15, 0.8, fp)));
}

/**
 * Odbicie latarni z brzegu w wodzie: promień odbity R z punktu p sięga wysokości lampy (~7 m) w odległości 7/tg –
 * tam plama światła latarni (src/citylights.js); F – Fresnel.
 */
export function lampReflection(p, R, F) {
	const l = max(1e-3, length(R.xz)), tanR = max(R.y, 0.01).div(l);
	const at = p.add(vec3(R.x, 0, R.z).div(l).mul(clamp(float(7).div(tanR), 0, 400)));
	return cityLight(at).mul(F.mul(4).add(0.15));
}

/** Barwa mokrej powierzchni: porous – jak mocno woda ją przyciemnia (asfalt ~0,45, dachówka ~0,3, ziemia ~0,25). */
export const wetAlbedo = (albedo, porous) => albedo.mul(float(1).sub(wetness.mul(porous)));

/** Kałuże 0..1 w zagłębieniach (plamy szumu) – dopiero przy większym zmoczeniu, rosną z nim. */
export function puddles(xz, scale = 1) {
	const n = valueNoise(xz.div(6 * scale)).mul(0.7).add(valueNoise(xz.div(1.8 * scale)).mul(0.3));
	return smoothstep(0.68, 0.74, n.add(wetness.mul(0.1))).mul(smoothstep(0.35, 0.8, wetness));
}

/**
 * Połysk mokrej powierzchni (do dodania do koloru): odbicie nieba z Fresnelem, odblask słońca (sunVis – cienie),
 * odbicie świateł (lights – natężenie latarni przy powierzchni; na mokrym rozlewa się szerzej). gloss 0..1:
 * cienka warstwa ~0,4, kałuża 1. wet – zmoczenie (domyślnie z pogody; zimą np. solone jezdnie).
 */
export function wetSheen(atmo, clouds, p, N, gloss, sunVis, lights, wet = wetness) {
	const V = normalize(cameraPosition.sub(p));
	const R = reflect(V.negate(), N);
	const nv = max(dot(N, V), 0.02);
	const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(nv), 5)));
	// niebo: pod pełnym zachmurzeniem szare (jasność światła nieba), w prześwitach – błękit
	const skyE = atmo.skyIrradiance();
	const grey = vec3(dot(skyE, vec3(0.2126, 0.7152, 0.0722))).div(Math.PI).mul(0.9);
	const sky = mix(atmo.skyRadiance(vec3(R.x, max(0.01, R.y), R.z)), grey, smoothstep(0.5, 0.9, clouds.u.coverage));
	const H = normalize(atmo.u.lightDir.add(V));
	const glint = pow(max(0, dot(N, H)), mix(float(60), float(500), gloss)).mul(mix(float(1.5), float(25), gloss)).mul(sunVis);
	return sky.mul(F).add(atmo.sunLight(p.y).mul(glint).mul(F)).add(lights.mul(F.mul(1.2).add(0.03))).mul(gloss.mul(wet));
}
