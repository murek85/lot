// Magazyn generatora w IndexedDB (baza „lot-gen”):
//   tiles   – surowe kafle źródłowe (pbf OpenFreeMap, png wysokości) pod kluczem „źródło/z/x/y”: drugi region na tym
//             samym obszarze i przyszłe strumieniowanie nie pobierają ich ponownie;
//   regions – gotowe dane regionu: { id, files: { 'height.bin.gz': Blob, … } } – te same pliki co w data/regions/;
//   meta    – opisy regionów (meta.json) do listy w menu, bez ciężkich danych.
const DB = 'lot-gen', VERSION = 1;
let dbp = null;

function open() {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const s of ['tiles', 'regions', 'meta']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
		};
		req.onsuccess = () => resolve(req.result);
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

/** Kafel z magazynu albo z sieci (i do magazynu). Pusta odpowiedź 204/404 – kafel bez danych (morze, brak). */
export async function fetchTile(key, url, signal) {
	const have = await getTile(key);
	if (have !== undefined) return { buf: have, cached: true };
	const res = await fetch(url, { signal });
	let buf;
	if (res.status === 204 || res.status === 404) buf = new ArrayBuffer(0);
	else if (!res.ok) throw new Error(`${url}: ${res.status}`);
	else buf = await res.arrayBuffer();
	await putTile(key, buf);
	return { buf, cached: false };
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
