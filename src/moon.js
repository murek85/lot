// Księżyc i niebo gwiazdowe: położenie Księżyca (uproszczona teoria Meeusa, dokładność ~0,3°), czas gwiazdowy
// i obrót sfery niebieskiej do układu sceny (x – wschód, y – góra, z – południe). Faza wynika z kąta między
// kierunkami do Słońca i Księżyca, więc oświetlona część tarczy w shaderze zgadza się z niebem.
const DEG = Math.PI / 180;

/** Doby od epoki J2000.0 (1.01.2000 12:00 UT) dla dnia roku i godziny UTC. */
export function daysSinceJ2000(year, dayOfYear, hoursUtc) {
	return (Date.UTC(year, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 86400000 + (dayOfYear - 1) + hoursUtc / 24;
}

/** Miejscowy czas gwiazdowy (radiany) dla długości geograficznej lon (stopnie). */
export function localSiderealTime(d, lon) {
	const gmst = 280.46061837 + 360.98564736629 * d;
	return (((gmst + lon) % 360) + 360) % 360 * DEG;
}

/**
 * Macierz 3×3 (wiersze) przeliczająca wektor równikowy (x – punkt Barana, z – biegun północny świata) na kierunek
 * w scenie dla czasu gwiazdowego lst i szerokości lat (stopnie). Transpozycja – w drugą stronę (dla gwiazd).
 */
export function equatorialToScene(lst, lat) {
	const cL = Math.cos(lst), sL = Math.sin(lst), cP = Math.cos(lat * DEG), sP = Math.sin(lat * DEG);
	return [
		[-sL, cL, 0], // wschód
		[cP * cL, cP * sL, sP], // góra
		[sP * cL, sP * sL, -cP], // południe
	];
}

const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/** Kierunek do Księżyca w układzie równikowym (wektor jednostkowy) – d: doby od J2000. */
export function moonEquatorial(d) {
	const L0 = 218.316 + 13.176396 * d;
	const Mm = (134.963 + 13.064993 * d) * DEG;
	const Ms = (357.529 + 0.98560028 * d) * DEG;
	const D = (297.85 + 12.190749 * d) * DEG;
	const F = (93.272 + 13.22935 * d) * DEG;
	const lam = (L0 + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * D - Mm) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * Mm)
		- 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F)) * DEG;
	const bet = (5.128 * Math.sin(F) + 0.281 * Math.sin(Mm + F) + 0.278 * Math.sin(Mm - F) + 0.173 * Math.sin(2 * D - F)) * DEG;
	const eps = (23.439 - 0.0000004 * d) * DEG;
	const cb = Math.cos(bet);
	return [
		cb * Math.cos(lam),
		Math.cos(eps) * cb * Math.sin(lam) - Math.sin(eps) * Math.sin(bet),
		Math.sin(eps) * cb * Math.sin(lam) + Math.cos(eps) * Math.sin(bet),
	];
}

/**
 * Niebo nocne dla daty i miejsca: kierunek do Księżyca w scenie, macierz sfery niebieskiej (do gwiazd).
 * year, dayOfYear, hoursUtc, lat, lon (stopnie).
 */
export function nightSky(year, dayOfYear, hoursUtc, lat, lon) {
	const d = daysSinceJ2000(year, dayOfYear, hoursUtc);
	const m = equatorialToScene(localSiderealTime(d, lon), lat);
	return { moonDir: apply(m, moonEquatorial(d)), matrix: m };
}

/** Oświetlona część tarczy (0 – nów, 1 – pełnia) z kierunków do Słońca i Księżyca. */
export function moonIllumination(sunDir, moonDir) {
	const c = sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2];
	return (1 - c) / 2;
}
