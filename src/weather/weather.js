// Pogoda – sama logika (bez Three.js, testowana w Node): rodzaje pogody z opadami i chmurami, siła wiatru, wektor
// wiatru, turbulencja (suma sinusoid – gładka, powtarzalna) i harmonogram błyskawic w burzy.

/**
 * Pogoda: zachmurzenie (0..1) i zamglenie; precip – opad (rain | snow) i natężenie 0..1; clouds – podstawa,
 * grubość i gęstość warstwy (domyślnie 1500 / 1600 / 0,12); storm – błyskawice; snow – śnieg na ziemi; minWind –
 * najsłabszy wiatr (burza zawsze wieje).
 */
export const WEATHER = [
	{ id: 'clear', name: 'Bezchmurnie', cover: 0, haze: 3, note: 'widać po horyzont' },
	{ id: 'few', name: 'Pojedyncze chmury', cover: 0.25, haze: 5, note: 'cumulusy pogodne' },
	{ id: 'scattered', name: 'Umiarkowane', cover: 0.42, haze: 6, note: 'cień chmur na polach' },
	{ id: 'broken', name: 'Duże zachmurzenie', cover: 0.68, haze: 9, note: 'loty pod podstawą' },
	{ id: 'haze', name: 'Mgliście', cover: 0.3, haze: 26, note: 'zamglone dale' },
	{ id: 'rain', name: 'Deszcz', cover: 0.9, haze: 20, note: 'niska podstawa, smugi deszczu', precip: { type: 'rain', rate: 0.6 }, clouds: { base: 1000, thickness: 2200, extinction: 0.16 } },
	{ id: 'snow', name: 'Śnieg', cover: 0.85, haze: 24, note: 'płatki w powietrzu, białe pola', precip: { type: 'snow', rate: 0.7 }, clouds: { base: 1100, thickness: 1800, extinction: 0.14 }, snow: 1 },
	{ id: 'storm', name: 'Burza', cover: 0.97, haze: 16, note: 'ulewa, błyskawice, porywy', precip: { type: 'rain', rate: 1 }, clouds: { base: 900, thickness: 4500, extinction: 0.2 }, storm: true, minWind: 'strong' },
];

/** Wiatr: prędkość w m/s (z zachodu, z wolnym skręcaniem) i siła turbulencji. */
export const WINDS = [
	{ id: 'calm', name: 'Cisza', speed: 0, note: 'dym prosto w górę' },
	{ id: 'light', name: 'Słaby', speed: 4, note: 'ok. 15 km/h' },
	{ id: 'moderate', name: 'Umiarkowany', speed: 9, note: 'ok. 30 km/h, lekkie bujanie' },
	{ id: 'strong', name: 'Silny', speed: 15, note: 'ok. 55 km/h, znoszenie i turbulencja' },
	{ id: 'gale', name: 'Wichura', speed: 23, note: 'ok. 80 km/h – tylko dla odważnych' },
];

export const weatherById = (id) => WEATHER.find((w) => w.id === id) ?? WEATHER[2];

/** Śnieg na ziemi zimą przy każdej pogodzie (0..1) – mniej niż przy opadzie śniegu, w plamach widać ściernisko i łąki. */
export const WINTER_SNOW = 0.75;

/**
 * Pogoda w danej porze roku: zimą opad deszczu zamienia się w śnieg (burza – w śnieżycę z grzmotami), na ziemi leży
 * śnieg. Poza zimą – bez zmian.
 */
export function seasonWeather(w, season) {
	if (season !== 'winter') return w;
	const precip = w.precip?.type === 'rain' ? { type: 'snow', rate: Math.min(1, w.precip.rate + 0.1) } : w.precip;
	return { ...w, precip, snow: Math.max(w.snow ?? 0, WINTER_SNOW) };
}
export const windById = (id) => WINDS.find((w) => w.id === id) ?? WINDS[1];

/** Wiatr obowiązujący przy danej pogodzie (burza podnosi słabszy wiatr do swojego minimum). */
export function effectiveWind(weatherId, windId) {
	const w = weatherById(weatherId), v = windById(windId);
	const min = w.minWind ? windById(w.minWind) : null;
	return min && min.speed > v.speed ? min : v;
}

/**
 * Wektor wiatru (dokąd wieje, m/s) w układzie gry (x – wschód, z – południe) w chwili t: wiatr z zachodu
 * (wieje na wschód) z wolnym skręcaniem kierunku ±25° i porywami ±25% (przy silnym wietrze).
 */
export function windVector(speed, t) {
	const dir = 0.35 * Math.sin(t * 0.011) + 0.15 * Math.sin(t * 0.037 + 1.3); // odchylenie od wschodu, rad
	const gust = speed > 0 ? 1 + 0.25 * Math.min(1, speed / 12) * (0.6 * Math.sin(t * 0.31) + 0.4 * Math.sin(t * 0.83 + 2.1)) : 0;
	const v = speed * gust;
	return { x: Math.cos(dir) * v, z: Math.sin(dir) * v, speed: v };
}

/** Kierunek, z którego wieje (słownie, jak w komunikatach lotniczych) – wektor dokąd wieje. */
export function windFrom(x, z) {
	const DIRS = ['północy', 'północnego wschodu', 'wschodu', 'południowego wschodu', 'południa', 'południowego zachodu', 'zachodu', 'północnego zachodu'];
	// wieje z przeciwnej strony; 0 = północ (−z), zgodnie z ruchem wskazówek
	const ang = (Math.atan2(-x, z) + 2 * Math.PI) % (2 * Math.PI);
	return DIRS[Math.round(ang / (Math.PI / 4)) % 8];
}

/**
 * Turbulencja: trzy gładkie składowe −1…1 (przechył, wznoszenie, odchylenie) – suma sinusoid o niewspółmiernych
 * częstotliwościach (bez losowania co klatkę – nie drga z częstotliwością klatek). Siła: (prędkość wiatru / 15)^1.5,
 * w burzy więcej, przy ziemi (mechaniczna turbulencja) też.
 */
export function turbulence(t, speed, storm = false, agl = 500) {
	const k = Math.pow(Math.max(0, speed) / 15, 1.5) * (storm ? 1.6 : 1) * (agl < 150 ? 1.3 : 1);
	const s = (a, b, c, p) => (Math.sin(t * a + p) * 0.5 + Math.sin(t * b + p * 1.7) * 0.3 + Math.sin(t * c + p * 2.9) * 0.2);
	return { roll: s(1.3, 3.1, 7.3, 0.4) * k, lift: s(0.9, 2.3, 5.9, 2.2) * k, yaw: s(0.7, 1.9, 4.1, 4.4) * k, strength: k };
}

/** Prosty generator liczb pseudolosowych (powtarzalny w testach). */
export function rng(seed = 1) {
	let s = seed >>> 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/**
 * Harmonogram błyskawic: next(dt) zwraca null albo uderzenie { distance (m), bearing (rad), flickers: [czasy
 * błysków w s], delay (s do grzmotu) }. Odstępy 4–14 s, odległość 1,5–12 km (bliskie rzadziej).
 */
export function lightning(random = Math.random) {
	let wait = 2 + random() * 5;
	return {
		next(dt) {
			wait -= dt;
			if (wait > 0) return null;
			wait = 4 + random() * 10;
			const distance = 1500 + Math.pow(random(), 1.6) * 10500;
			const n = 1 + Math.floor(random() * 3);
			const flickers = [0];
			for (let i = 1; i < n; i++) flickers.push(flickers[i - 1] + 0.06 + random() * 0.12);
			return { distance, bearing: random() * Math.PI * 2, flickers, delay: distance / 340 };
		},
	};
}

/** Jasność błysku w chwili t od początku uderzenia (szybki wzrost, wykładnicze wygasanie każdego błysku). */
export function flashAt(t, flickers, distance) {
	let f = 0;
	for (const s of flickers) if (t >= s) f = Math.max(f, Math.exp(-(t - s) * 14));
	return f * Math.min(1, 3500 / distance);
}
