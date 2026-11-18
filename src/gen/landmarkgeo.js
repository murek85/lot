// Geometria punktów orientacyjnych z kafli (src/gen/osmtags.js: landmarkInfo) – bez Three.js, w wątku kafli:
//   – elektrownia wiatrowa: biała wieża stożkowa; gondola z wirnikiem osobno (rotor) – obraca się w shaderze
//     (src/landmarks.js) i ustawia pod wiatr;
//   – komin: smukły stożek z cegły albo betonu, wysokie – w czerwono-białe pasy u góry;
//   – wieża szybowa: stalowa kratownica z kołami linowymi na szczycie i zastrzałem (Śląsk);
//   – wieża ciśnień: trzon i zbiornik („grzybek”) ze stożkowym dachem;
//   – maszt: smukła kratownica w czerwono-białe odcinki.
// Do tego światła przeszkodowe (beacons) jak na kominach z obrysów budynków.
import { GeoArrays } from '../gfx/geobuilder.js';
import { LANDMARK, SMOKE } from './osmtags.js';
import { beaconHeights } from '../gfx/structures.js';
import { buildRecipes, recipeCovers } from './recipes.js';
import { pointInRing } from '../buildgeo.js';
import { placeAircraft } from './aircraftgeo.js';

const WHITE = [0.78, 0.79, 0.8], RED = [0.55, 0.08, 0.05], BRICK = [0.36, 0.17, 0.11], CONCRETE = [0.48, 0.47, 0.44];
const STEEL = [0.3, 0.12, 0.08], DARK = [0.16, 0.16, 0.17], YELLOW = [0.55, 0.38, 0.03], PANEL = [0.02, 0.03, 0.065], GREY = [0.4, 0.4, 0.4];

const hash = (x, z, k) => {
	const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
	return s - Math.floor(s);
};

/**
 * list – [rodzaj, x, z (dm), wysokość (dm), wirnik (dm)] z kafla; heightAt(x, z) – teren. Zwraca { body: tablice
 * zbieracza, rotor: { pos, nrm, col, top, spin, idx, count } (współrzędne lokalne względem szczytu wieży, oś wirnika
 * +z), beacons: [[x, y, z]] }.
 */
export function landmarkArrays(list, heightAt, recipes = [], buildings = [], osm = {}) {
	const body = new GeoArrays();
	const R = { pos: [], nrm: [], col: [], top: [], spin: [], idx: [], count: 0 };
	const beacons = [];
	const smoke = []; // [x, y, z, rodzaj, promień] – dymiące kominy
	// wierzchołek wirnika: p, n – lokalnie, top – szczyt wieży, spin – 1 dla łopat (obracane)
	const rv = (p, n, c, top, spin) => { R.pos.push(...p); R.nrm.push(...n); R.col.push(...c); R.top.push(...top); R.spin.push(spin); return R.count++; };
	const rbox = (x0, x1, y0, y1, z0, z1, c, top) => {
		const faces = [
			[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
			[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
			[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
		];
		for (const [a, b, cc, d, n] of faces) {
			const i = rv(a, n, c, top, 0); rv(b, n, c, top, 0); rv(cc, n, c, top, 0); rv(d, n, c, top, 0);
			R.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
		}
	};
	for (const [kind, x10, z10, h10, r10] of list) {
		const x = x10 / 10, z = z10 / 10, H = h10 / 10, g = heightAt(x, z);
		if (!Number.isFinite(g) || recipeCovers(recipes, x, z)) continue; // ta budowla ma ręczny przepis
		if (kind === LANDMARK.wind) {
			const s = H / 100;
			body.tube(x, z, g - 1, g + H, 2.3 * s + 0.6, 1.4 * s + 0.4, 12, WHITE, false);
			const top = [x, g + H, z];
			// gondola (z tyłu wieży) i piasta; łopaty: trzy zwężające się płaty w płaszczyźnie xy, 0,6 m przed piastą
			rbox(-1.8 * s, 1.8 * s, 0, 3.8 * s, -7.5 * s, 3 * s, WHITE, top);
			rbox(-1.2 * s, 1.2 * s, 0.7 * s, 3.1 * s, 3 * s, 5 * s, WHITE, top);
			const L = r10 / 20, hubY = 1.9 * s, bz = 5.4 * s;
			for (let k = 0; k < 3; k++) {
				const a = (k / 3) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
				// w układzie łopaty: wzdłuż (u) i w poprzek (v) – cięciwa od ~3,5 m przy piaście do ~0,8 m na końcu
				const pt = (u, v) => [ca * v - sa * u, hubY + sa * v + ca * u, bz];
				const c0 = 0.045 * L, c1 = 0.012 * L;
				const i = rv(pt(1.5 * s, -c0 * 0.4), [0, 0, 1], WHITE, top, 1);
				rv(pt(1.5 * s, c0 * 0.6), [0, 0, 1], WHITE, top, 1);
				rv(pt(L, c1 * 0.6), [0, 0, 1], WHITE, top, 1);
				rv(pt(L, -c1 * 0.4), [0, 0, 1], WHITE, top, 1);
				R.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
			}
			beacons.push([x, g + H + 4 * s, z]);
		} else if (kind === LANDMARK.chimney) {
			const r0 = Math.max(1.6, H * 0.045), r1 = r0 * 0.55, mat = hash(x, z, 1) < 0.5 ? BRICK : CONCRETE;
			if (H >= 80) {
				// czerwono-białe pasy w górnej części (oznakowanie przeszkodowe)
				const yb = g + H * 0.7, band = H * 0.06, rAt = (y) => r0 + (r1 - r0) * ((y - g) / H);
				body.tube(x, z, g - 1, yb, r0, rAt(yb), 14, mat, false);
				for (let k = 0, y = yb; y < g + H - 0.01; k++, y += band) {
					const y1 = Math.min(g + H, y + band);
					body.tube(x, z, y, y1, rAt(y), rAt(y1), 14, k % 2 ? WHITE : RED, y1 >= g + H - 0.01);
				}
			} else body.tube(x, z, g - 1, g + H, r0, r1, 14, mat);
			for (const y of beaconHeights(H)) beacons.push([x, g + y + 1.2, z]);
			if (hash(x, z, 5) < (H >= 100 ? 0.7 : 0.35)) smoke.push(x, g + H, z, SMOKE.chimney, r1);
		} else if (kind === LANDMARK.headframe) {
			// kratownica: cztery nogi zbiegające się ku górze, poprzeczki co ~8 m, koła linowe i zastrzał w stronę maszynowni
			const a = hash(x, z, 2) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
			const rot = (u, v) => [x + ca * u - sa * v, z + sa * u + ca * v];
			const b0 = Math.max(4, H * 0.14), b1 = b0 * 0.55, W = Math.max(0.6, H * 0.018);
			const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
			for (const [u, v] of corners) {
				const [x0, z0] = rot(u * b0, v * b0), [x1, z1] = rot(u * b1, v * b1);
				body.strut([x0, g - 0.5, z0], [x1, g + H, z1], W, STEEL);
			}
			for (let y = 8; y < H - 2; y += 8) {
				const b = b0 + (b1 - b0) * (y / H);
				for (let k = 0; k < 4; k++) {
					const [x0, z0] = rot(corners[k][0] * b, corners[k][1] * b), [x1, z1] = rot(corners[(k + 1) % 4][0] * b, corners[(k + 1) % 4][1] * b);
					body.beam(x0, z0, x1, z1, W * 0.6, g + y - W * 0.3, g + y + W * 0.3, STEEL);
				}
			}
			// platforma i dwa koła linowe w pionie (szprychy z belek)
			const [px0, pz0] = rot(-b1 * 1.2, -b1 * 1.2), [px1, pz1] = rot(b1 * 1.2, b1 * 1.2);
			body.beam(px0, pz0, px1, pz1, b1 * 2.4, g + H, g + H + 0.8, STEEL);
			for (const v of [-b1 * 0.5, b1 * 0.5]) {
				const rw = Math.max(2, H * 0.07);
				for (let k = 0; k < 4; k++) {
					const an = (k / 4) * Math.PI;
					const [ax, az] = rot(Math.cos(an) * rw, v), [bx, bz] = rot(-Math.cos(an) * rw, v);
					body.beam(ax, az, bx, bz, W * 0.5, g + H + 0.8 + rw - Math.sin(an) * rw - 0.3, g + H + 0.8 + rw + Math.sin(an) * rw + 0.3, DARK);
				}
			}
			// zastrzał: belka od szczytu skośnie w dół, w stronę maszynowni
			for (const v of [-b1 * 0.8, b1 * 0.8]) {
				const [sx0, sz0] = rot(b1, v), [sx1, sz1] = rot(H * 0.55, v * 2);
				body.strut([sx0, g + H * 0.95, sz0], [sx1, g - 0.5, sz1], W * 1.3, STEEL);
			}
		} else if (kind === LANDMARK.waterTower) {
			const mat = hash(x, z, 3) < 0.5 ? BRICK : CONCRETE;
			const rs = Math.max(2.2, H * 0.11), rt = rs * 2.3;
			body.tube(x, z, g - 1, g + H * 0.68, rs * 1.15, rs, 12, mat, false);
			body.tube(x, z, g + H * 0.68, g + H * 0.74, rs, rt, 16, mat, false);
			body.tube(x, z, g + H * 0.74, g + H * 0.93, rt, rt, 16, mat, false);
			body.tube(x, z, g + H * 0.93, g + H, rt * 1.03, 0.4, 16, DARK, false);
		} else if (kind === LANDMARK.mast) {
			// trzy nogi kratownicy (belki) w czerwono-białych odcinkach co 1/7 wysokości
			const r0 = Math.max(1.2, H * 0.012), W = Math.max(0.35, H * 0.004), seg = H / 7;
			for (let k = 0; k < 3; k++) {
				const a = (k / 3) * Math.PI * 2 + hash(x, z, 4);
				const lx = x + Math.cos(a) * r0, lz = z + Math.sin(a) * r0;
				for (let j = 0; j < 7; j++) body.beam(lx - 0.01, lz, lx + 0.01, lz, W, g - 0.5 + j * seg, g + (j + 1) * seg, j % 2 ? WHITE : RED);
			}
			for (let y = seg / 2; y < H; y += seg / 2) {
				for (let k = 0; k < 3; k++) {
					const a0 = (k / 3) * Math.PI * 2 + hash(x, z, 4), a1 = ((k + 1) / 3) * Math.PI * 2 + hash(x, z, 4);
					body.beam(x + Math.cos(a0) * r0, z + Math.sin(a0) * r0, x + Math.cos(a1) * r0, z + Math.sin(a1) * r0, W * 0.5, g + y - W * 0.25, g + y + W * 0.25, WHITE);
				}
			}
			for (const y of beaconHeights(H)) beacons.push([x, g + y + 1, z]);
		} else if (kind === LANDMARK.crane) towerCrane(body, beacons, x, z, g, H, hash(x, z, 6) * Math.PI * 2);
	}
	// place budowy: 1–3 dźwigi wieżowe w losowych miejscach wewnątrz (od ~0,2 ha)
	for (const ring of osm.construction ?? []) {
		const box = bbox(ring), area = (box[2] - box[0]) * (box[3] - box[1]) / 100;
		if (area < 2000) continue;
		const n = Math.min(3, 1 + Math.floor(area / 9000));
		for (let k = 0, placed = 0; k < 12 && placed < n; k++) {
			const x = (box[0] + hash(box[0], box[1], k) * (box[2] - box[0])) / 10, z = (box[1] + hash(box[1], box[0], k + 9) * (box[3] - box[1])) / 10;
			if (!pointInRing(ring, x * 10, z * 10)) continue;
			const g = heightAt(x, z);
			if (!Number.isFinite(g)) continue;
			towerCrane(body, beacons, x, z, g, 35 + hash(x, z, 7) * 25, hash(z, x, 8) * Math.PI * 2);
			placed++;
		}
	}
	solarPanels(body, osm.solar ?? [], heightAt);
	for (const [drag, line] of osm.aerialways ?? []) skiLift(body, line, drag, heightAt);
	airport(body, osm, heightAt);
	// ręczne przepisy znanych budowli (src/gen/recipes.js)
	buildRecipes(body, beacons, recipes, heightAt, buildings);
	const F = (a) => new Float32Array(a);
	return {
		body: body.arrays(),
		rotor: { pos: F(R.pos), nrm: F(R.nrm), col: F(R.col), top: F(R.top), spin: F(R.spin), idx: new Uint32Array(R.idx), count: R.count },
		beacons,
		smoke: new Float32Array(smoke),
	};
}

const bbox = (ring) => {
	let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
	for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
	return [x0, z0, x1, z1];
};

/** Dźwig wieżowy: żółty trzon, wysięgnik z wózkiem, przeciwwysięgnik z balastem, kabina, iglica z odciągami. */
function towerCrane(body, beacons, x, z, g, H, a) {
	const ca = Math.cos(a), sa = Math.sin(a), L = H * 0.95, C = H * 0.3;
	body.beam(x - 0.8, z, x + 0.8, z, 1.6, g - 0.5, g + H, YELLOW);
	body.beam(x - 2.5, z, x + 2.5, z, 5, g - 0.5, g + 1, GREY); // fundament
	const tip = [x + ca * L, z + sa * L], back = [x - ca * C, z - sa * C];
	body.beam(back[0], back[1], tip[0], tip[1], 1.2, g + H, g + H + 1.4, YELLOW);
	body.beam(back[0], back[1], x - ca * (C - 4), z - sa * (C - 4), 2.4, g + H - 1.5, g + H + 0.6, GREY); // balast
	body.beam(x + ca * 1, z + sa * 1, x + ca * 3.5, z + sa * 3.5, 2.2, g + H - 2.6, g + H, [0.7, 0.7, 0.68]); // kabina
	body.strut([x, g + H + 1.4, z], [x, g + H + 7, z], 0.8, YELLOW); // iglica
	body.strut([x, g + H + 7, z], [tip[0], g + H + 1.4, tip[1]], 0.12, DARK);
	body.strut([x, g + H + 7, z], [back[0], g + H + 1.4, back[1]], 0.12, DARK);
	const tr = 0.45 + ((x * 0.37 + z * 0.11) % 0.4 + 0.4) % 0.4; // wózek z hakiem gdzieś na wysięgniku
	body.strut([x + ca * L * tr, g + H, z + sa * L * tr], [x + ca * L * tr, g + H * 0.45, z + sa * L * tr], 0.08, DARK);
	beacons.push([x, g + H + 7.6, z], [tip[0], g + H + 1.8, tip[1]]);
}

/** Farmy fotowoltaiczne: rzędy paneli wschód–zachód co 8 m, nachylone 25° na południe (+z), odcinki po 10 m. */
function solarPanels(body, rings, heightAt) {
	const tilt = (25 * Math.PI) / 180, D = 4, dy = D * Math.sin(tilt), dz = D * Math.cos(tilt);
	const n = [0, Math.cos(tilt), Math.sin(tilt)];
	let count = 0;
	for (const ring of rings) {
		const [x0, z0, x1, z1] = bbox(ring).map((v) => v / 10);
		for (let z = Math.ceil(z0 / 8) * 8; z < z1; z += 8) for (let x = Math.ceil(x0 / 10) * 10; x < x1; x += 10) {
			if (count > 30000) return;
			if (!pointInRing(ring, (x + 5) * 10, z * 10)) continue;
			const g = heightAt(x + 5, z);
			if (!Number.isFinite(g)) continue;
			const ys = g + 0.6, yn = ys + dy;
			body.quad([x, ys, z + dz / 2], [x + 9.6, ys, z + dz / 2], [x + 9.6, yn, z - dz / 2], [x, yn, z - dz / 2], n, PANEL);
			count++;
		}
	}
}

/** Wyciąg: podpory co ~110 m (krzesełkowy / gondola – 12 m z poprzeczką, orczyk – 8 m), liny, stacje na końcach. */
function skiLift(body, line, drag, heightAt) {
	const pts = [];
	for (let i = 0; i < line.length; i += 2) pts.push([line[i] / 10, line[i + 1] / 10]);
	if (pts.length < 2) return;
	// punkty podpór wzdłuż linii
	const poles = [pts[0]];
	let carry = 0;
	for (let i = 1; i < pts.length; i++) {
		const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
		for (let d = 110 - carry; d < L; d += 110) poles.push([ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L]);
		carry = (carry + L) % 110;
	}
	poles.push(pts[pts.length - 1]);
	const H = drag ? 8 : 12, arm = drag ? 0.6 : 2.2;
	const tops = [];
	for (let i = 0; i < poles.length; i++) {
		const [x, z] = poles[i], g = heightAt(x, z);
		if (!Number.isFinite(g)) return;
		const [px, pz] = poles[Math.min(poles.length - 1, i + 1)], [qx, qz] = poles[Math.max(0, i - 1)];
		const dx = px - qx, dz = pz - qz, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
		if (i === 0 || i === poles.length - 1) body.beam(x - nx * 4, z - nz * 4, x + nx * 4, z + nz * 4, 7, g - 0.5, g + 4.5, GREY); // stacja
		else {
			body.strut([x, g - 0.5, z], [x, g + H, z], 0.6, DARK);
			body.beam(x - nx * arm, z - nz * arm, x + nx * arm, z + nz * arm, 0.35, g + H - 0.3, g + H + 0.1, DARK);
		}
		tops.push([x, g + (i === 0 || i === poles.length - 1 ? 4 : H), z, nx, nz]);
	}
	for (let i = 1; i < tops.length; i++) {
		const [ax, ay, az, anx, anz] = tops[i - 1], [bx, by, bz, bnx, bnz] = tops[i];
		for (const s of drag ? [0] : [-1, 1]) {
			body.strut([ax + anx * arm * s, ay, az + anz * arm * s], [bx + bnx * arm * s, by, bz + bnz * arm * s], 0.12, DARK);
			if (drag) continue;
			// krzesełka / wagoniki co ~25 m pod liną
			const L = Math.hypot(bx - ax, bz - az);
			for (let d = 12; d < L; d += 25) {
				const t = d / L, cx = ax + (bx - ax) * t + anx * arm * s, cz = az + (bz - az) * t + anz * arm * s, cy = ay + (by - ay) * t;
				body.beam(cx - 0.6, cz, cx + 0.6, cz, 0.8, cy - 2.4, cy - 1.6, [0.12, 0.14, 0.2]);
			}
		}
	}
}

const ASPHALT = [0.075, 0.075, 0.08], CONCRETE_A = [0.26, 0.26, 0.25], MARK = [0.75, 0.75, 0.72], TAXI_Y = [0.55, 0.42, 0.05];
const LIVERY = [[0.05, 0.12, 0.35], [0.55, 0.06, 0.05], [0.1, 0.35, 0.6], [0.06, 0.06, 0.07], [0.7, 0.45, 0.05], [0.12, 0.4, 0.2]];

/** Pas wzdłuż linii (dm): odcinki co ~30 m, wysokość z terenu + dy; mark(d, L) – kolor odcinka (znaki). */
function strip(body, line, w, heightAt, dy, col, mark) {
	const pts = [];
	for (let i = 0; i < line.length; i += 2) pts.push([line[i] / 10, line[i + 1] / 10]);
	let total = 0;
	for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
	let run = 0;
	for (let i = 1; i < pts.length; i++) {
		const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
		const n = Math.max(1, Math.ceil(L / 30));
		for (let k = 0; k < n; k++) {
			const t0 = k / n, t1 = (k + 1) / n;
			const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
			const g = Math.max(heightAt(x0, z0), heightAt(x1, z1));
			if (!Number.isFinite(g)) continue;
			body.beam(x0, z0, x1, z1, w, g + dy - 0.3, g + dy, col, false);
			if (mark) {
				const d = run + L * (t0 + t1) / 2, m = mark(d, total);
				if (m) body.beam(x0, z0, x1, z1, m[0], g + dy, g + dy + 0.05, m[1], false);
			}
		}
		run += L;
	}
}

/** Lotnisko: pasy (asfalt, oś przerywana, „zebry” progów), drogi kołowania (żółta oś), płyty i stojące samoloty. */
function airport(body, osm, heightAt) {
	for (const [w10, line] of osm.runways ?? []) {
		const w = w10 / 10;
		strip(body, line, w, heightAt, 0.35, ASPHALT, (d, L) => (d < 60 || d > L - 60 ? [w * 0.8, MARK] : (d % 60) < 30 ? [0.9, MARK] : null));
	}
	for (const [w10, line] of osm.taxiways ?? []) strip(body, line, Math.min(25, w10 / 10), heightAt, 0.3, ASPHALT, () => [0.3, TAXI_Y]);
	for (const ring of osm.aprons ?? []) {
		const [x0, z0, x1, z1] = bbox(ring).map((v) => v / 10);
		if ((x1 - x0) * (z1 - z0) > 4e6) continue;
		for (let z = Math.floor(z0 / 20) * 20; z < z1; z += 20) for (let x = Math.floor(x0 / 20) * 20; x < x1; x += 20) {
			if (!pointInRing(ring, (x + 10) * 10, (z + 10) * 10)) continue;
			const g = heightAt(x + 10, z + 10);
			if (Number.isFinite(g)) body.quad([x, g + 0.3, z + 20], [x + 20, g + 0.3, z + 20], [x + 20, g + 0.3, z], [x, g + 0.3, z], [0, 1, 0], CONCRETE_A);
		}
		// samoloty na stanowiskach: siatka co 70 m, część zajęta (duże płyty – liniowce, małe – awionetki)
		const big = (x1 - x0) * (z1 - z0) > 25000, step = big ? 70 : 22;
		for (let z = z0 + step / 2; z < z1; z += step) for (let x = x0 + step / 2; x < x1; x += step) {
			if (hash(x, z, 11) > 0.45 || !pointInRing(ring, x * 10, z * 10)) continue;
			const g = heightAt(x, z);
			if (!Number.isFinite(g)) continue;
			placeAircraft(body, big ? 'airliner' : 'light', x, z, g + 0.3, Math.floor(hash(z, x, 12) * 4) * (Math.PI / 2), LIVERY[Math.floor(hash(x, z, 13) * LIVERY.length)]);
		}
	}
}
