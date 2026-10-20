// PMTiles v3 (https://github.com/protomaps/PMTiles) – wszystkie kafle w jednym pliku: nagłówek, katalog (spis kafli)
// i dane, czytane przez HTTP Range (pojedynczy kafel = jedno zapytanie o fragment pliku). Własne kafle gry trzymają
// w jednym archiwum trzy rodzaje danych – kafle wektorowe, pokrycie i wysokości – pod numerami kafli przesuniętymi
// o KIND_STEP · rodzaj (format na to pozwala: numer to dowolna liczba, katalog musi być tylko posortowany). Opis
// obszarów (jak data/tiles/lot/tiles.json) – w metadanych archiwum. Bez Three.js i DOM – zapis w narzędziu
// (tools/pack-tiles.js), odczyt w wątkach gry i w Node (testy).

export const HEADER_BYTES = 127;
/** Pierwsze zapytanie: nagłówek + katalog główny (wg specyfikacji mieszczą się w 16 KB). */
export const FIRST_BYTES = 16384;
/** Rodzaje danych w archiwum gry → przesunięcie numeru kafla (numery kafli z ≤ 14 < 2^29). */
export const KIND_STEP = 2 ** 32;
export const KINDS = { '': 0, cover: 1, height: 2 };

const COMPRESSION = { none: 1, gzip: 2 };

// --- numer kafla: krzywa Hilberta w obrębie poziomu, poziomy po kolei (jak w specyfikacji) ---
function rotate(n, xy, rx, ry) {
	if (ry === 0) {
		if (rx === 1) { xy[0] = n - 1 - xy[0]; xy[1] = n - 1 - xy[1]; }
		const t = xy[0]; xy[0] = xy[1]; xy[1] = t;
	}
}
/** Numer kafla (z, x, y) w PMTiles. */
export function zxyToTileId(z, x, y) {
	let acc = (4 ** z - 1) / 3; // kafle wszystkich niższych poziomów
	const xy = [x, y];
	for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
		const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
		acc += s * s * ((3 * rx) ^ ry);
		rotate(s, xy, rx, ry);
	}
	return acc;
}
/** Numer kafla gry: rodzaj ('' – wektorowy, 'cover', 'height') + (z, x, y). */
export const lotTileId = (kind, z, x, y) => KINDS[kind] * KIND_STEP + zxyToTileId(z, x, y);

// --- liczby: varint (do 2^53 – bez operacji bitowych powyżej 32 bitów) i liczby 64-bitowe nagłówka ---
function pushVarint(out, v) {
	while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
	out.push(v);
}
function readVarint(b, p) {
	let v = 0, mul = 1, byte;
	do { byte = b[p.i++]; v += (byte & 0x7f) * mul; mul *= 0x80; } while (byte & 0x80);
	return v;
}
const getU64 = (dv, o) => dv.getUint32(o + 4, true) * 2 ** 32 + dv.getUint32(o, true);
const setU64 = (dv, o, v) => { dv.setUint32(o, v % 2 ** 32, true); dv.setUint32(o + 4, Math.floor(v / 2 ** 32), true); };

// --- katalog: [{ id, run, offset, length }] posortowane po id; run 0 – wpis wskazuje katalog liścia ---
export function serializeDirectory(entries) {
	const out = [];
	pushVarint(out, entries.length);
	let last = 0;
	for (const e of entries) { pushVarint(out, e.id - last); last = e.id; }
	for (const e of entries) pushVarint(out, e.run);
	for (const e of entries) pushVarint(out, e.length);
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i], prev = entries[i - 1];
		pushVarint(out, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
	}
	return new Uint8Array(out);
}
export function parseDirectory(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), p = { i: 0 };
	const n = readVarint(b, p), out = new Array(n);
	let last = 0;
	for (let i = 0; i < n; i++) { last += readVarint(b, p); out[i] = { id: last, run: 0, length: 0, offset: 0 }; }
	for (let i = 0; i < n; i++) out[i].run = readVarint(b, p);
	for (let i = 0; i < n; i++) out[i].length = readVarint(b, p);
	for (let i = 0; i < n; i++) {
		const v = readVarint(b, p);
		out[i].offset = v === 0 && i > 0 ? out[i - 1].offset + out[i - 1].length : v - 1;
	}
	return out;
}
/** Wpis katalogu obejmujący kafel id (ostatni z id ≤ szukanego) albo null. */
export function findEntry(entries, id) {
	let lo = 0, hi = entries.length - 1;
	while (lo <= hi) {
		const m = (lo + hi) >> 1;
		if (entries[m].id <= id) lo = m + 1; else hi = m - 1;
	}
	const e = entries[hi];
	if (!e) return null;
	if (e.run === 0) return e; // katalog liścia – szukanie dalej w nim
	return id < e.id + e.run ? e : null;
}

// --- nagłówek ---
export function parseHeader(buf) {
	const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset ?? 0);
	const magic = String.fromCharCode(...new Uint8Array(dv.buffer, dv.byteOffset, 7));
	if (magic !== 'PMTiles' || dv.getUint8(7) !== 3) throw new Error('To nie jest plik PMTiles v3');
	return {
		rootOffset: getU64(dv, 8), rootLength: getU64(dv, 16), metadataOffset: getU64(dv, 24), metadataLength: getU64(dv, 32),
		leafOffset: getU64(dv, 40), leafLength: getU64(dv, 48), dataOffset: getU64(dv, 56), dataLength: getU64(dv, 64),
		addressed: getU64(dv, 72), entries: getU64(dv, 80), contents: getU64(dv, 88), clustered: dv.getUint8(96),
		internalCompression: dv.getUint8(97), tileCompression: dv.getUint8(98), tileType: dv.getUint8(99),
		minZoom: dv.getUint8(100), maxZoom: dv.getUint8(101),
		bounds: [dv.getInt32(102, true) / 1e7, dv.getInt32(106, true) / 1e7, dv.getInt32(110, true) / 1e7, dv.getInt32(114, true) / 1e7],
	};
}

/**
 * Archiwum z kafli: tiles – [{ id, data: Uint8Array }] (dowolna kolejność; te same dane – zapisane raz), metadata –
 * obiekt JSON, opts: { compress(bytes) → Uint8Array (gzip katalogów i metadanych), minZoom, maxZoom, bounds [w, s, e, n],
 * leafSize }. Zwraca Uint8Array całego pliku.
 */
export function writePmtiles(tiles, metadata, opts) {
	const { compress, minZoom = 0, maxZoom = 14, bounds = [-180, -85, 180, 85], leafSize = 4096 } = opts;
	const sorted = [...tiles].sort((a, b) => a.id - b.id);
	// dane: identyczne kafle (np. puste) zapisane raz
	const seen = new Map(), chunks = [], entries = [];
	let offset = 0;
	for (const t of sorted) {
		// skrót + porównanie bajtów (różne kafle o tym samym skrócie zostają osobno)
		const k = `${t.data.length}:${hashBytes(t.data)}`;
		let at = seen.get(k)?.find((c) => sameBytes(c.data, t.data));
		if (!at) {
			at = { offset, length: t.data.length, data: t.data };
			if (!seen.has(k)) seen.set(k, []);
			seen.get(k).push(at);
			chunks.push(t.data);
			offset += t.data.length;
		}
		const prev = entries[entries.length - 1];
		// kolejne numery z tymi samymi danymi – jeden wpis z długością serii
		if (prev && prev.offset === at.offset && prev.id + prev.run === t.id) prev.run++;
		else entries.push({ id: t.id, run: 1, offset: at.offset, length: at.length });
	}
	// katalog: w całości w katalogu głównym, a przy więcej niż leafSize wpisach (albo ponad 16 KB) – liście po leafSize
	let root = compress(serializeDirectory(entries)), leaves = new Uint8Array(0);
	if (entries.length > leafSize || HEADER_BYTES + root.length > FIRST_BYTES) {
		const parts = [], rootEntries = [];
		let lo = 0;
		for (let i = 0; i < entries.length; i += leafSize) {
			const leaf = compress(serializeDirectory(entries.slice(i, i + leafSize)));
			rootEntries.push({ id: entries[i].id, run: 0, offset: lo, length: leaf.length });
			parts.push(leaf);
			lo += leaf.length;
		}
		root = compress(serializeDirectory(rootEntries));
		leaves = concat(parts);
	}
	const meta = compress(new TextEncoder().encode(JSON.stringify(metadata)));
	const rootOffset = HEADER_BYTES, metadataOffset = rootOffset + root.length, leafOffset = metadataOffset + meta.length, dataOffset = leafOffset + leaves.length;
	const header = new Uint8Array(HEADER_BYTES), dv = new DataView(header.buffer);
	header.set([...'PMTiles'].map((c) => c.charCodeAt(0)), 0);
	dv.setUint8(7, 3);
	setU64(dv, 8, rootOffset); setU64(dv, 16, root.length);
	setU64(dv, 24, metadataOffset); setU64(dv, 32, meta.length);
	setU64(dv, 40, leafOffset); setU64(dv, 48, leaves.length);
	setU64(dv, 56, dataOffset); setU64(dv, 64, offset);
	setU64(dv, 72, sorted.length); setU64(dv, 80, entries.length); setU64(dv, 88, chunks.length);
	dv.setUint8(96, 0); // nie „clustered” – powtórzone dane wskazują wstecz
	dv.setUint8(97, COMPRESSION.gzip);
	dv.setUint8(98, COMPRESSION.gzip); // wszystkie rodzaje w gzip (rastry .bin.gz, kafle wektorowe pakowane przy zapisie)
	dv.setUint8(99, 0);
	dv.setUint8(100, minZoom); dv.setUint8(101, maxZoom);
	const [w, s, e, n] = bounds;
	dv.setInt32(102, Math.round(w * 1e7), true); dv.setInt32(106, Math.round(s * 1e7), true);
	dv.setInt32(110, Math.round(e * 1e7), true); dv.setInt32(114, Math.round(n * 1e7), true);
	dv.setUint8(118, maxZoom);
	dv.setInt32(119, Math.round(((w + e) / 2) * 1e7), true); dv.setInt32(123, Math.round(((s + n) / 2) * 1e7), true);
	return concat([header, root, meta, leaves, ...chunks]);
}

function concat(parts) {
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let o = 0;
	for (const p of parts) { out.set(p, o); o += p.length; }
	return out;
}
function sameBytes(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
// skrót danych kafla do wyszukania powtórzeń (FNV-1a)
function hashBytes(d) {
	let h = 0x811c9dc5;
	for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
	return h >>> 0;
}

/**
 * Odczyt archiwum przez HTTP Range: open() – nagłówek, katalog główny i metadane (jedno-dwa zapytania), get(id) –
 * dane kafla (ArrayBuffer) albo null, gdy kafla nie ma. Katalogi liści – w pamięci. read(offset, length) →
 * ArrayBuffer; gunzip(bytes) → Uint8Array. Serwer bez obsługi Range (odpowiedź 200 z całym plikiem) – błąd w open().
 */
export class PmtilesReader {
	constructor(read, gunzip) {
		this.read = read;
		this.gunzip = gunzip;
		this.leaves = new Map();
	}

	async open() {
		const first = await this.read(0, FIRST_BYTES);
		this.header = parseHeader(first);
		const h = this.header;
		const plain = async (buf) => (h.internalCompression === COMPRESSION.gzip ? this.gunzip(new Uint8Array(buf)) : new Uint8Array(buf));
		const rootBuf = h.rootOffset + h.rootLength <= first.byteLength ? first.slice(h.rootOffset, h.rootOffset + h.rootLength) : await this.read(h.rootOffset, h.rootLength);
		this.root = parseDirectory(await plain(rootBuf));
		this.metadata = h.metadataLength ? JSON.parse(new TextDecoder().decode(await plain(await this.read(h.metadataOffset, h.metadataLength)))) : {};
		this.plain = plain;
		return this;
	}

	async get(id) {
		let dir = this.root;
		for (let depth = 0; depth < 3; depth++) {
			const e = findEntry(dir, id);
			if (!e) return null;
			if (e.run > 0) return this.read(this.header.dataOffset + e.offset, e.length);
			const key = e.offset;
			if (!this.leaves.has(key)) {
				// obietnica w pamięci – równoległe kafle z tego samego liścia nie pobierają go kilka razy
				this.leaves.set(key, this.read(this.header.leafOffset + e.offset, e.length).then((b) => this.plain(b)).then(parseDirectory));
			}
			dir = await this.leaves.get(key);
		}
		return null;
	}
}

/** Odczyt fragmentu pliku przez HTTP Range (przeglądarka, wątki); serwer bez Range – błąd. */
export const rangeReader = (url) => async (offset, length) => {
	const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
	if (res.status !== 206) {
		res.body?.cancel(); // serwer bez Range odsyła cały plik – bez pobierania setek MB
		throw new Error(res.status === 200 ? `${url}: serwer nie obsługuje zapytań o fragment pliku (HTTP Range)` : `${url}: ${res.status}`);
	}
	return res.arrayBuffer();
};
