// Okno gruntu wokół kamery dla drzew 3D otwartego świata: tekstura RGBA (połowa precyzji) o boku SIZE metrów,
// adresowana w kółko (RepeatWrapping, uv = xz / SIZE) – piksel trzyma zawsze ten punkt świata, który przy danym
// położeniu okna leży w nim. Przesunięcie okna przepisuje tylko pasy, które z niego wypadły, a nowy kafel – swój
// prostokąt. Kanały: R – gęstość lasu (z rastra pokrycia kafla, dwuliniowo), G – wysokość terenu względem `base`
// (na trójkątach siatki kafla), B – maska dróg, torów i cieków (drzewa ich omijają).
import { DataTexture, RGBAFormat, HalfFloatType, LinearFilter, RepeatWrapping, DataUtils } from 'three/webgpu';
import { COVER } from '../gen/terrain.js';
import { COVER_RES, MASK_RES } from './chunkdata.js';
import { gridHeightAt } from './streamer.js';

export const SIZE = 2816; // m: zasięg drzew 3D (1100 m) + zapas na krok przesunięcia
export const RES = 512; // ≈ 5,5 m na piksel
const CELL = SIZE / RES;
const STEP = 128; // m – okno przesuwa się skokami (wielokrotność CELL)
const toHalf = DataUtils.toHalfFloat;

/** Gęstość lasu w punkcie kafla: udział klasy „las” dwuliniowo z czterech pikseli rastra pokrycia. */
export function forestDensity(ch, x, z) {
	const f = ch.frame, R = COVER_RES, c = ch.cover;
	const u = Math.min(R - 1, Math.max(0, ((x - f.x0) / f.w) * R - 0.5)), v = Math.min(R - 1, Math.max(0, ((z - f.z0) / f.h) * R - 0.5));
	const i = Math.min(R - 2, Math.floor(u)), j = Math.min(R - 2, Math.floor(v)), a = u - i, b = v - j;
	const F = (k) => (c[k] === COVER.forest ? 1 : 0);
	const k = j * R + i;
	return (F(k) * (1 - a) + F(k + 1) * a) * (1 - b) + (F(k + R) * (1 - a) + F(k + R + 1) * a) * b;
}

export class GroundWindow {
	constructor(streamer) {
		this.streamer = streamer;
		this.data = new Uint16Array(RES * RES * 4);
		this.tex = new DataTexture(this.data, RES, RES, RGBAFormat, HalfFloatType);
		this.tex.wrapS = this.tex.wrapT = RepeatWrapping;
		this.tex.minFilter = this.tex.magFilter = LinearFilter;
		this.tex.generateMipmaps = false;
		this.tex.needsUpdate = true;
		this.base = 0;
		this.ox = null; // lewy górny róg okna (m, wielokrotność STEP)
		this.oz = null;
		this.dirty = [];
		this.stats = { ms: 0, texels: 0 };
	}

	/** Zakres okna dla środka (x, z) – róg w siatce STEP. */
	corner(x, z) { return [Math.floor((x - SIZE / 2) / STEP) * STEP, Math.floor((z - SIZE / 2) / STEP) * STEP]; }

	/** Co klatkę: przesunięcie okna (pasy do przepisania) i zaległe prostokąty (nowe kafle) – z limitem czasu. */
	update(x, z) {
		const [nx, nz] = this.corner(x, z);
		if (this.ox === null || Math.abs(nx - this.ox) >= SIZE || Math.abs(nz - this.oz) >= SIZE) {
			// pierwsze ustawienie albo skok – całe okno od nowa, poziom odniesienia wysokości z punktu środka
			this.ox = nx; this.oz = nz;
			this.base = this.streamer.heightAt(x, z);
			this.dirty = [[nx, nx + SIZE, nz, nz + SIZE]];
		} else if (nx !== this.ox || nz !== this.oz) {
			// pasy, które weszły do okna (stare wartości tych pikseli należą do pasów, które z niego wyszły)
			if (nx > this.ox) this.dirty.push([this.ox + SIZE, nx + SIZE, nz, nz + SIZE]);
			if (nx < this.ox) this.dirty.push([nx, this.ox, nz, nz + SIZE]);
			if (nz > this.oz) this.dirty.push([nx, nx + SIZE, this.oz + SIZE, nz + SIZE]);
			if (nz < this.oz) this.dirty.push([nx, nx + SIZE, nz, this.oz]);
			this.ox = nx; this.oz = nz;
		}
		if (!this.dirty.length) return;
		const t0 = performance.now();
		let n = 0;
		while (this.dirty.length && (n === 0 || performance.now() - t0 < 4)) { n += this.fill(...this.dirty.shift()); }
		this.stats.ms = performance.now() - t0;
		this.stats.texels = n;
		this.tex.needsUpdate = true;
	}

	/** Nowy początek układu w (dx, dz) – wielokrotność SIZE: piksele trzymają te same miejsca, zmienia się tylko róg. */
	shift(dx, dz) {
		if (this.ox === null) return;
		this.ox -= dx; this.oz -= dz;
		this.dirty = this.dirty.map(([a, b, c, d]) => [a - dx, b - dx, c - dz, d - dz]);
	}

	/** Nowy kafel: jego prostokąt (część w oknie) do przepisania. */
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
		const d = this.data, st = this.streamer, M = MASK_RES;
		const H0 = toHalf(0);
		let ch = null, n = 0;
		for (let j = j0; j < j1; j++) {
			const z = (j + 0.5) * CELL, tj = ((j % RES) + RES) % RES;
			for (let i = i0; i < i1; i++) {
				const x = (i + 0.5) * CELL, ti = ((i % RES) + RES) % RES, k = (tj * RES + ti) * 4;
				const f = ch?.frame;
				if (!f || x < f.x0 || x >= f.x0 + f.w || z < f.z0 || z >= f.z0 + f.h) ch = st.chunkAt(x, z);
				n++;
				if (!ch) { d[k] = H0; d[k + 1] = H0; d[k + 2] = H0; continue; }
				const g = ch.frame;
				const mi = Math.min(M - 1, Math.floor(((x - g.x0) / g.w) * M)), mj = Math.min(M - 1, Math.floor(((z - g.z0) / g.h) * M));
				d[k] = toHalf(forestDensity(ch, x, z));
				d[k + 1] = toHalf(gridHeightAt(ch, x, z) - this.base);
				d[k + 2] = toHalf(ch.mask ? ch.mask[mj * M + mi] / 255 : 0);
			}
		}
		return n;
	}
}
