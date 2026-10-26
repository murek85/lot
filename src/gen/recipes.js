// Ręczne przepisy znanych budowli, których OpenStreetMap nie opisuje częściami 3D (building:part): bryła z kilku
// parametrów w miejscu z OSM (środek i rozmiar obrysu z wyciągów). Bez Three.js – budowane w wątku kafla do geometrii
// punktów orientacyjnych (src/gen/landmarkgeo.js); zwykłe bryły OSM w obrębie przepisu gra pomija
// (src/buildgeo.js: skip), żeby się nie dublowały.
import { lonLatToLocal } from '../geo.js';
import { beaconHeights } from '../gfx/structures.js';

const SILVER = [0.5, 0.52, 0.55], SILVER2 = [0.42, 0.44, 0.47], GLASS = [0.06, 0.07, 0.08], ROOF = [0.36, 0.37, 0.39];
const CONCRETE = [0.5, 0.5, 0.48], WHITE = [0.78, 0.79, 0.8], TRACK = [0.32, 0.1, 0.07], PITCH = [0.09, 0.2, 0.06];
const WOOD = [0.27, 0.17, 0.1], SLATE = [0.08, 0.085, 0.1], CREAM = [0.7, 0.68, 0.6];

/**
 * Przepisy: id, nazwa, środek (lat, lon), rodzaj i wymiary (m). rot – obrót wokół pionu (rad, od osi x na wschód).
 * Wielka Krokiew – jeszcze nie (skocznia musi leżeć na zboczu: brak punktów startu i progu w danych).
 */
export const RECIPES = [
	// hala widowiskowa w kształcie spodka: szklany cokół, pochyła okładzina „talerza”, płaski stożek dachu (~30 m)
	{ id: 'spodek', name: 'Spodek', lat: 50.26611, lon: 19.02533, kind: 'spodek', r: 59 },
	// Stadion Śląski: owalne trybuny, bieżnia i boisko, biały dach-pierścień na masztach (~40 m)
	{ id: 'stadion-slaski', name: 'Stadion Śląski', lat: 50.28824, lon: 18.9735, kind: 'stadium', ax: 112, az: 134, rot: 0 },
	// Radiostacja Gliwice: drewniana kratownica z modrzewia, 111 m
	{ id: 'radiostacja', name: 'Radiostacja Gliwice', lat: 50.31334, lon: 18.68876, kind: 'woodTower', h: 111, rot: 0.35 },
	// Zamek Moszna: bryła z OSM, do tego wieżyczki ze stożkowymi hełmami na narożnikach (zamek „99 wież”)
	{ id: 'moszna', name: 'Zamek Moszna', lat: 50.44079, lon: 17.76793, kind: 'castle', r: 70 },
];

/**
 * Przepisy w układzie świata (origin – { lon, lat } początku układu) w prostokącie frame ({ x0, z0, w, h }) powiększonym
 * o margin (m): [{ ...przepis, x, z, own }] – own: środek w samym prostokącie (ten kafel buduje bryłę).
 */
export function recipesNear(origin, frame, margin = 300) {
	const out = [];
	for (const r of RECIPES) {
		const p = lonLatToLocal(r.lon, r.lat, origin);
		const inX = (m) => p.x >= frame.x0 - m && p.x < frame.x0 + frame.w + m, inZ = (m) => p.z >= frame.z0 - m && p.z < frame.z0 + frame.h + m;
		if (inX(margin) && inZ(margin)) out.push({ ...r, x: p.x, z: p.z, own: inX(0) && inZ(0) });
	}
	return out;
}

/** Czy zwykła bryła OSM ze środkiem (x, z) leży w obrębie przepisu (wtedy gra jej nie rysuje). */
export function recipeCovers(list, x, z) {
	for (const r of list) {
		const dx = x - r.x, dz = z - r.z;
		if (r.kind === 'spodek' && Math.hypot(dx, dz) < r.r + 4) return true;
		if (r.kind === 'woodTower' && Math.hypot(dx, dz) < 20) return true;
		if (r.kind === 'stadium') {
			const c = Math.cos(-(r.rot ?? 0)), s = Math.sin(-(r.rot ?? 0)), u = dx * c - dz * s, v = dx * s + dz * c;
			if ((u / (r.ax * 1.02)) ** 2 + (v / (r.az * 1.02)) ** 2 < 1) return true;
		}
	}
	return false;
}

/**
 * Geometria przepisów z own = true do zbieracza body (src/gfx/geobuilder.js), światła przeszkodowe do beacons.
 * heightAt – teren; buildings – budynki kafla (format gry, dm) – zamek dostaje wieżyczki na narożnikach swojego obrysu.
 */
export function buildRecipes(body, beacons, list, heightAt, buildings = []) {
	for (const r of list) {
		if (!r.own) continue;
		// podstawa: najniższy punkt terenu pod bryłą (na zboczu bryła wchodzi w ziemię, nie wisi)
		const R = r.r ?? Math.max(r.ax ?? 10, r.az ?? 10);
		let g = Infinity;
		for (let k = 0; k < 9; k++) { const a = (k / 8) * Math.PI * 2; g = Math.min(g, heightAt(r.x + Math.cos(a) * R * 0.9 * (k ? 1 : 0), r.z + Math.sin(a) * R * 0.9 * (k ? 1 : 0))); }
		if (!Number.isFinite(g)) continue;
		if (r.kind === 'spodek') {
			body.lathe(r.x, r.z, r.r, r.r, 0, [
				[0.62, g - 1, GLASS], [0.62, g + 6, CONCRETE], [0.68, g + 7.2, SILVER], [1, g + 17, SILVER2], [1, g + 19.5, ROOF],
				[0.55, g + 25, ROOF], [0.15, g + 28.6, ROOF], [0, g + 29.2, ROOF],
			], 64);
		} else if (r.kind === 'stadium') {
			const rot = r.rot ?? 0;
			// trybuny: przekrój od zewnętrznej ściany w górę, po rzędach w dół ku boisku, niski murek – normalne na zewnątrz
			body.lathe(r.x, r.z, r.ax, r.az, rot, [
				[0.97, g - 1, CONCRETE], [0.97, g + 25, CONCRETE], [0.95, g + 27, CONCRETE], [0.6, g + 3, CONCRETE], [0.6, g - 1, CONCRETE],
			], 72);
			// bieżnia i murawa (płaskie, tuż nad terenem)
			body.lathe(r.x, r.z, r.ax, r.az, rot, [[0.6, g + 0.35, TRACK], [0.48, g + 0.35, PITCH], [0, g + 0.35, PITCH]], 72);
			// dach-pierścień: biała membrana nad trybunami, od zewnętrznego pierścienia ku boisku lekko w dół
			body.lathe(r.x, r.z, r.ax, r.az, rot, [[1.02, g + 41, WHITE], [0.66, g + 37.5, WHITE]], 72);
			// maszty dachu wokół stadionu
			const c = Math.cos(rot), s = Math.sin(rot);
			for (let k = 0; k < 24; k++) {
				const a = (k / 24) * Math.PI * 2, u = Math.cos(a) * r.ax * 1.03, v = Math.sin(a) * r.az * 1.03;
				body.tube(r.x + u * c - v * s, r.z + u * s + v * c, g - 1, g + 44, 0.9, 0.6, 8, WHITE, true);
			}
		} else if (r.kind === 'woodTower') {
			// cztery nogi zbiegające się ku górze, poziome rygle i krzyżulce na każdej ścianie co ~9 m, platforma i maszt
			const c = Math.cos(r.rot), s = Math.sin(r.rot);
			const P = (u, v, y) => [r.x + u * c - v * s, y, r.z + u * s + v * c];
			const half = (y) => 6 - (y - g) / r.h * 4.9;
			const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
			for (const [u, v] of corners) body.strut(P(u * 6, v * 6, g - 0.5), P(u * 1.1, v * 1.1, g + r.h), 0.7, WOOD);
			for (let y = g + 9; y < g + r.h - 2; y += 9) {
				const h0 = half(y), h1 = half(Math.min(g + r.h, y + 9));
				for (let k = 0; k < 4; k++) {
					const [u0, v0] = corners[k], [u1, v1] = corners[(k + 1) % 4];
					body.strut(P(u0 * h0, v0 * h0, y), P(u1 * h0, v1 * h0, y), 0.35, WOOD);
					body.strut(P(u0 * h0, v0 * h0, y), P(u1 * h1, v1 * h1, Math.min(g + r.h, y + 9)), 0.25, WOOD);
					body.strut(P(u1 * h0, v1 * h0, y), P(u0 * h1, v0 * h1, Math.min(g + r.h, y + 9)), 0.25, WOOD);
				}
			}
			body.tube(r.x, r.z, g + r.h - 0.5, g + r.h + 0.3, 1.8, 1.8, 8, WOOD, true);
			body.tube(r.x, r.z, g + r.h, g + r.h + 6, 0.15, 0.1, 6, SILVER, false);
			for (const y of beaconHeights(r.h)) beacons.push([r.x, g + y + 1.2, r.z]);
		} else if (r.kind === 'castle') {
			// największy budynek w promieniu r – zamek: wieżyczki na wyraźnych narożnikach obrysu (co najmniej co 6 m)
			let best = null, bestA = 0;
			for (const [, h10, , , c] of buildings) {
				const n = c.length / 2;
				let cx = 0, cz = 0, a = 0;
				for (let i = 0; i < n; i++) { cx += c[i * 2]; cz += c[i * 2 + 1]; const j = (i + 1) % n; a += c[i * 2] * c[j * 2 + 1] - c[j * 2] * c[i * 2 + 1]; }
				cx /= n * 10; cz /= n * 10; a = Math.abs(a) / 200;
				if (Math.hypot(cx - r.x, cz - r.z) < r.r && a > bestA) { best = { c, h: h10 / 10 }; bestA = a; }
			}
			if (!best) continue;
			const pts = [];
			for (let i = 0; i < best.c.length; i += 2) pts.push([best.c[i] / 10, best.c[i + 1] / 10]);
			if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
			const top = g + Math.max(12, best.h);
			const placed = [];
			pts.forEach(([x, z], i) => {
				const [px, pz] = pts[(i + pts.length - 1) % pts.length], [nx, nz] = pts[(i + 1) % pts.length];
				const a0 = Math.atan2(z - pz, x - px), a1 = Math.atan2(nz - z, nx - x);
				let turn = Math.abs(a1 - a0);
				if (turn > Math.PI) turn = Math.PI * 2 - turn;
				if (turn < 0.6 || placed.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 6)) return;
				placed.push([x, z]);
				const big = placed.length % 5 === 1, rr = big ? 3.2 : 2;
				const t = top + (big ? 9 : 4) + ((i * 37) % 5);
				body.tube(x, z, g - 0.5, t, rr, rr, 10, CREAM, false);
				body.tube(x, z, t, t + rr * (big ? 3.4 : 2.6), rr * 1.15, 0, 10, SLATE, false);
			});
		}
	}
}
