// Geometria punktów orientacyjnych z kafli (src/gen/osmtags.js: landmarkInfo) – bez Three.js, w wątku kafli:
//   – elektrownia wiatrowa: biała wieża stożkowa; gondola z wirnikiem osobno (rotor) – obraca się w shaderze
//     (src/landmarks.js) i ustawia pod wiatr;
//   – komin: smukły stożek z cegły albo betonu, wysokie – w czerwono-białe pasy u góry;
//   – wieża szybowa: stalowa kratownica z kołami linowymi na szczycie i zastrzałem (Śląsk);
//   – wieża ciśnień: trzon i zbiornik („grzybek”) ze stożkowym dachem;
//   – maszt: smukła kratownica w czerwono-białe odcinki.
// Do tego światła przeszkodowe (beacons) jak na kominach z obrysów budynków.
import { GeoArrays } from '../gfx/geobuilder.js';
import { LANDMARK } from './osmtags.js';
import { beaconHeights } from '../gfx/structures.js';

const WHITE = [0.78, 0.79, 0.8], RED = [0.55, 0.08, 0.05], BRICK = [0.36, 0.17, 0.11], CONCRETE = [0.48, 0.47, 0.44];
const STEEL = [0.3, 0.12, 0.08], DARK = [0.16, 0.16, 0.17];

const hash = (x, z, k) => {
	const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
	return s - Math.floor(s);
};

/**
 * list – [rodzaj, x, z (dm), wysokość (dm), wirnik (dm)] z kafla; heightAt(x, z) – teren. Zwraca { body: tablice
 * zbieracza, rotor: { pos, nrm, col, top, spin, idx, count } (współrzędne lokalne względem szczytu wieży, oś wirnika
 * +z), beacons: [[x, y, z]] }.
 */
export function landmarkArrays(list, heightAt) {
	const body = new GeoArrays();
	const R = { pos: [], nrm: [], col: [], top: [], spin: [], idx: [], count: 0 };
	const beacons = [];
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
		if (!Number.isFinite(g)) continue;
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
		}
	}
	const F = (a) => new Float32Array(a);
	return {
		body: body.arrays(),
		rotor: { pos: F(R.pos), nrm: F(R.nrm), col: F(R.col), top: F(R.top), spin: F(R.spin), idx: new Uint32Array(R.idx), count: R.count },
		beacons,
	};
}
