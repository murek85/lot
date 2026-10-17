// Mosty i wiadukty z OpenStreetMap (drogi i tory z bridge=yes): pomost z bocznymi ścianami, bariery po bokach
// i filary co ~28 m do gruntu, gdy pomost jest wyraźnie nad terenem. Wysokość pomostu – jak wstęga drogi
// (prosta między przyczółkami), więc jezdnia i konstrukcja się zgadzają. Do tego perony przy torach.
import { Mesh } from 'three/webgpu';
import { makeLitMaterial, GeoBuilder } from './gfx/lit.js';
import { densify } from './roads.js';
import { CASTER_LAYER } from './shadows.js';

const CONCRETE = [0.42, 0.41, 0.39], STEEL = [0.2, 0.22, 0.24], RUST = [0.25, 0.12, 0.07], PLATFORM = [0.36, 0.35, 0.33];

export function createBridges(osm, region, terrain, atmo, clouds, plane, worldShadow) {
	const half = region.size / 2 - 30;
	const b = new GeoBuilder();
	const decks = [];
	for (const [, w10, , bridge, , c] of osm.roads) if (bridge) decks.push({ c, width: w10 / 10 + 1.2, lift: 0.6, rail: false });
	for (const [kind, , bridge, , c] of osm.rails) if (bridge) decks.push({ c, width: 5, lift: 0.9, rail: true, old: kind >= 2 });
	let count = 0;
	for (const d of decks) {
		let pts = [];
		for (let i = 0; i < d.c.length; i += 2) pts.push(d.c[i] / 10, d.c[i + 1] / 10);
		if (pts.some((v) => Math.abs(v) > half)) continue;
		pts = densify(pts, 6);
		const n = pts.length / 2;
		if (n < 2) continue;
		const h0 = terrain.meshHeightAt(pts[0], pts[1]), h1 = terrain.meshHeightAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
		const deckY = (i) => h0 + (h1 - h0) * (i / (n - 1)) + d.lift - 0.05;
		let since = 0;
		for (let i = 1; i < n; i++) {
			const x0 = pts[i * 2 - 2], z0 = pts[i * 2 - 1], x1 = pts[i * 2], z1 = pts[i * 2 + 1];
			const y0 = deckY(i - 1), y1 = deckY(i);
			const y = (y0 + y1) / 2;
			// pomost (bez góry – jezdnię rysuje wstęga drogi/toru) i bariery po bokach
			const len = Math.hypot(x1 - x0, z1 - z0) || 1, tx = (x1 - x0) / len, tz = (z1 - z0) / len;
			const ox = -tz * (d.width / 2), oz = tx * (d.width / 2);
			for (const s of [-1, 1]) {
				const ax = x0 + ox * s, az = z0 + oz * s, bx = x1 + ox * s, bz = z1 + oz * s;
				const nrm = [-tz * s, 0, tx * s];
				b.quad([ax, y - 1.1, az], [bx, y - 1.1, bz], [bx, y + 0.05, bz], [ax, y + 0.05, az], nrm, CONCRETE);
				b.beam(ax - ox * s * 0.03, az - oz * s * 0.03, bx - ox * s * 0.03, bz - oz * s * 0.03, 0.08, y + 0.05, y + (d.rail ? 1.6 : 1.05), d.rail ? (d.old ? RUST : STEEL) : STEEL, false);
			}
			// spód pomostu
			b.quad([x0 + ox, y - 1.1, z0 + oz], [x1 + ox, y - 1.1, z1 + oz], [x1 - ox, y - 1.1, z1 - oz], [x0 - ox, y - 1.1, z0 - oz], [0, -1, 0], CONCRETE);
			// filary
			since += len;
			if (since > 28 && i < n - 1) {
				since = 0;
				const g = terrain.meshHeightAt(x1, z1);
				if (y1 - 1.1 - g > 2) b.beam(x1 - tx * 0.8, z1 - tz * 0.8, x1 + tx * 0.8, z1 + tz * 0.8, d.width * 0.7, g - 1, y1 - 1.1, CONCRETE);
			}
		}
		count++;
	}
	// perony: podniesione płyty (0,76 m) wzdłuż linii albo z obrysu (jako pas wzdłuż najdłuższego boku)
	for (const [c] of osm.platforms) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
		if (pts.some((v) => Math.abs(v) > half) || pts.length < 4) continue;
		const closed = pts.length >= 8 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
		if (closed) {
			// obrys peronu: odcinek środkowy wzdłuż najdłuższej krawędzi
			let best = 0, bi = 0;
			for (let i = 2; i < pts.length; i += 2) {
				const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
				if (l > best) { best = l; bi = i; }
			}
			let cx = 0, cz = 0;
			const m = pts.length / 2 - 1;
			for (let i = 0; i < m; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
			cx /= m; cz /= m;
			const tx = (pts[bi] - pts[bi - 2]) / best, tz = (pts[bi + 1] - pts[bi - 1]) / best;
			pts = [cx - tx * best / 2, cz - tz * best / 2, cx + tx * best / 2, cz + tz * best / 2];
		}
		for (let i = 2; i < pts.length; i += 2) {
			const g = Math.min(terrain.meshHeightAt(pts[i - 2], pts[i - 1]), terrain.meshHeightAt(pts[i], pts[i + 1]));
			b.beam(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], 4, g - 0.5, g + 0.76, PLATFORM);
		}
	}
	const objects = [], shadowCasters = [];
	if (b.count) {
		const material = makeLitMaterial({ atmo, clouds, plane, worldShadow });
		const geo = b.geometry();
		const mesh = new Mesh(geo, material);
		mesh.frustumCulled = false;
		objects.push(mesh);
		const s = new Mesh(geo, makeLitMaterial({ atmo, clouds, plane, worldShadow: null }));
		s.layers.set(CASTER_LAYER);
		s.frustumCulled = false;
		shadowCasters.push(s);
	}
	return {
		objects, shadowCasters, count,
		update(camera) {
			for (const o of [...objects, ...shadowCasters]) o.material.userData.camXZ.value.set(camera.position.x, camera.position.z);
		},
	};
}
