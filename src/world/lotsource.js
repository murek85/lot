// Źródło własnych kafli gry (tools/bake-tiles.js) dla wątków i menu. Opis obszarów – data/tiles/lot/tiles.json
// (który kafel należy do którego województwa), kafle – z archiwum obszaru data/tiles/lot/<obszar>.pmtiles
// (tools/pack-tiles.js; czytane przez HTTP Range, otwierane przy pierwszym kaflu obszaru), a gdy archiwum nie ma
// albo serwer nie obsługuje Range – z luźnych plików data/tiles/lot/ (jak dotąd). Bez opisu – brak własnych kafli
// (wszędzie OpenFreeMap). Kafle z obu źródeł mają tę samą postać (wektorowe – surowe pbf, pokrycie i wysokości –
// gzip), więc pamięć kafli w IndexedDB jest wspólna.
import { fetchTile, gunzipBlob } from '../gen/store.js';
import { readManifest } from '../gen/lotmanifest.js';
import { PmtilesReader, rangeReader, lotTileId } from '../gen/pmtiles.js';

const BASE = new URL('../../data/tiles/lot/', import.meta.url).href;
const gunzip = async (bytes) => new Uint8Array(await gunzipBlob(new Blob([bytes])));

let src = null;

/**
 * Źródło (raz na wątek): { raw – opis tiles.json, own – readManifest(raw), file(kind, z, x, y) → { buf, cached } } –
 * kafel z pamięci kafli albo pobrany (brak kafla – pusty bufor).
 */
export function lotSource() {
	return (src ??= open());
}

async function open() {
	const raw = await fetch(`${BASE}tiles.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
	const own = readManifest(raw);
	const archives = new Map(); // obszar → obietnica czytnika albo null (bez archiwum – luźne pliki)
	const archive = (id) => {
		if (!archives.has(id)) {
			archives.set(id, new PmtilesReader(rangeReader(`${BASE}${id}.pmtiles`), gunzip).open().catch((e) => {
				// brak archiwum – luźne pliki (np. przed npm run pack:tiles); inny błąd (serwer bez Range) – ostrzeżenie
				if (!/ 404$/.test(e.message)) console.warn(`Kafle gry (${id}.pmtiles):`, e.message, '– luźne pliki data/tiles/lot/');
				return null;
			}));
		}
		return archives.get(id);
	};
	const loose = (kind, z, x, y) => `${BASE}${kind ? `${kind}/` : ''}${z}/${x}/${y}.${kind ? 'bin.gz' : 'pbf'}`;
	return {
		raw, own,
		/** Kafel rodzaju kind ('' – wektorowy, 'cover', 'height'); klucz pamięci ze znacznikiem wypieczenia obszaru. */
		file(kind, z, x, y) {
			const k = `${x}/${y}`, stamp = (z === 14 ? own.z14 : own.z11).get(k) ?? 'v0';
			const id = (z === 14 ? own.area14 : own.area11).get(k);
			// pobranie dopiero, gdy kafla nie ma w pamięci kafli
			return fetchTile(`lot${kind}/${stamp}/${z}/${x}/${y}`, async (signal) => {
				const pm = id ? await archive(id) : null;
				if (!pm) {
					const res = await fetch(loose(kind, z, x, y), { signal });
					if (res.status === 404) return null;
					if (!res.ok) throw new Error(`${loose(kind, z, x, y)}: ${res.status}`);
					return res.arrayBuffer();
				}
				const b = await pm.get(lotTileId(kind, z, x, y));
				if (!b) return null;
				// w archiwum wszystko w gzip – kafle wektorowe rozpakowane (jak luźne .pbf), rastry zostają spakowane (.bin.gz)
				return kind ? b : (await gunzip(new Uint8Array(b))).buffer;
			});
		},
	};
}
