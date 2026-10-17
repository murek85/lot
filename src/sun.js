// Położenie Słońca (algorytm NOAA, dokładność ~0,1°) i kierunek do Słońca w układzie sceny (x – wschód, y – góra, z – południe).
const DEG = Math.PI / 180;

/** dayOfYear 1..366, hoursUtc 0..24, lat/lon w stopniach → { azimuth (od północy, w prawo), elevation } w radianach. */
export function sunPosition(dayOfYear, hoursUtc, lat, lon) {
	const g = (2 * Math.PI / 365) * (dayOfYear - 1 + (hoursUtc - 12) / 24);
	const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
	const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
	const trueSolarMin = hoursUtc * 60 + eqTime + 4 * lon;
	const ha = (trueSolarMin / 4 - 180) * DEG;
	const phi = lat * DEG;
	const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
	const elevation = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cosZ)));
	const azFromSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
	const azimuth = (azFromSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI);
	return { azimuth, elevation };
}

/** Kierunek do Słońca jako [x, y, z] w układzie sceny. */
export function sunDirection(azimuth, elevation) {
	const c = Math.cos(elevation);
	return [Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c];
}

/** Dzień roku dla daty (miesiąc 1..12). */
export function dayOfYear(month, day, year = 2026) {
	return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
}
