// Otwarty świat – wybór miejsca startu (ekran „Otwarty świat” w menu): gotowe miejsca i jakość danych w punkcie.
// Część bez DOM i bez Three.js – testowana w Node.
import { readManifest } from '../gen/lotmanifest.js';

/** Gotowe miejsca startu – po kilka z różnych stron Polski (Śląsk – pełna jakość własnych kafli). */
export const WORLD_PRESETS = [
	{ name: 'Katowice', lon: 19.0238, lat: 50.2649, note: 'Górnośląska aglomeracja, Spodek i hałdy' },
	{ name: 'Zabrze', lon: 18.7856, lat: 50.3249, note: 'kopalnie, osiedla i Drogowa Trasa Średnicowa' },
	{ name: 'Szczyrk', lon: 19.0333, lat: 49.7167, note: 'Beskid Śląski – Skrzyczne i doliny' },
	{ name: 'Częstochowa', lon: 19.1203, lat: 50.8118, note: 'Jasna Góra i skraj Jury' },
	{ name: 'Kraków', lon: 19.9450, lat: 50.0647, note: 'Wawel, Wisła i Nowa Huta' },
	{ name: 'Zakopane', lon: 19.9496, lat: 49.2992, note: 'Tatry i Podhale' },
	{ name: 'Wrocław', lon: 17.0385, lat: 51.1079, note: 'Odra, wyspy i mosty' },
	{ name: 'Warszawa', lon: 21.0122, lat: 52.2297, note: 'Wisła, Śródmieście i wieżowce' },
	{ name: 'Gdańsk', lon: 18.6466, lat: 54.3520, note: 'Motława, port i Zatoka Gdańska' },
	{ name: 'Mazury', lon: 21.7650, lat: 53.7980, note: 'Mikołajki i Śniardwy' },
];

/**
 * Obszary własnych kafli z opisu data/tiles/lot/tiles.json: [{ id, bounds: [w, s, e, n], z14: Set „x/y” }] (pusty – bez
 * opisu). Prostokąt to tylko szybkie odrzucenie – o pełnej jakości decyduje lista wypieczonych kafli z14 (Kraków leży
 * w prostokącie Śląska, ale poza jego kaflami).
 */
export function ownAreasOf(manifest) {
	return readManifest(manifest).areas;
}

const tileKey = (p) => {
	const n = 2 ** 14, r = (p.lat * Math.PI) / 180;
	return `${Math.floor(((p.lon + 180) / 360) * n)}/${Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)}`;
};

/** Czy punkt { lon, lat } leży na wypieczonym kaflu własnym. */
export function inOwnArea(areas, p) {
	const k = tileKey(p);
	return areas.some(({ bounds: [w, s, e, n], z14 }) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n && (!z14.size || z14.has(k)));
}

/** Jakość mapy w punkcie: { full, name, note } – do znaczka przy miejscu startu. */
export function qualityAt(areas, p) {
	return inOwnArea(areas, p)
		? { full: true, name: 'pełna jakość', note: 'własne kafle gry: rodzaje i dachy budynków, linie energetyczne, dokładna rzeźba GUGiK' }
		: { full: false, name: 'podstawowa jakość', note: 'kafle OpenFreeMap i rzeźba AWS Terrain Tiles – prostsze budynki, mniej szczegółów' };
}
