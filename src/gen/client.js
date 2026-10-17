// Strona gry generatora regionów: worker (pobieranie i składanie regionu), lista zapisanych regionów, wyszukiwanie
// miejscowości (Nominatim). Region wygenerowany ma identyfikator „gen-…” i leży w IndexedDB (src/gen/store.js).
import { listRegions, deleteRegion, getRegionMeta, usage } from './store.js';

export { listRegions, deleteRegion, getRegionMeta, usage };
export const isGenerated = (id) => typeof id === 'string' && id.startsWith('gen-');

let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
	if (worker) return worker;
	worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
	worker.onmessage = (e) => {
		const { type, req } = e.data;
		const p = pending.get(req);
		if (!p) return;
		if (type === 'progress') p.onProgress?.(e.data.p, e.data.label);
		else {
			pending.delete(req);
			if (type === 'done') p.resolve(e.data.result);
			else { const err = new Error(e.data.message); err.cancelled = e.data.message === 'cancelled'; p.reject(err); }
		}
	};
	worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Błąd workera generatora')); pending.clear(); };
	return worker;
}

function call(type, params, onProgress) {
	const req = ++seq;
	return new Promise((resolve, reject) => {
		pending.set(req, { resolve, reject, onProgress });
		getWorker().postMessage({ type, req, params });
	});
}

/** Szacunek: { mapTiles, heightTiles, buildings, roads, downloadMB, load: 'low' | 'medium' | 'high' }. */
export const estimate = (params) => call('estimate', params);
/** Generowanie regionu; zwraca meta zapisanego regionu. */
export function generate(params, onProgress) {
	const slug = (params.name || 'region').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
		.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'region';
	const id = `gen-${slug}-${Date.now().toString(36)}`;
	return call('generate', { ...params, id }, onProgress);
}
export function cancel() { worker?.postMessage({ type: 'cancel' }); }

/** Wyszukiwanie miejsca w Polsce (Nominatim, OpenStreetMap; najwyżej 1 zapytanie na sekundę). */
let lastQuery = 0;
export async function geocode(q) {
	const wait = lastQuery + 1100 - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastQuery = Date.now();
	const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=pl&accept-language=pl&q=${encodeURIComponent(q)}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Wyszukiwanie: ${res.status}`);
	const out = [];
	for (const r of await res.json()) {
		const p = { name: r.name || r.display_name.split(',')[0], label: r.display_name, lon: +r.lon, lat: +r.lat };
		// ten sam obiekt bywa kilka razy (granica gminy, miasto, węzeł) – jeden wpis na nazwę w promieniu ~3 km
		if (!out.some((q) => q.name === p.name && Math.abs(q.lon - p.lon) < 0.04 && Math.abs(q.lat - p.lat) < 0.03)) out.push(p);
	}
	return out;
}

/** Gotowe propozycje (środek regionu) – Śląsk i kilka innych ciekawych miejsc. */
export const PRESETS = [
	{ name: 'Katowice', lon: 19.02, lat: 50.26 },
	{ name: 'Gliwice', lon: 18.67, lat: 50.29 },
	{ name: 'Beskid Śląski', lon: 19.0, lat: 49.7 },
	{ name: 'Jura Krakowsko-Częstochowska', lon: 19.55, lat: 50.55 },
	{ name: 'Częstochowa', lon: 19.12, lat: 50.81 },
	{ name: 'Tatry i Zakopane', lon: 19.96, lat: 49.27 },
	{ name: 'Kraków', lon: 19.94, lat: 50.06 },
	{ name: 'Trójmiasto', lon: 18.6, lat: 54.44 },
	{ name: 'Warszawa', lon: 21.01, lat: 52.23 },
	{ name: 'Wrocław', lon: 17.03, lat: 51.11 },
];
