// Mapa otwartego świata (minimapa i duża mapa): zamiast jednej mapy bazowej regionu – płytki mapy z kafli (pokrycie
// w barwach mapy, cieniowanie rzeźby, cieki, drogi, tory), rysowane po jednej na klatkę i pamiętane (ostatnio
// używane) także po zwolnieniu kafla – przeleciany obszar zostaje na mapie. Do tego nazwy miejscowości zbierane
// z kafli (mapy, opis położenia, podpisy w krajobrazie).
import { MAP_COLORS } from '../ui/minimap.js';
import { PLACE_ORDER } from '../gen/convert.js';
import { COVER_RES, GRID } from './chunkdata.js';

export const TILE_PX = 192;
const MAX_TILES = 400;
const REGION_M_PER_PX = 46000 / 4096; // grubości linii jak na mapie bazowej regionu 46 km

/**
 * Nazwy miejscowości z kafla dopisane do listy (kolejność ważności: miasta, miasteczka, wsie…; bez powtórzeń –
 * ta sama nazwa bliżej niż 2 km). Zwraca liczbę dopisanych.
 */
export function addPlaces(list, places) {
	let n = 0;
	for (const p of places) {
		const o = PLACE_ORDER[p.cls];
		if (o == null || !p.name) continue;
		if (list.some((q) => q.name === p.name && Math.hypot(q.x - p.x, q.z - p.z) < 2000)) continue;
		let i = list.length;
		while (i > 0 && (PLACE_ORDER[list[i - 1].cls] ?? 9) > o) i--;
		list.splice(i, 0, { name: p.name, cls: p.cls, x: p.x, z: p.z });
		n++;
	}
	return n;
}

/** Płytka mapy kafla: płótno TILE_PX² (wiersz 0 – północ). */
function drawTile(ch) {
	const n = TILE_PX, f = ch.frame;
	const cv = new OffscreenCanvas(n, n);
	const ctx = cv.getContext('2d');
	const img = ctx.createImageData(n, n);
	const H = ch.heights, cellX = f.w / (GRID - 1), cellZ = f.h / (GRID - 1);
	for (let j = 0; j < n; j++) {
		const cj = Math.min(COVER_RES - 1, Math.floor((j / n) * COVER_RES));
		const gj = Math.min(GRID - 2, Math.max(1, Math.round((j / n) * (GRID - 1))));
		for (let i = 0; i < n; i++) {
			const ci = Math.min(COVER_RES - 1, Math.floor((i / n) * COVER_RES));
			const gi = Math.min(GRID - 2, Math.max(1, Math.round((i / n) * (GRID - 1))));
			const col = MAP_COLORS[ch.cover[cj * COVER_RES + ci]] ?? MAP_COLORS[0];
			// cieniowanie od płn.-zach., jak na mapie bazowej regionu (wzmocnione – większość Polski jest płaska)
			const dx = (H[gj * GRID + gi + 1] - H[gj * GRID + gi - 1]) / (2 * cellX), dz = (H[(gj + 1) * GRID + gi] - H[(gj - 1) * GRID + gi]) / (2 * cellZ);
			const shade = Math.max(0.55, Math.min(1.25, 1 - (dx + dz) * 2.2 * 1.5));
			const k = (j * n + i) * 4;
			img.data[k] = col[0] * shade; img.data[k + 1] = col[1] * shade; img.data[k + 2] = col[2] * shade; img.data[k + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	const sx = n / f.w, sz = n / f.h;
	const line = (c) => {
		ctx.beginPath();
		ctx.moveTo((c[0] / 10 - f.x0) * sx, (c[1] / 10 - f.z0) * sz);
		for (let i = 2; i < c.length; i += 2) ctx.lineTo((c[i] / 10 - f.x0) * sx, (c[i + 1] / 10 - f.z0) * sz);
		ctx.stroke();
	};
	ctx.lineCap = ctx.lineJoin = 'round';
	const sc = (2 * REGION_M_PER_PX) / (f.w / n); // grubości linii jak przy mapie bazowej regionu
	const lw = (w) => w * sc;
	const osm = ch.osm;
	ctx.strokeStyle = 'rgb(110,160,210)';
	for (const [w10, c] of osm.waterways) { if (w10 < 25) continue; ctx.lineWidth = lw(w10 >= 60 ? 1.6 : 0.8); line(c); }
	const roads = osm.roads.filter((r) => r[0] <= 4).sort((a, b) => b[0] - a[0]);
	ctx.strokeStyle = 'rgba(255,255,255,0.75)';
	ctx.lineWidth = lw(0.9);
	for (const r of roads) if (r[0] === 4) line(r[5]);
	const MAIN = [[3.6, 'rgb(150,60,40)', 'rgb(240,120,70)'], [2.8, 'rgb(150,100,40)', 'rgb(250,190,90)'], [2.2, 'rgb(150,130,60)', 'rgb(250,225,120)'], [1.6, 'rgb(130,130,120)', 'rgb(255,255,255)']];
	for (const pass of [1, 2]) for (const r of roads) {
		if (r[0] > 3) continue;
		const [w, edge, fill] = MAIN[r[0]];
		ctx.strokeStyle = pass === 1 ? edge : fill;
		ctx.lineWidth = lw(pass === 1 ? w + 1 : w);
		line(r[5]);
	}
	ctx.strokeStyle = 'rgb(60,60,70)';
	ctx.lineWidth = lw(1.4);
	ctx.setLineDash([3 * sc, 2 * sc]);
	for (const [kind, service, , , c] of osm.rails) if (kind < 2 && !service) line(c);
	return cv;
}

export class WorldMap {
	constructor() {
		this.tiles = new Map(); // "x/y" → { frame, canvas } (ostatnio używane na końcu)
		this.queue = [];
		this.labels = []; // miejscowości z kafli, od najważniejszych
		this.stats = { tiles: 0, ms: 0 };
	}

	/** Nowy kafel: miejscowości od razu, płytka – w kolejce (jeśli jej jeszcze nie ma). */
	add(ch) {
		const before = new Set(this.labels);
		if (addPlaces(this.labels, ch.osm.places ?? [])) this.onPlaces?.(this.labels.filter((l) => !before.has(l)));
		if (!this.tiles.has(ch.key) && !this.queue.includes(ch)) this.queue.push(ch);
	}

	/** Co klatkę: płytki z kolejki (najbliższe samolotu najpierw), do ~3 ms. */
	update(x, z) {
		if (!this.queue.length) return;
		const t0 = performance.now();
		this.queue.sort((a, b) => Math.hypot(b.frame.x0 - x, b.frame.z0 - z) - Math.hypot(a.frame.x0 - x, a.frame.z0 - z));
		while (this.queue.length && performance.now() - t0 < 3) {
			const ch = this.queue.pop();
			if (this.tiles.has(ch.key)) continue;
			const f = ch.frame;
			this.tiles.set(ch.key, { frame: { x0: f.x0, z0: f.z0, w: f.w, h: f.h }, canvas: drawTile(ch) });
			if (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
		}
		this.stats.tiles = this.tiles.size;
		this.stats.ms = performance.now() - t0;
	}

	/** Nowy początek układu w (dx, dz): płytki i nazwy miejscowości (te same obiekty są w opisie położenia gry). */
	shift(dx, dz) {
		for (const t of this.tiles.values()) { t.frame.x0 -= dx; t.frame.z0 -= dz; }
		for (const l of this.labels) { l.x -= dx; l.z -= dz; }
	}

	/**
	 * Rysowanie płytek w układzie: punkt świata (x0, z0) w (0, 0) płótna, pxPerM pikseli na metr; r – promień widoku
	 * (m) – płytki dalej pomijane. Płytki zachodzą o pół piksela (bez szczelin między nimi).
	 */
	drawOn(ctx, x0, z0, pxPerM, r) {
		ctx.imageSmoothingEnabled = true;
		for (const t of this.tiles.values()) {
			const f = t.frame;
			if (f.x0 > x0 + r || f.x0 + f.w < x0 - r || f.z0 > z0 + r || f.z0 + f.h < z0 - r) continue;
			ctx.drawImage(t.canvas, (f.x0 - x0) * pxPerM - 0.5, (f.z0 - z0) * pxPerM - 0.5, f.w * pxPerM + 1, f.h * pxPerM + 1);
		}
	}
}

