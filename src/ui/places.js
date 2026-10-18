// Miejsca startu, opis położenia („6 km na płn.-zach. od Tucholi”), zapis i odczyt ustawień oraz lotów w pamięci
// przeglądarki. Bez zależności od Three.js – testowane w Node.

/** Miejsca startu w regionie Borów Tucholskich (długość, szerokość geograficzna, krótki opis). */
export const PLACES = [
	{ id: 'tuchola', name: 'Tuchola', gen: 'Tucholi', instr: 'Tucholą', lon: 17.86, lat: 53.585, note: 'miasto w sercu borów, nad Brdą i Kiczyną' },
	{ id: 'charzykowy', name: 'Jezioro Charzykowskie', gen: 'Jeziora Charzykowskiego', instr: 'Jeziorem Charzykowskim', lon: 17.5, lat: 53.78, note: 'długie jezioro rynnowe, żagle i plaże' },
	{ id: 'chojnice', name: 'Chojnice', gen: 'Chojnic', instr: 'Chojnicami', lon: 17.557, lat: 53.697, note: 'węzeł kolejowy i stare miasto w murach' },
	{ id: 'rytel', name: 'Rytel nad Brdą', gen: 'Rytla', instr: 'Rytlem', lon: 17.73, lat: 53.748, note: 'meandry Brdy i mosty w lesie' },
	{ id: 'czersk', name: 'Czersk', gen: 'Czerska', instr: 'Czerskiem', lon: 17.98, lat: 53.795, note: 'wschodni skraj borów, linia do Gdyni' },
	{ id: 'czluchow', name: 'Człuchów', gen: 'Człuchowa', instr: 'Człuchowem', lon: 17.37, lat: 53.665, note: 'zamek krzyżacki między jeziorami' },
];

/** Pory dnia do wyboru (godzina lokalna). */
export const TIMES = [
	{ id: 'dawn', name: 'Świt', hour: 4.6, note: 'mgły nad łąkami' },
	{ id: 'morning', name: 'Poranek', hour: 7.25, note: 'niskie, ciepłe słońce' },
	{ id: 'noon', name: 'Południe', hour: 13, note: 'pełne światło' },
	{ id: 'sunset', name: 'Zachód', hour: 21.1, note: 'złota godzina' },
	{ id: 'night', name: 'Noc', hour: 23.4, note: 'księżyc, gwiazdy, latarnie' },
];

/** Pory roku (dzień roku 2026; daty pełni dla nocnych lotów). */
export const SEASONS = [
	{ id: 'spring', name: 'Wiosna', day: 121, note: '1 maja, pełnia' },
	{ id: 'summer', name: 'Lato', day: 180, note: '29 czerwca, pełnia' },
	{ id: 'autumn', name: 'Wczesna jesień', day: 269, note: '26 września, pełnia' },
];

/** Upływ czasu w locie: mnożnik czasu rzeczywistego (0 – zegar stoi). */
export const TIME_SPEEDS = [
	{ id: 'stop', name: 'Zatrzymany', rate: 0, note: 'pora dnia się nie zmienia' },
	{ id: 'x1', name: 'Rzeczywisty', rate: 1, note: 'minuta to minuta' },
	{ id: 'x10', name: 'Przyspieszony ×10', rate: 10, note: 'godzina w 6 minut' },
	{ id: 'x60', name: 'Szybki ×60', rate: 60, note: 'godzina w minutę – zachód słońca na żywo' },
];

/** Zegar: godzina i dzień roku po dt sekund przy mnożniku rate (przez północ – następny dzień, po 365 – 1). */
export function advanceClock(hour, day, dt, rate) {
	let h = hour + (dt * rate) / 3600, d = day;
	while (h >= 24) { h -= 24; d = d >= 365 ? 1 : d + 1; }
	return { hour: h, day: d };
}

// pogoda i wiatr – src/weather/weather.js (tu ponownie dla menu)
export { WEATHER, WINDS } from '../weather/weather.js';

export const DEFAULT_PLAN = { aircraft: 'dromader', place: 'tuchola', time: 'morning', season: 'summer', weather: 'scattered', wind: 'light', timeSpeed: 'x1', view: 'plane' };

export const DEFAULT_SETTINGS = {
	mini: 1, // efekt miniatury (tilt-shift)
	exposure: 1,
	relief: 1,
	renderScale: 1,
	fps: false,
	invertPitch: false,
	mouseSens: 1,
	chaseReturn: false, // kamera za samolotem wraca za ogon po puszczeniu myszy
	cockpitFov: 62,
	hud: true,
	dev: false,
	reducedMotion: false,
	traffic: 2, // ruch uliczny: 0 wyłączony, 1 mały, 2 normalny, 3 duży
	trains: true, // ruch kolejowy
	birds: true, // ptaki
	people: true, // piesi
	minimap: true, // minimapa w locie
	labels3d: false, // nazwy miast nad krajobrazem
	sound: true, // dźwięk włączony (klawisz M)
	volume: 0.8, // głośność główna
	engineVolume: 1, // silnik i śmigło
	ambientVolume: 1, // wiatr, podwozie, zdarzenia
	uiSounds: true, // dźwięki menu
};

const DIRS = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'];

// promień „nad” (m) i waga przy wyborze punktu odniesienia dla rodzajów miejscowości (bez rodzaju – jak miasteczko)
const RADIUS = { city: 3500, town: 1800, village: 900, suburb: 900, quarter: 700, hamlet: 450, neighbourhood: 400, isolated_dwelling: 200 };
const WEIGHT = { city: 4, town: 2.5, village: 1.2, suburb: 0.5, quarter: 0.4, hamlet: 0.5, neighbourhood: 0.3, isolated_dwelling: 0.2 };
const MAIN = new Set(['city', 'town', 'village']);
const instr = (p) => p.instr ?? (p.cls === 'city' || p.cls === 'town' ? `miastem ${p.name}` : `miejscowością ${p.name}`);
const gen = (p) => p.gen ?? (p.cls === 'city' || p.cls === 'town' ? `miasta ${p.name}` : `miejscowości ${p.name}`);

/**
 * Opis położenia punktu (x – wschód, z – południe, metry) względem miejscowości z listy [{ name, gen?, instr?, cls?,
 * x, z }]: w mieście z dzielnicą – „nad Zabrzem · Biskupice”, we wsi – „nad Tucholą” / „nad miejscowością Rytel”,
 * poza zabudową – „6 km na płn.-zach. od Tucholi” (od miejscowości ważnej i bliskiej: odległość / waga rodzaju).
 */
export function describePosition(x, z, places) {
	let main = null, mainK = Infinity, local = null, localK = Infinity, ref = null, refK = Infinity;
	for (const p of places) {
		const d = Math.hypot(x - p.x, z - p.z), c = p.cls ?? 'town';
		const k = d / (RADIUS[c] ?? 1500);
		if (k < 1) {
			if (MAIN.has(c)) { if (k < mainK) { mainK = k; main = p; } } else if (k < localK) { localK = k; local = p; }
		}
		const w = d / (WEIGHT[c] ?? 2.5);
		if (w < refK) { refK = w; ref = p; }
	}
	if (main && local && local.name !== main.name) return `nad ${instr(main)} · ${local.name}`;
	if (main) return `nad ${instr(main)}`;
	if (local) return local.cls === 'hamlet' || local.cls === 'isolated_dwelling' ? `nad ${instr(local)}` : `nad dzielnicą ${local.name}`;
	if (!ref) return '';
	const d = Math.hypot(x - ref.x, z - ref.z);
	// kierunek od miejsca do punktu: 0 = północ (−z), zgodnie z ruchem wskazówek zegara
	const ang = (Math.atan2(x - ref.x, -(z - ref.z)) + 2 * Math.PI) % (2 * Math.PI);
	const dir = DIRS[Math.round(ang / (Math.PI / 4)) % 8];
	return `${Math.max(1, Math.round(d / 1000))} km na ${dir} od ${gen(ref)}`;
}

/** Kurs w stopniach (0–359) z kursu w radianach. */
export const headingDeg = (h) => Math.round(((h * 180) / Math.PI + 360) % 360);

// --- pamięć przeglądarki (może być niedostępna: tryb prywatny, zablokowane dane strony) ---
const PREFIX = 'lot-';
export function load(key, fallback) {
	try {
		const v = localStorage.getItem(PREFIX + key);
		return v == null ? fallback : { ...fallback, ...JSON.parse(v) };
	} catch {
		return fallback;
	}
}
export function loadRaw(key) {
	try {
		const v = localStorage.getItem(PREFIX + key);
		return v == null ? null : JSON.parse(v);
	} catch {
		return null;
	}
}
export function save(key, value) {
	try {
		if (value == null) localStorage.removeItem(PREFIX + key);
		else localStorage.setItem(PREFIX + key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
