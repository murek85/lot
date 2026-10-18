// Magazyn generatora w IndexedDB (baza „lot-gen”):
//   tiles   – surowe kafle źródłowe (pbf OpenFreeMap, png wysokości) pod kluczem „źródło/z/x/y”: drugi region na tym
//             samym obszarze i przyszłe strumieniowanie nie pobierają ich ponownie;
//   regions – gotowe dane regionu: { id, files: { 'height.bin.gz': Blob, … } } – te same pliki co w data/regions/;
//   meta    – opisy regionów (meta.json) do listy w menu, bez ciężkich danych;
//   tileinfo – ostatnie użycie i rozmiar kafla (klucz jak w tiles) – do przycinania pamięci kafli (otwarty świat:
//             cała Polska to ~3 GB kafli, w przeglądarce trzymamy najwyżej kilkaset MB – najdawniej używane wylatują).
const DB = 'lot-gen', VERSION = 2;
const TOUCH_EVERY = 6 * 3600e3; // zapis czasu użycia najwyżej co 6 h na kafel
let dbp = null;

function open() {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const s of ['tiles', 'regions', 'meta', 'tileinfo']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
		};
		// nowsza wersja bazy w innej karcie – zamknięcie (inaczej jej uaktualnienie czeka)
		req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbp = null; }; resolve(req.result); };
		req.onerror = () => { dbp = null; reject(req.error); };
	});
	return dbp;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function tx(store, mode, fn) {
	const db = await open();
	const t = db.transaction(store, mode);
	const r = await fn(t.objectStore(store));
	await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
	return r;
}

export const getTile = (key) => tx('tiles', 'readonly', (s) => done(s.get(key)));
export const putTile = (key, buf) => tx('tiles', 'readwrite', (s) => done(s.put(buf, key)));
export const hasTile = (key) => tx('tiles', 'readonly', (s) => done(s.count(key))).then((n) => n > 0);

/** Czas użycia kafla (najwyżej co TOUCH_EVERY; błędy pomijane – to tylko podpowiedź dla przycinania). */
async function touch(key, bytes) {
	try {
		await tx('tileinfo', 'readwrite', async (s) => {
			const info = await done(s.get(key));
			const now = Date.now();
			if (!info || now - info.t > TOUCH_EVERY) await done(s.put({ t: now, n: info?.n ?? bytes }, key));
		});
	} catch { /* bez znaczenia */ }
}

/** Kafel z magazynu albo z sieci (i do magazynu). Pusta odpowiedź 204/404 – kafel bez danych (morze, brak). */
export async function fetchTile(key, url, signal) {
	const have = await getTile(key);
	if (have !== undefined) { touch(key, have.byteLength); return { buf: have, cached: true }; }
	const res = await fetch(url, { signal });
	let buf;
	if (res.status === 204 || res.status === 404) buf = new ArrayBuffer(0);
	else if (!res.ok) throw new Error(`${url}: ${res.status}`);
	else buf = await res.arrayBuffer();
	await putTile(key, buf);
	touch(key, buf.byteLength);
	return { buf, cached: false };
}

/**
 * Lista do przycinania: [klucz, czas użycia, bajty] wszystkich kafli; kafle sprzed rejestru (bez wpisu) – jak
 * najdawniej używane, rozmiar przyjęty średni.
 */
export function tileEntries(keys, infos) {
	return keys.map((k) => { const i = infos.get(k); return [k, i?.t ?? 0, i?.n ?? 30000]; });
}

/** Które kafle usunąć, żeby zmieścić się w maxBytes (z zapasem 10%): najdawniej używane. */
export function pickEvictions(entries, maxBytes) {
	let total = entries.reduce((a, e) => a + e[2], 0);
	if (total <= maxBytes) return { total, remove: [] };
	const remove = [];
	for (const e of [...entries].sort((a, b) => a[1] - b[1])) {
		if (total <= maxBytes * 0.9) break;
		remove.push(e[0]);
		total -= e[2];
	}
	return { total, remove };
}

/** Przycięcie pamięci kafli do maxBytes; zwraca { before, after, removed }. */
export async function trimTiles(maxBytes) {
	const keys = await tx('tiles', 'readonly', (s) => done(s.getAllKeys()));
	const infos = await tx('tileinfo', 'readonly', async (s) => {
		const [k, v] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
		return new Map(k.map((key, i) => [key, v[i]]));
	});
	const entries = tileEntries(keys, infos);
	const before = entries.reduce((a, e) => a + e[2], 0);
	const { total, remove } = pickEvictions(entries, maxBytes);
	for (let i = 0; i < remove.length; i += 500) {
		const part = remove.slice(i, i + 500);
		const db = await open();
		const t = db.transaction(['tiles', 'tileinfo'], 'readwrite');
		for (const k of part) { t.objectStore('tiles').delete(k); t.objectStore('tileinfo').delete(k); }
		await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
	}
	return { before, after: total, removed: remove.length, count: keys.length };
}

export async function saveRegion(meta, files) {
	await tx('regions', 'readwrite', (s) => done(s.put({ id: meta.id, files }, meta.id)));
	await tx('meta', 'readwrite', (s) => done(s.put(meta, meta.id)));
}
export const getRegionFiles = (id) => tx('regions', 'readonly', (s) => done(s.get(id))).then((r) => r?.files ?? null);
export const getRegionMeta = (id) => tx('meta', 'readonly', (s) => done(s.get(id)));
export const listRegions = () => tx('meta', 'readonly', (s) => done(s.getAll()));
export async function deleteRegion(id) {
	await tx('regions', 'readwrite', (s) => done(s.delete(id)));
	await tx('meta', 'readwrite', (s) => done(s.delete(id)));
}

/** Zajętość magazynu przeglądarki (bajty) – do opisu w menu. */
export async function usage() {
	try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
}
/** Prośba o trwały magazyn (przeglądarka nie usunie danych przy braku miejsca). */
export async function persist() {
	try { return await navigator.storage.persist?.(); } catch { return false; }
}

/** Kompresja gzip (jak pliki w data/regions/), w przeglądarce i w workerze. */
export async function gzip(data) {
	const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Response(stream).blob();
}
export async function gunzipBlob(blob) {
	return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
