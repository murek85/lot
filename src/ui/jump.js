// Skok w dowolne miejsce (narzędzie deweloperskie: panel H i duża mapa z Shift+klik) – część bez DOM, testowana
// w Node: odczyt współrzędnych z tekstu i lista ostatnich skoków.

/**
 * Współrzędne z tekstu: „50.06, 19.94”, „50,06 19,94”, „50.06N 19.94E”, „19.94E 50.06N”. Kolejność bez liter – jak
 * w mapach (szerokość, długość); dla Polski (szer. 49–55, dł. 14–24) zamienione liczby też rozpoznajemy.
 * Zwraca { lat, lon } albo null.
 */
export function parseCoords(text) {
	const t = String(text).trim().toUpperCase();
	const m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*([NSEW])?$/);
	if (!m) return null;
	let a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[3].replace(',', '.'));
	const la = m[2], lb = m[4];
	if (la === 'S' || la === 'W') a = -a;
	if (lb === 'S' || lb === 'W') b = -b;
	let lat = a, lon = b;
	if (la === 'E' || la === 'W' || lb === 'N' || lb === 'S') [lat, lon] = [b, a];
	else if (!la && !lb && b >= 45 && b <= 56 && a >= 13 && a <= 25) [lat, lon] = [b, a]; // „19.94, 50.06” – długość pierwsza
	if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
	return { lat, lon };
}

/** Ostatnie skoki: nowy na początek, bez powtórzeń (ta sama nazwa albo ~200 m), najwyżej max. */
export function pushRecent(list, p, max = 5) {
	const same = (q) => q.name === p.name || (Math.abs(q.lat - p.lat) < 0.002 && Math.abs(q.lon - p.lon) < 0.003);
	return [p, ...list.filter((q) => !same(q))].slice(0, max);
}

/** Podpis współrzędnych do listy (nazwa z wyszukiwarki albo „50.061° N 19.937° E”). */
export const coordName = (p) => `${p.lat.toFixed(3)}° N ${p.lon.toFixed(3)}° E`;

const DIRS = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'];
/** Odległość i kierunek od samolotu do celu (różnica w układzie gry: x – wschód, z – południe), np. „34 km na płd.”. */
export function distDir(dx, dz) {
	const d = Math.hypot(dx, dz);
	if (d < 500) return 'tutaj';
	const km = d < 9500 ? (d / 1000).toFixed(1).replace('.', ',') : Math.round(d / 1000);
	const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
	return `${km} km na ${DIRS[Math.round(deg / 45) % 8]}`;
}
