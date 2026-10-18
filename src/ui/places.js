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

/** Pogoda: zachmurzenie (0..0,9) i zamglenie powietrza. */
export const WEATHER = [
	{ id: 'clear', name: 'Bezchmurnie', cover: 0, haze: 3, note: 'widać po horyzont' },
	{ id: 'few', name: 'Pojedyncze chmury', cover: 0.25, haze: 5, note: 'cumulusy pogodne' },
	{ id: 'scattered', name: 'Umiarkowane', cover: 0.42, haze: 6, note: 'cień chmur na polach' },
	{ id: 'broken', name: 'Duże zachmurzenie', cover: 0.68, haze: 9, note: 'loty pod podstawą' },
	{ id: 'haze', name: 'Mgliście', cover: 0.3, haze: 26, note: 'zamglone dale' },
];

export const DEFAULT_PLAN = { aircraft: 'dromader', place: 'tuchola', time: 'morning', season: 'summer', weather: 'scattered', view: 'plane' };

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
	sound: true, // dźwięk włączony (klawisz M)
	volume: 0.8, // głośność główna
	engineVolume: 1, // silnik i śmigło
	ambientVolume: 1, // wiatr, podwozie, zdarzenia
	uiSounds: true, // dźwięki menu
};

const DIRS = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'];

/**
 * Opis położenia punktu (x – wschód, z – południe, metry) względem najbliższego miejsca z listy
 * [{ name, gen, x, z }]: „nad Tucholą” (do 1,5 km) albo „6 km na płn.-zach. od Tucholi”.
 */
export function describePosition(x, z, places) {
	let best = null, bd = Infinity;
	for (const p of places) {
		const d = Math.hypot(x - p.x, z - p.z);
		if (d < bd) { bd = d; best = p; }
	}
	if (!best) return '';
	if (bd < 1500) return best.instr ? `nad ${best.instr}` : `nad miejscowością ${best.name}`;
	// kierunek od miejsca do punktu: 0 = północ (−z), zgodnie z ruchem wskazówek zegara
	const ang = (Math.atan2(x - best.x, -(z - best.z)) + 2 * Math.PI) % (2 * Math.PI);
	const dir = DIRS[Math.round(ang / (Math.PI / 4)) % 8];
	return `${Math.round(bd / 1000)} km na ${dir} od ${best.gen ?? `miejscowości ${best.name}`}`;
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
