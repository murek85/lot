import test from 'node:test';
import assert from 'node:assert/strict';
import { lonLatToLocal, localToLonLat, lonToTileX, latToTileY, terrariumHeight, regionBounds } from '../src/geo.js';
import { REGIONS } from '../src/regions.js';

const center = { lon: 17.65, lat: 53.64 };

test('lokalne metry ↔ długość/szerokość wracają do punktu wyjścia', () => {
	for (const [lon, lat] of [[17.3, 53.43], [18.0, 53.85], [17.65, 53.64]]) {
		const p = lonLatToLocal(lon, lat, center);
		const back = localToLonLat(p.x, p.z, center);
		assert.ok(Math.abs(back.lon - lon) < 1e-9 && Math.abs(back.lat - lat) < 1e-9);
	}
});

test('północ to ujemne z, wschód to dodatnie x', () => {
	const north = lonLatToLocal(center.lon, center.lat + 0.1, center);
	const east = lonLatToLocal(center.lon + 0.1, center.lat, center);
	assert.ok(north.z < 0 && Math.abs(north.x) < 1e-6);
	assert.ok(east.x > 0 && Math.abs(east.z) < 1e-6);
	// 0,1° szerokości ≈ 11,1 km
	assert.ok(Math.abs(-north.z - 11119) < 5);
});

test('kafelki Web Mercator zgodne ze wzorem z ln(tg φ + sec φ)', () => {
	assert.equal(Math.floor(lonToTileX(21.0122, 12)), 2287);
	for (const lat of [52.2297, 53.64, -33.9, 0]) {
		const phi = (lat * Math.PI) / 180;
		const ref = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 4096;
		assert.ok(Math.abs(latToTileY(lat, 12) - ref) < 1e-6);
	}
	assert.equal(Math.floor(latToTileY(52.2297, 12)), 1348);
});

test('wysokość z piksela Terrarium', () => {
	assert.equal(terrariumHeight(128, 0, 0), 0);
	assert.equal(terrariumHeight(128, 100, 128), 100.5);
	assert.equal(terrariumHeight(127, 255, 0), -1);
});

test('granice regionu to kwadrat o zadanym boku', () => {
	const r = REGIONS['bory-tucholskie'];
	const b = regionBounds(r);
	const nw = lonLatToLocal(b.west, b.north, r.center), se = lonLatToLocal(b.east, b.south, r.center);
	assert.ok(Math.abs(se.x - nw.x - r.size) < 1e-6 && Math.abs(se.z - nw.z - r.size) < 1e-6);
});
