// Menedżer doczytywania otwartego świata: które kafle z14 są potrzebne wokół punktu (pierścień terenu i bliższy
// pierścień obiektów), kolejka „najbliższe najpierw”, pula wątków (src/world/chunkworker.js), zwalnianie kafli
// za zasięgiem, wysokość terenu w dowolnym punkcie (z siatek wczytanych kafli). Układ świata: metry względem
// początku origin (x – wschód, z – południe); przesunięcie początku – rebase().
import { lonToTileX, latToTileY, localToLonLat, EARTH_RADIUS } from '../geo.js';
import { GRID, CHUNK_Z, shiftOsm } from './chunkdata.js';

/** Kafle z14 w promieniu r (m) od punktu (x, z) układu origin, od najbliższego; [{ x, y, d, dx, dz }] (dx, dz – środek kafla względem punktu). */
export function tilesAround(x, z, r, origin, Z = 14) {
	const c = localToLonLat(x, z, origin);
	const tx = lonToTileX(c.lon, Z), ty = latToTileY(c.lat, Z);
	// rozmiar kafla w metrach (szerokość geograficzna punktu)
	const tileM = (2 * Math.PI * EARTH_RADIUS * (origin.merc ? origin.merc.k : Math.cos((c.lat * Math.PI) / 180))) / 2 ** Z;
	const n = Math.ceil(r / tileM) + 1;
	const out = [];
	for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
		const ix = Math.floor(tx) + i, iy = Math.floor(ty) + j;
		const dx = (ix + 0.5 - tx) * tileM, dz = (iy + 0.5 - ty) * tileM, d = Math.hypot(dx, dz);
		if (d <= r + tileM * 0.71) out.push({ x: ix, y: iy, d, dx, dz });
	}
	return out.sort((a, b) => a.d - b.d);
}

/**
 * Wysokość dokładnie na siatce terenu kafla (po trójkątach, jak rysuje GPU: przekątna od (i+1, j) do (i, j+1)) –
 * na niej kładziemy drogi i budynki, żeby nie chowały się pod garbami między wierzchołkami.
 */
export function gridHeightAt(ch, x, z) {
	const f = ch.frame, H = ch.heights, G = ch.n ?? GRID;
	const fx = Math.min(G - 1.0001, Math.max(0, ((x - f.x0) / f.w) * (G - 1)));
	const fz = Math.min(G - 1.0001, Math.max(0, ((z - f.z0) / f.h) * (G - 1)));
	const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
	const a = H[j * G + i], b = H[j * G + i + 1], c = H[(j + 1) * G + i], d = H[(j + 1) * G + i + 1];
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
		this.Z = opts.z ?? CHUNK_Z; // poziom kafli (daleki teren – FAR_Z)
		this.onLoad = opts.onLoad ?? (() => {});
		this.onUnload = opts.onUnload ?? (() => {});
		this.onObjects = opts.onObjects ?? (() => {});
		this.chunks = new Map(); // "x/y" → kafel
		this.pending = new Map(); // "x/y" → numer zlecenia
		this.queue = [];
		this.req = 0;
		this.objReq = new Map(); // zlecenia obiektów kafla (budynki, drogi) → resolve
		this.stats = { loaded: 0, ms: 0, fromCache: 0, errors: 0 };
		const n = opts.workers ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
		this.workers = Array.from({ length: n }, () => {
			const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
			w.busy = 0;
			w.onmessage = (e) => this.received(w, e.data);
			return w;
		});
	}

	/**
	 * Wywoływane co klatkę: punkt odniesienia (samolot) i jego prędkość (m/s) – ustala potrzebne kafle, zleca,
	 * zwalnia. Z prędkością kafle doczytywane są też wokół punktu wyprzedzenia (25 s lotu, do 3 km), a te przed
	 * samolotem mają pierwszeństwo – szybka maszyna nie wlatuje w niewczytany teren.
	 */
	update(x, z, vx = 0, vz = 0) {
		this.center = { x, z };
		const sp = Math.hypot(vx, vz), lead = Math.min(3000, sp * 25);
		const lx = sp > 1 ? (vx / sp) * lead : 0, lz = sp > 1 ? (vz / sp) * lead : 0;
		const want = tilesAround(x, z, this.radius + lead, this.origin, this.Z)
			.filter((t) => t.d <= this.radius + 1e-6 || Math.hypot(t.dx - lx, t.dz - lz) <= this.radius)
			// pierwszeństwo: bliżej samolotu, a z przodu – jakby o 40% bliżej
			.map((t) => ({ ...t, score: t.d - (lead > 0 ? 0.4 * Math.max(0, (t.dx * lx + t.dz * lz) / lead) : 0) }))
			.sort((a, b) => a.score - b.score);
		this.queue = [];
		for (const t of want) {
			const k = `${t.x}/${t.y}`;
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
		// zwalnianie: poza zasięgiem z zapasem 25% (od samolotu i od punktu wyprzedzenia)
		const keep = new Set(tilesAround(x, z, this.radius * 1.25 + lead, this.origin, this.Z)
			.filter((t) => t.d <= this.radius * 1.25 || Math.hypot(t.dx - lx, t.dz - lz) <= this.radius * 1.25)
			.map((t) => `${t.x}/${t.y}`));
		for (const [k, ch] of this.chunks) {
			if (keep.has(k)) continue;
			if (ch.objectsOn) this.onObjects(ch, false);
			this.onUnload(ch);
			this.chunks.delete(k);
		}
		this.dispatch();
	}

	dispatch() {
		for (const w of this.workers) {
			while (w.busy < 2 && this.queue.length) {
				const t = this.queue.shift();
				const k = `${t.x}/${t.y}`;
				const req = ++this.req;
				this.pending.set(k, req);
				w.busy++;
				w.postMessage({ type: 'chunk', req, x: t.x, y: t.y, z: this.Z, origin: this.origin });
			}
		}
	}

	/**
	 * Obiekty kafla (budynki i drogi w tablicach) z wątku – najmniej zajętego; Promise z odpowiedzią albo null.
	 */
	requestObjects(ch) {
		return new Promise((resolve) => {
			const w = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
			const req = ++this.req;
			this.objReq.set(req, resolve);
			w.busy++;
			w.postMessage({ type: 'objects', req, key: ch.key, x: ch.x, y: ch.y, origin: this.origin });
		});
	}

	received(w, d) {
		w.busy--;
		if (this.objReq.has(d.req)) {
			const done = this.objReq.get(d.req);
			this.objReq.delete(d.req);
			if (d.type === 'error') console.warn('Obiekty kafla', d.key, d.message);
			done(d.type === 'objects' ? d : null);
			this.dispatch();
			return;
		}
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
		return this.chunks.get(`${Math.floor(lonToTileX(c.lon, this.Z))}/${Math.floor(latToTileY(c.lat, this.Z))}`) ?? null;
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
		return tilesAround(x, z, r, this.origin, this.Z).filter((t) => !this.chunks.has(`${t.x}/${t.y}`)).length;
	}

	/**
	 * Nowy początek układu w punkcie (dx, dz) obecnego (rzut Mercatora – czyste przesunięcie): wczytane kafle
	 * przesunięte w miejscu (ramy i obiekty; siatki w scenie przesuwa onShift), zlecenia w toku – od nowa.
	 */
	rebase(dx, dz) {
		const ll = localToLonLat(dx, dz, this.origin);
		this.origin = { lon: ll.lon, lat: ll.lat, merc: this.origin.merc };
		for (const ch of this.chunks.values()) {
			ch.frame.x0 -= dx; ch.frame.z0 -= dz;
			shiftOsm(ch.osm, dx, dz);
		}
		this.pending.clear();
		this.queue = [];
		if (this.center) this.center = { x: this.center.x - dx, z: this.center.z - dz };
	}

	dispose() { for (const w of this.workers) w.terminate(); }
}
