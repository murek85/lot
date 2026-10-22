// Zgrubne okno rzeźby wokół kamery dla cieni terenu otwartego świata (src/world/chunkview.js – rayShadow, cavity):
// tekstura RG (połowa precyzji) o boku SIZE metrów, adresowana w kółko (RepeatWrapping, uv = xz / SIZE), jak okno
// gruntu drzew 3D (src/world/window.js), ale ~10 razy większe i rzadsze: cienie gór sięgają kilku kilometrów.
// Kanały: R – gęstość lasu (z rastra pokrycia kafla), G – wysokość terenu względem `base`, B – 1, gdy piksel ma dane
// (bez kafla – 0: shader pomija go, zamiast widzieć teren na poziomie `base`), A – wysokość wygładzona w promieniu
// ~500 m względem `base` (poziom okolicy: dna dolin leżą pod nim – tam zbiera się poranna mgła, src/post.js).
// Dane z kafli bliskich
// (z14), a gdzie ich nie ma – z kafli dalekiego terenu (z11). Przesunięcie początku układu (14 080 m, nie wielokrotność
// SIZE) – okno od nowa.
import { DataTexture, RGBAFormat, HalfFloatType, LinearFilter, RepeatWrapping, DataUtils } from 'three/webgpu';
import { COVER } from '../gen/terrain.js';
import { gridHeightAt } from './streamer.js';

export const SIZE = 28160; // m – ±14 km wokół kamery
export const RES = 512; // 55 m na piksel
const CELL = SIZE / RES;
const STEP = 1100; // m – okno przesuwa się skokami (wielokrotność CELL)
/** Odległość od środka okna (m), do której dane są ważne – dalej cieni nie liczymy (zapas na krok przesunięcia). */
export const REACH = SIZE / 2 - STEP - CELL;
const toHalf = DataUtils.toHalfFloat;
const BLUR = 9; // promień wygładzania (piksele): okno 19 × 55 m ≈ 1 km
const BLUR_ROWS = 48; // wierszy (albo kolumn) wygładzania na klatkę

/** Gęstość lasu w punkcie kafla (raster pokrycia dowolnej rozdzielczości), dwuliniowo. */
function forestAt(ch, x, z) {
	const c = ch.cover;
	if (!c) return 0;
	const f = ch.frame, R = Math.round(Math.sqrt(c.length));
	const u = Math.min(R - 1, Math.max(0, ((x - f.x0) / f.w) * R - 0.5)), v = Math.min(R - 1, Math.max(0, ((z - f.z0) / f.h) * R - 0.5));
	const i = Math.min(R - 2, Math.floor(u)), j = Math.min(R - 2, Math.floor(v)), a = u - i, b = v - j;
	const F = (k) => (c[k] === COVER.forest ? 1 : 0);
	const k = j * R + i;
	return (F(k) * (1 - a) + F(k + 1) * a) * (1 - b) + (F(k + R) * (1 - a) + F(k + R + 1) * a) * b;
}

export class ReliefWindow {
	/** near, far – WorldStreamer kafli bliskich i dalekiego terenu (chunkAt). */
	constructor(near, far) {
		this.near = near;
		this.far = far;
		this.data = new Uint16Array(RES * RES * 4);
		this.tex = new DataTexture(this.data, RES, RES, RGBAFormat, HalfFloatType);
		this.tex.wrapS = this.tex.wrapT = RepeatWrapping;
		this.tex.minFilter = this.tex.magFilter = LinearFilter;
		this.tex.generateMipmaps = false;
		this.tex.needsUpdate = true;
		this.base = 0;
		this.ox = null; // lewy górny róg okna (m, wielokrotność STEP)
		this.oz = null;
		this.cx = 0; // środek okna (do sprawdzania zasięgu w shaderze)
		this.cz = 0;
		this.dirty = [];
		this.stats = { ms: 0, texels: 0 };
		// kopie wysokości i znacznika danych do wygładzania (bez dekodowania połowy precyzji)
		this.h = new Float32Array(RES * RES);
		this.ok = new Uint8Array(RES * RES);
		this.rowH = new Float32Array(RES * RES); // po przebiegu poziomym: suma ważona i suma wag
		this.rowW = new Float32Array(RES * RES);
		this.blur = null; // { pass: 'rows' | 'cols', at } – wygładzanie w toku, rozłożone na klatki
		this.changed = false;
		this.smoothed = false; // kanał A policzony dla obecnego okna (do tego czasu bez mgły)
	}

	corner(x, z) { return [Math.floor((x - SIZE / 2) / STEP) * STEP, Math.floor((z - SIZE / 2) / STEP) * STEP]; }

	/** Co klatkę: przesunięcie okna (pasy do przepisania) i zaległe prostokąty – z limitem czasu (3 ms). */
	update(x, z) {
		const [nx, nz] = this.corner(x, z);
		if (this.ox === null || Math.abs(nx - this.ox) >= SIZE || Math.abs(nz - this.oz) >= SIZE) {
			this.ox = nx; this.oz = nz;
			this.base = this.near.heightAt(x, z);
			this.dirty = [[nx, nx + SIZE, nz, nz + SIZE]];
			this.smoothed = false;
			this.blur = null;
		} else if (nx !== this.ox || nz !== this.oz) {
			if (nx > this.ox) this.dirty.push([this.ox + SIZE, nx + SIZE, nz, nz + SIZE]);
			if (nx < this.ox) this.dirty.push([nx, this.ox, nz, nz + SIZE]);
			if (nz > this.oz) this.dirty.push([nx, nx + SIZE, this.oz + SIZE, nz + SIZE]);
			if (nz < this.oz) this.dirty.push([nx, nx + SIZE, nz, this.oz]);
			this.ox = nx; this.oz = nz;
		}
		this.cx = this.ox + SIZE / 2;
		this.cz = this.oz + SIZE / 2;
		if (!this.dirty.length) { this.smoothStep(); return; }
		const t0 = performance.now();
		let n = 0;
		while (this.dirty.length && performance.now() - t0 < 3) {
			// duże prostokąty po pasach – limit czasu działa też przy pierwszym wypełnieniu całego okna
			const [xa, xb, za, zb] = this.dirty.shift();
			const zm = Math.min(zb, za + CELL * 16);
			n += this.fill(xa, xb, za, zm);
			if (zm < zb) this.dirty.unshift([xa, xb, zm, zb]);
		}
		this.stats.ms = performance.now() - t0;
		this.stats.texels = n;
		this.tex.needsUpdate = true;
		this.changed = true;
	}

	/**
	 * Wygładzona wysokość (kanał A) – gdy okno jest wypełnione, a coś się zmieniło: przesuwna suma ważona w poziomie,
	 * potem w pionie (adresowanie w kółko jak tekstura), po BLUR_ROWS wierszy na klatkę.
	 */
	smoothStep() {
		if (!this.blur) {
			if (!this.changed) return;
			this.changed = false;
			this.blur = { pass: 'rows', at: 0 };
		}
		const B = this.blur, N = RES, r = BLUR;
		const end = Math.min(N, B.at + BLUR_ROWS);
		if (B.pass === 'rows') {
			for (let j = B.at; j < end; j++) {
				let sh = 0, sw = 0;
				const row = j * N;
				for (let k = -r; k <= r; k++) { const i = (k + N) % N; if (this.ok[row + i]) { sh += this.h[row + i]; sw++; } }
				for (let i = 0; i < N; i++) {
					this.rowH[row + i] = sh; this.rowW[row + i] = sw;
					const out = row + ((i - r + N) % N), inn = row + ((i + r + 1) % N);
					if (this.ok[out]) { sh -= this.h[out]; sw--; }
					if (this.ok[inn]) { sh += this.h[inn]; sw++; }
				}
			}
		} else {
			const d = this.data;
			for (let i = B.at; i < end; i++) {
				let sh = 0, sw = 0;
				for (let k = -r; k <= r; k++) { const q = ((k + N) % N) * N + i; sh += this.rowH[q]; sw += this.rowW[q]; }
				for (let j = 0; j < N; j++) {
					const q = j * N + i;
					d[q * 4 + 3] = toHalf(sw > 0 ? sh / sw : this.h[q]);
					const out = ((j - r + N) % N) * N + i, inn = ((j + r + 1) % N) * N + i;
					sh += this.rowH[inn] - this.rowH[out]; sw += this.rowW[inn] - this.rowW[out];
				}
			}
		}
		B.at = end;
		if (B.at >= N) {
			if (B.pass === 'rows') { B.pass = 'cols'; B.at = 0; }
			else { this.blur = null; this.smoothed = true; this.tex.needsUpdate = true; }
		}
	}

	/** Nowy początek układu – okno od nowa (przesunięcie nie jest wielokrotnością SIZE). */
	shift() {
		this.ox = null;
		this.dirty = [];
		this.blur = null;
	}

	/** Nowy kafel (bliski albo daleki): jego prostokąt (część w oknie) do przepisania. */
	chunkLoaded(ch) {
		if (this.ox === null) return;
		const f = ch.frame;
		const xa = Math.max(this.ox, f.x0), xb = Math.min(this.ox + SIZE, f.x0 + f.w), za = Math.max(this.oz, f.z0), zb = Math.min(this.oz + SIZE, f.z0 + f.h);
		if (xa < xb && za < zb) this.dirty.push([xa, xb, za, zb]);
	}

	/** Przepisanie pikseli, których środki leżą w [xa, xb) × [za, zb) i w oknie; zwraca liczbę pikseli. */
	fill(xa, xb, za, zb) {
		xa = Math.max(xa, this.ox); xb = Math.min(xb, this.ox + SIZE); za = Math.max(za, this.oz); zb = Math.min(zb, this.oz + SIZE);
		const i0 = Math.ceil(xa / CELL - 0.5), i1 = Math.ceil(xb / CELL - 0.5), j0 = Math.ceil(za / CELL - 0.5), j1 = Math.ceil(zb / CELL - 0.5);
		const d = this.data, H0 = toHalf(0), H1 = toHalf(1);
		let ch = null, near = false, n = 0;
		const inside = (c, x, z) => c && x >= c.frame.x0 && x < c.frame.x0 + c.frame.w && z >= c.frame.z0 && z < c.frame.z0 + c.frame.h;
		for (let j = j0; j < j1; j++) {
			const z = (j + 0.5) * CELL, tj = ((j % RES) + RES) % RES;
			for (let i = i0; i < i1; i++) {
				const x = (i + 0.5) * CELL, ti = ((i % RES) + RES) % RES, k = (tj * RES + ti) * 4;
				// kafel bliski ma pierwszeństwo – daleki (większy) sprawdzany ponownie w każdym pikselu
				if (!near || !inside(ch, x, z)) {
					const c = this.near.chunkAt(x, z);
					near = !!c;
					ch = c ?? this.far.chunkAt(x, z);
				}
				n++;
				const q = k >> 2;
				if (!ch) { d[k] = H0; d[k + 1] = H0; d[k + 2] = H0; this.ok[q] = 0; this.h[q] = 0; continue; }
				const hh = gridHeightAt(ch, x, z) - this.base;
				d[k] = toHalf(forestAt(ch, x, z));
				d[k + 1] = toHalf(hh);
				d[k + 2] = H1;
				this.ok[q] = 1; this.h[q] = hh;
			}
		}
		return n;
	}
}
