// Ręczne przepisy znanych budowli, których OpenStreetMap nie opisuje częściami 3D (building:part): bryła z kilku
// parametrów w miejscu z OSM (środek i rozmiar obrysu z wyciągów). Bez Three.js – budowane w wątku kafla do geometrii
// punktów orientacyjnych (src/gen/landmarkgeo.js); zwykłe bryły OSM w obrębie przepisu gra pomija
// (src/buildgeo.js: skip), żeby się nie dublowały.
import { lonLatToLocal } from '../geo.js';
import { beaconHeights } from '../gfx/structures.js';

const SILVER = [0.5, 0.52, 0.55], SILVER2 = [0.42, 0.44, 0.47], GLASS = [0.06, 0.07, 0.08], ROOF = [0.36, 0.37, 0.39];
const CONCRETE = [0.5, 0.5, 0.48], WHITE = [0.78, 0.79, 0.8], TRACK = [0.32, 0.1, 0.07], PITCH = [0.09, 0.2, 0.06];
const WOOD = [0.27, 0.17, 0.1], SLATE = [0.08, 0.085, 0.1], CREAM = [0.7, 0.68, 0.6];
const STEEL = [0.35, 0.36, 0.38], MATS = [0.2, 0.33, 0.18], OUTRUN = [0.28, 0.4, 0.22], STONE = [0.6, 0.58, 0.5];
const DEG = Math.PI / 180;

/**
 * Przepisy: id, nazwa, środek (lat, lon), rodzaj i wymiary (m). rot – obrót wokół pionu (rad, od osi x na wschód ku
 * południu). Skocznie i ruiny – środek, oś i rozmiar z obrysów OSM (sport=ski_jumping, historic=castle + ruins).
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
	// skocznie: rot – kierunek w dół zbocza (linia największego spadku terenu, zgodna z osią obrysu OSM), len – długość
	// całego obiektu wzdłuż osi (od startu do końca wybiegu), hs – rozmiar skoczni
	{ id: 'wielka-krokiew', name: 'Wielka Krokiew', lat: 49.27926, lon: 19.96412, kind: 'skiJump', rot: 265 * DEG, len: 440, hs: 140 },
	{ id: 'srednia-krokiew', name: 'Średnia Krokiew', lat: 49.27939, lon: 19.96832, kind: 'skiJump', rot: 260 * DEG, len: 215, hs: 97 },
	{ id: 'malinka', name: 'Skocznia im. Adama Małysza (Malinka)', lat: 49.62864, lon: 18.91546, kind: 'skiJump', rot: 260 * DEG, len: 313, hs: 134 },
	{ id: 'skalite', name: 'Skalite', lat: 49.71604, lon: 19.03691, kind: 'skiJump', rot: 245 * DEG, len: 330, hs: 104 },
	// ruiny zamków jurajskich: budynki OSM w elipsie (ax, az – półosie) jako mury z wapienia bez dachów
	{ id: 'ogrodzieniec', name: 'Zamek Ogrodzieniec', lat: 50.45326, lon: 19.5529, kind: 'ruins', rot: 116 * DEG, ax: 88, az: 82 },
	{ id: 'olsztyn', name: 'Zamek w Olsztynie', lat: 50.74899, lon: 19.27376, kind: 'ruins', rot: -59 * DEG, ax: 122, az: 54 },
];

/** Położenie punktu (x, z) w osiach przepisu: u – wzdłuż rot, v – w poprzek. */
const local = (r, x, z) => {
	const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot ?? 0), s = Math.sin(r.rot ?? 0);
	return [dx * c + dz * s, -dx * s + dz * c];
};

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
		if (r.kind === 'stadium' || r.kind === 'ruins') {
			const [u, v] = local(r, x, z);
			if ((u / (r.ax * 1.02)) ** 2 + (v / (r.az * 1.02)) ** 2 < 1) return true;
		}
		if (r.kind === 'skiJump') {
			const [u, v] = local(r, x, z);
			if (Math.abs(u) < r.len / 2 + 10 && Math.abs(v) < 30) return true;
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
		// ruiny – z budynków tego kafla (zamek na granicy kafli: każdy kafel buduje swoje mury), reszta – kafel ze środkiem
		if (r.kind === 'ruins') { buildRuins(body, r, heightAt, buildings); continue; }
		if (r.kind === 'skiJump') { if (r.own) buildSkiJump(body, r, heightAt); continue; }
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

/**
 * Skocznia na zboczu: rozbieg – pomost na podporach pod ~35° od wieży startowej do progu (próg 2,5 m nad terenem),
 * zeskok i wybieg – maty położone na terenie (zwężające się ku górze), wieża sędziowska z boku zeskoku. rot – w dół
 * zbocza. Długości z rozmiaru skoczni (hs).
 */
function buildSkiJump(body, r, heightAt) {
	const c = Math.cos(r.rot), s = Math.sin(r.rot);
	// punkt w odległości a od górnego końca osi, b w poprzek
	const P = (a, b) => [r.x + c * (a - r.len / 2) - s * b, r.z + s * (a - r.len / 2) + c * b];
	const H = (a, b = 0) => { const [x, z] = P(a, b); return heightAt(x, z); };
	if (!Number.isFinite(H(0))) return;
	const inrunH = r.hs * 0.59, takeoff = inrunH; // poziomy zasięg rozbiegu (0,72 hs pod 35°)
	const yT = H(takeoff) + 2.5;
	const yS = Math.max(yT + r.hs * 0.41, H(0) + 4);
	// pomost rozbiegu: wierzch i boki, co 5 m; podpory co 10 m tam, gdzie pomost jest nad terenem
	const W = 3;
	const deck = (a) => yS + (yT - yS) * (a / takeoff);
	for (let a = 0; a < takeoff; a += 5) {
		const a1 = Math.min(takeoff, a + 5), y0 = deck(a), y1 = deck(a1);
		const [lx0, lz0] = P(a, -W), [rx0, rz0] = P(a, W), [lx1, lz1] = P(a1, -W), [rx1, rz1] = P(a1, W);
		body.quad([lx0, y0, lz0], [rx0, y0, rz0], [rx1, y1, rz1], [lx1, y1, lz1], [0, 1, 0], WHITE);
		body.quad([lx0, y0 - 1.2, lz0], [lx0, y0, lz0], [lx1, y1, lz1], [lx1, y1 - 1.2, lz1], [s, 0, -c], WHITE);
		body.quad([rx0, y0, rz0], [rx0, y0 - 1.2, rz0], [rx1, y1 - 1.2, rz1], [rx1, y1, rz1], [-s, 0, c], WHITE);
		if (a % 10 === 0) for (const b of [-W + 0.5, W - 0.5]) {
			const [x, z] = P(a, b), g = heightAt(x, z);
			if (y0 - 1.2 - g > 1) body.tube(x, z, g - 0.5, y0 - 1.2, 0.45, 0.45, 6, STEEL, false);
		}
	}
	// wieża startowa
	const [tx0, tz0] = P(-4, 0), [tx1, tz1] = P(6, 0);
	body.beam(tx0, tz0, tx1, tz1, 10, Math.min(H(-4), H(6)) - 0.5, yS + 6, CONCRETE);
	// zeskok i wybieg: maty na terenie, pas co 6 m (szerokość od 14 m przy progu do 40 m na wybiegu)
	const landEnd = Math.min(r.len - 30, takeoff + r.hs * 1.15);
	for (let a = takeoff; a < r.len; a += 6) {
		const a1 = Math.min(r.len, a + 6), t0 = (a - takeoff) / (landEnd - takeoff), t1 = (a1 - takeoff) / (landEnd - takeoff);
		const w0 = 7 + 13 * Math.min(1, t0), w1 = 7 + 13 * Math.min(1, t1), col = a < landEnd ? MATS : OUTRUN;
		const q = (aa, b) => { const [x, z] = P(aa, b); return [x, heightAt(x, z) + 0.3, z]; };
		body.quad(q(a, -w0), q(a, w0), q(a1, w1), q(a1, -w1), [0, 1, 0], col);
	}
	// wieża sędziowska z boku zeskoku (przy punkcie konstrukcyjnym)
	const k = takeoff + r.hs * 0.6, [jx0, jz0] = P(k - 4, 30), [jx1, jz1] = P(k + 4, 30);
	body.beam(jx0, jz0, jx1, jz1, 7, H(k, 30) - 0.5, H(k, 30) + 14, CONCRETE);
	body.beam(jx0, jz0, jx1, jz1, 7.2, H(k, 30) + 10, H(k, 30) + 13, GLASS);
}

/**
 * Ruiny zamku: budynki OSM w elipsie przepisu jako mury z wapienia (1,6 m grubości) bez dachów i okien, z poszarpaną
 * koroną – każda krawędź obrysu w odcinkach ~4 m o losowej wysokości (od ~40% do pełnej wysokości budynku).
 */
function buildRuins(body, r, heightAt, buildings) {
	for (const [, h10, , , c] of buildings) {
		const n = c.length / 2;
		let cx = 0, cz = 0;
		for (let i = 0; i < n; i++) { cx += c[i * 2]; cz += c[i * 2 + 1]; }
		if (!recipeCovers([r], cx / n / 10, cz / n / 10)) continue;
		let g = Infinity;
		for (let i = 0; i < n; i++) g = Math.min(g, heightAt(c[i * 2] / 10, c[i * 2 + 1] / 10));
		if (!Number.isFinite(g)) continue;
		const h = Math.max(8, h10 / 10);
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n, x0 = c[i * 2] / 10, z0 = c[i * 2 + 1] / 10, x1 = c[j * 2] / 10, z1 = c[j * 2 + 1] / 10;
			const len = Math.hypot(x1 - x0, z1 - z0), k = Math.max(1, Math.round(len / 4));
			for (let m = 0; m < k; m++) {
				const t0 = m / k, t1 = (m + 1) / k;
				const rnd = Math.abs(Math.sin((x0 + m) * 12.9898 + (z0 - m) * 78.233)) % 1;
				body.beam(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, 1.6, g - 0.5, g + h * (0.4 + 0.6 * rnd), STONE);
			}
		}
	}
}

/**
 * Wycinka lasu wzdłuż skoczni (rozbieg, zeskok, wybieg): pasy jako szerokie drogi do maski dróg kafla
 * (src/world/chunkdata.js: chunkMask – drzewa na nich nie stają). Format drogi gry: [klasa, szerokość dm, …, obrys dm].
 */
export function recipeLanes(list) {
	const out = [];
	for (const r of list) {
		if (r.kind !== 'skiJump') continue;
		const c = Math.cos(r.rot), s = Math.sin(r.rot), h = r.len / 2 + 15;
		out.push([6, 400, 0, 0, 0, [r.x - c * h, r.z - s * h, r.x + c * h, r.z + s * h].map((v) => Math.round(v * 10)), 0]);
	}
	return out;
}
