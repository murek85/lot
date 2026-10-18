// Mosty i wiadukty z OpenStreetMap (drogi i tory z bridge=yes): pomost z bocznymi ścianami, bariery po bokach
// i filary co ~28 m do gruntu, gdy pomost jest wyraźnie nad terenem. Wysokość pomostu – jak wstęga drogi
// (prosta między przyczółkami), więc jezdnia i konstrukcja się zgadzają. Do tego perony przy torach.
import { Mesh } from 'three/webgpu';
import { makeLitMaterial, litGeometry } from './gfx/lit.js';
import { bridgeArrays } from './objgeo.js';
import { CASTER_LAYER } from './shadows.js';

/** shared – { material, shadowMaterial } wspólne dla wielu wywołań (kafle otwartego świata). */
export function createBridges(osm, region, terrain, atmo, clouds, plane, worldShadow, shared = null) {
	const a = bridgeArrays(osm, (x, z) => terrain.meshHeightAt(x, z), region.size / 2 - 30);
	return bridgesFromArrays(a, atmo, clouds, plane, worldShadow, shared);
}

/** Siatki mostów i peronów z tablic (bridgeArrays – w wątku głównym albo w wątku kafli). */
export function bridgesFromArrays(a, atmo, clouds, plane, worldShadow, shared = null) {
	const objects = [], shadowCasters = [];
	let material = shared?.material ?? null, shadowMaterial = shared?.shadowMaterial ?? null;
	if (a.count) {
		material ??= makeLitMaterial({ atmo, clouds, plane, worldShadow });
		shadowMaterial ??= makeLitMaterial({ atmo, clouds, plane, worldShadow: null });
		const geo = litGeometry(a);
		const mesh = new Mesh(geo, material);
		mesh.frustumCulled = false;
		objects.push(mesh);
		const s = new Mesh(geo, shadowMaterial);
		s.layers.set(CASTER_LAYER);
		s.frustumCulled = false;
		shadowCasters.push(s);
	}
	return {
		objects, shadowCasters, count: a.bridges, material, shadowMaterial,
		update(camera) {
			for (const o of [...objects, ...shadowCasters]) o.material.userData.camXZ.value.set(camera.position.x, camera.position.z);
		},
	};
}
