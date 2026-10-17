// Geografia regionu: lokalny układ metrów (x – wschód, z – południe, y – w górę), kafelki Web Mercator
// i odczyt wysokości z kafelków Terrarium. Wspólne dla gry i narzędzi (Node).

export const EARTH_RADIUS = 6371008.8;
const DEG = Math.PI / 180;

/** Długość/szerokość → metry względem środka regionu (rzut równoodległościowy, błąd < 0,1% na 50 km). */
export function lonLatToLocal(lon, lat, center) {
	return {
		x: (lon - center.lon) * DEG * EARTH_RADIUS * Math.cos(center.lat * DEG),
		z: -(lat - center.lat) * DEG * EARTH_RADIUS,
	};
}

export function localToLonLat(x, z, center) {
	return {
		lon: center.lon + x / (EARTH_RADIUS * Math.cos(center.lat * DEG)) / DEG,
		lat: center.lat - z / EARTH_RADIUS / DEG,
	};
}

/** Ułamkowe współrzędne kafelka Web Mercator na poziomie zoom. */
export function lonToTileX(lon, zoom) {
	return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat, zoom) {
	const s = Math.sin(lat * DEG);
	return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** zoom;
}

/** Wysokość w metrach z piksela kafelka Terrarium (AWS Terrain Tiles). */
export function terrariumHeight(r, g, b) {
	return r * 256 + g + b / 256 - 32768;
}

/** Granice regionu (kwadrat o boku size metrów) w stopniach. */
export function regionBounds(region) {
	const h = region.size / 2;
	const nw = localToLonLat(-h, -h, region.center);
	const se = localToLonLat(h, h, region.center);
	return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat };
}
