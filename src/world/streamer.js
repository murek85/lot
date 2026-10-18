// Menedżer doczytywania otwartego świata: które kafle z14 są potrzebne wokół punktu (pierścień terenu i bliższy
// pierścień obiektów), kolejka „najbliższe najpierw”, pula wątków (src/world/chunkworker.js), zwalnianie kafli
// za zasięgiem, wysokość terenu w dowolnym punkcie (z siatek wczytanych kafli). Układ świata: metry względem
// początku origin (x – wschód, z – południe); przesunięcie początku – rebase().
import { lonToTileX, latToTileY, localToLonLat, lonLatToLocal } from '../geo.js';
import { GRID } from './chunkdata.js';

/** Kafle z14 w promieniu r (m) od punktu (x, z) układu origin, od najbliższego; [{ x, y, d }]. */
export function tilesAround(x, z, r, origin, Z = 14) {
	const c = localToLonLat(x, z, origin);
	const tx = lonToTileX(c.lon, Z), ty = latToTileY(c.lat, Z);
	// rozmiar kafla w metrach (szerokość geograficzna punktu)
	const tileM = (40075016.7 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** Z;
	const n = Math.ceil(r / tileM) + 1;
	const out = [];
	for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
		const ix = Math.floor(tx) + i, iy = Math.floor(ty) + j;
		const d = Math.hypot((ix + 0.5 - tx) * tileM, (iy + 0.5 - ty) * tileM);
		if (d <= r + tileM * 0.71) out.push({ x: ix, y: iy, d });
	}
	return out.sort((a, b) => a.d - b.d);
}

/**
 * Wysokość dokładnie na siatce terenu kafla (po trójkątach, jak rysuje GPU: przekątna od (i+1, j) do (i, j+1)) –
 * na niej kładziemy drogi i budynki, żeby nie chowały się pod garbami między wierzchołkami.
 */
export function gridHeightAt(ch, x, z) {
	const f = ch.frame, H = ch.heights;
	const fx = Math.min(GRID - 1.0001, Math.max(0, ((x - f.x0) / f.w) * (GRID - 1)));
	const fz = Math.min(GRID - 1.0001, Math.max(0, ((z - f.z0) / f.h) * (GRID - 1)));
	const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
	const a = H[j * GRID + i], b = H[j * GRID + i + 1], c = H[(j + 1) * GRID + i], d = H[(j + 1) * GRID + i + 1];
	return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export class WorldStreamer {
	/**
	 * origin – { lon, lat } początku układu; opts: { radius (teren, m), objectRadius (obiekty, m), workers,
	 * onLoad(chunk), onUnload(chunk), onObjects(chunk, on) }.
	 */
	constructor(origin, opts = {}) {
		this.origin = { ...origin };
		this.radius = opts.radius ?? 9000;
		this.objectRadius = opts.objectRadius ?? 4500;
		this.onLoad = opts.onLoad ?? (() => {});
		this.onUnload = opts.onUnload ?? (() => {});
		this.onObjects = opts.onObjects ?? (() => {});
		this.chunks = new Map(); // "x/y" → kafel
		this.pending = new Map(); // "x/y" → numer zlecenia
		this.queue = [];
		this.req = 0;
		this.stats = { loaded: 0, ms: 0, fromCache: 0, errors: 0 };
		const n = opts.workers ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
		this.workers = Array.from({ length: n }, () => {
			const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
			w.busy = 0;
			w.onmessage = (e) => this.received(w, e.data);
			return w;
		});
	}

	/** Wywoływane co klatkę: punkt odniesienia (samolot) – ustala potrzebne kafle, zleca, zwalnia. */
	update(x, z) {
		this.center = { x, z };
		const want = tilesAround(x, z, this.radius, this.origin);
		const keep = new Set();
		this.queue = [];
		for (const t of want) {
			const k = `${t.x}/${t.y}`;
			keep.add(k);
			const ch = this.chunks.get(k);
			if (ch) {
				// obiekty tylko w bliższym pierścieniu (z zapasem przy oddalaniu – bez migotania na granicy)
				const near = t.d < this.objectRadius, far = t.d > this.objectRadius * 1.15;
				if (near && !ch.objectsOn) { ch.objectsOn = true; this.onObjects(ch, true); }
				else if (far && ch.objectsOn) { ch.objectsOn = false; this.onObjects(ch, false); }
				continue;
			}
			if (!this.pending.has(k)) this.queue.push(t);
		}
		// zwalnianie: poza zasięgiem z zapasem 25%
		const far = new Set(tilesAround(x, z, this.radius * 1.25, this.origin).map((t) => `${t.x}/${t.y}`));
		for (const [k, ch] of this.chunks) {
			if (far.has(k)) continue;
			if (ch.objectsOn) this.onObjects(ch, false);
			this.onUnload(ch);
			this.chunks.delete(k);
		}
		this.dispatch();
		void keep;
	}

	dispatch() {
		for (const w of this.workers) {
			while (w.busy < 2 && this.queue.length) {
				const t = this.queue.shift();
				const k = `${t.x}/${t.y}`;
				const req = ++this.req;
				this.pending.set(k, req);
				w.busy++;
				w.postMessage({ type: 'chunk', req, x: t.x, y: t.y, origin: this.origin });
			}
		}
	}

	received(w, d) {
		w.busy--;
		const k = d.key;
		if (this.pending.get(k) !== d.req) { this.dispatch(); return; } // nieaktualne (np. po zmianie początku)
		this.pending.delete(k);
		if (d.type === 'error') { this.stats.errors++; console.warn('Kafel', k, d.message); this.dispatch(); return; }
		const ch = { ...d, objectsOn: false };
		this.chunks.set(k, ch);
		this.stats.loaded++; this.stats.ms += d.ms; if (d.cached) this.stats.fromCache++;
		this.onLoad(ch);
		// od razu obiekty, jeśli kafel jest blisko
		if (this.center) {
			const cx = ch.frame.x0 + ch.frame.w / 2, cz = ch.frame.z0 + ch.frame.h / 2;
			if (Math.hypot(cx - this.center.x, cz - this.center.z) < this.objectRadius) { ch.objectsOn = true; this.onObjects(ch, true); }
		}
		this.dispatch();
	}

	/** Kafel w punkcie (x, z) albo null. */
	chunkAt(x, z) {
		const c = localToLonLat(x, z, this.origin);
		return this.chunks.get(`${Math.floor(lonToTileX(c.lon, 14))}/${Math.floor(latToTileY(c.lat, 14))}`) ?? null;
	}

	/** Wysokość terenu (m n.p.m.) w punkcie – dwuliniowo z siatki kafla; poza wczytanymi – ostatnia znana / 0. */
	heightAt(x, z) {
		const ch = this.chunkAt(x, z);
		if (!ch) return this.lastHeight ?? 0;
		const h = gridHeightAt(ch, x, z);
		this.lastHeight = h;
		return h;
	}

	/** Klasa pokrycia (COVER) w punkcie – z rastra kafla; poza wczytanymi – null. */
	coverAt(x, z) {
		const ch = this.chunkAt(x, z);
		if (!ch) return null;
		const f = ch.frame, R = Math.sqrt(ch.cover.length);
		const i = Math.min(R - 1, Math.max(0, Math.floor(((x - f.x0) / f.w) * R))), j = Math.min(R - 1, Math.max(0, Math.floor(((z - f.z0) / f.h) * R)));
		return ch.cover[j * R + i];
	}

	/** Ile kafli brakuje w promieniu r wokół punktu (do ekranu wczytywania). */
	missing(x, z, r) {
		return tilesAround(x, z, r, this.origin).filter((t) => !this.chunks.has(`${t.x}/${t.y}`)).length;
	}

	/**
	 * Nowy początek układu (lon, lat): wszystkie kafle wczytywane od nowa (dane w IndexedDB – szybko); zwraca
	 * przesunięcie (dx, dz), o które trzeba przesunąć samolot i kamerę.
	 */
	rebase(lon, lat) {
		const p = lonLatToLocal(lon, lat, this.origin);
		for (const ch of this.chunks.values()) { if (ch.objectsOn) this.onObjects(ch, false); this.onUnload(ch); }
		this.chunks.clear();
		this.pending.clear();
		this.queue = [];
		this.origin = { lon, lat };
		return { dx: -p.x, dz: -p.z };
	}

	dispose() { for (const w of this.workers) w.terminate(); }
}
