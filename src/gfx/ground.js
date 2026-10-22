// Wspólne przekształcenie obiektów stojących na ziemi (drogi, tory, budynki, mosty, słupy, aleje): przesunięcie
// o tyle, o ile przewyższenie rzeźby (suwak) podniosło teren w tym miejscu – sam obiekt zachowuje wysokość – oraz
// krzywizna Ziemi względem kamery. Dzięki temu obiekty nie odrywają się od terenu przy zmianie przewyższenia.
import { vec3, dot, texture, uniform } from 'three/tsl';
import { Vector2, Color } from 'three/webgpu';
import { seasonPalette } from '../weather/seasons.js';

/**
 * Przesunięcie początku układu (otwarty świat, m): dodawane do współrzędnych wzorów proceduralnych (pola, drzewostany,
 * rozmieszczenie drzew, szumy nawierzchni), żeby po przesunięciu początku krajobraz wyglądał tak samo. W regionach 0.
 */
export const worldOffset = uniform(new Vector2());

/** Śnieg na ziemi 0..1 (pogoda „Śnieg”) – teren i korony drzew bieleją. */
export const snowCover = uniform(0);

/** Drzewa liściaste bez liści 0..1 (zima) – korony szarobrązowe z gałęzi, sosny bez zmian. */
export const bareTrees = uniform(0);

/** Kolor bezlistnej korony (gałązki) – zbliżony jasnością do liściastej, żeby las nie robił się czarny. */
export const BARE = [0.095, 0.082, 0.068];

/**
 * Barwy pory roku (src/weather/seasons.js) dla terenu i drzew: uprawy na polach, mnożnik barwy trawy, liście drzew
 * liściastych i udział drzew przebarwionych jesienią (autumn 0..1 – drzewo z losem poniżej progu żółknie). setSeason
 * przy zmianie pory roku.
 */
export const SEASON = {
	crops: Object.fromEntries(['rapeseed', 'cereal', 'wheat', 'ripening', 'maize', 'soil'].map((k) => [k, uniform(new Color())])),
	grass: uniform(new Color(1, 1, 1)),
	leaf: uniform(new Color()),
	autumnLeaf: uniform(new Color()),
	autumn: uniform(0),
	balesStubble: uniform(0),
	balesHay: uniform(0),
	waves: uniform(0),
};
/** Ustawia barwy pory roku z palety { crops, grass, leaf, autumnLeaf, autumn }. */
export function setSeason(p) {
	for (const [k, u] of Object.entries(SEASON.crops)) u.value.setRGB(...p.crops[k]);
	SEASON.grass.value.setRGB(...p.grass);
	SEASON.leaf.value.setRGB(...p.leaf);
	SEASON.autumnLeaf.value.setRGB(...p.autumnLeaf);
	SEASON.autumn.value = p.autumn;
	SEASON.balesStubble.value = p.balesStubble ?? 0;
	SEASON.balesHay.value = p.balesHay ?? 0;
	SEASON.waves.value = p.waves ?? 0;
}
setSeason(seasonPalette('summer'));

const EARTH_R = 6371000;
let T = null;

/** Wołane raz po utworzeniu terenu: jego uniformy (edgeH, relief), tekstura wysokości i bok regionu. */
export function setTerrainUniforms(uniforms, heightTex, size) {
	T = { u: uniforms, h: texture(heightTex), size };
}

/** p – pozycja świata przy przewyższeniu 1, camXZ – uniform położenia kamery. */
export function onGround(p, camXZ) {
	let y = p.y;
	if (T) {
		const ground = T.h.sample(p.xz.div(T.size).add(0.5)).level(0).r;
		y = p.y.add(T.u.relief.sub(1).mul(ground.sub(T.u.edgeH)));
	}
	const d = p.xz.sub(camXZ);
	return vec3(p.x, y.sub(dot(d, d).div(2 * EARTH_R)), p.z);
}

// Nocne światła osad (latarnie): ustawiane raz przed utworzeniem materiałów; bez nich – zero.
let CL = null;
export function setCityLights(cl) { CL = cl; }
/** Natężenie światła latarni na ziemi w punkcie p (świat). */
export function cityLight(p) { return CL ? CL.groundLight(p) : vec3(0); }
/** Uniform odsetka zapalonych okien i jasności świecących elementów (dla budynków). */
export function cityUniforms() { return CL ? CL.uniforms : null; }
