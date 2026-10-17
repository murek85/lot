// Wczytuje region – wypieczony (data/regions/<id>/) albo wygenerowany w grze (IndexedDB, id „gen-…”) – i zamienia
// go na tekstury GPU. Oba mają te same pliki i meta.json.
import { getRegionFiles, getRegionMeta, gunzipBlob } from './gen/store.js';
import { DataTexture, RedFormat, HalfFloatType, UnsignedByteType, LinearFilter, NearestFilter, ClampToEdgeWrapping, DataUtils } from 'three/webgpu';

async function gunzip(url, onProgress) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Nie udało się wczytać ${url} (${res.status})`);
	// część serwerów stron podaje .gz z nagłówkiem Content-Encoding: gzip – przeglądarka sama go wtedy rozpakowuje
	let buf = await res.arrayBuffer();
	const head = new Uint8Array(buf, 0, 2);
	if (head[0] === 0x1f && head[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
	onProgress?.();
	return buf;
}

function tex(data, n, type, filter) {
	const t = new DataTexture(data, n, n, RedFormat, type);
	t.minFilter = t.magFilter = filter;
	t.wrapS = t.wrapT = ClampToEdgeWrapping;
	t.generateMipmaps = false;
	t.needsUpdate = true;
	return t;
}

/** Zmniejsza mapę wysokości (średnia z bloków) – rozmyta wersja do cieniowania zagłębień. */
export function downsample(src, n, factor) {
	const m = n / factor;
	const out = new Float32Array(m * m);
	for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
		let s = 0;
		for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) s += src[(y * factor + dy) * n + x * factor + dx];
		out[y * m + x] = s / (factor * factor);
	}
	return out;
}

/** Źródło plików regionu: { meta, file(name) → ArrayBuffer (rozpakowany) }. */
async function regionSource(id) {
	if (id.startsWith('gen-')) {
		const [meta, files] = await Promise.all([getRegionMeta(id), getRegionFiles(id)]);
		if (!meta || !files) throw new Error(`Brak wygenerowanego regionu ${id}`);
		return { meta, file: (name) => gunzipBlob(files[name]) };
	}
	const base = `data/regions/${id}/`;
	const res = await fetch(base + 'meta.json');
	if (!res.ok) throw new Error(`Nieznany region ${id}`);
	return { meta: await res.json(), file: (name) => gunzip(base + name) };
}

export async function loadRegion(id, onProgress) {
	const src = await regionSource(id);
	const { meta } = src;
	const step = (p) => p.then((b) => { onProgress?.(); return b; });
	const [hBuf, cBuf, sBuf] = await Promise.all([step(src.file(meta.height.file)), step(src.file(meta.cover.file)), step(src.file(meta.shore.file))]);
	const n = meta.height.res;
	const h16 = new Uint16Array(hBuf);
	const span = meta.height.max - meta.height.min;
	const heights = new Float32Array(n * n);
	const half = new Uint16Array(n * n);
	let sum = 0, edgeSum = 0, edgeCount = 0;
	for (let i = 0; i < heights.length; i++) {
		const h = meta.height.min + (h16[i] / 65535) * span;
		heights[i] = h;
		half[i] = DataUtils.toHalfFloat(h);
		sum += h;
		const x = i % n, y = (i / n) | 0;
		if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { edgeSum += h; edgeCount++; }
	}
	const blurN = n / 8;
	const blur = downsample(heights, n, 8);
	const blurHalf = new Uint16Array(blur.length);
	for (let i = 0; i < blur.length; i++) blurHalf[i] = DataUtils.toHalfFloat(blur[i]);

	// gęstość lasu 0..1 z filtrowaniem dwuliniowym – gładkie ściany lasu w cieniach
	const cover = new Uint8Array(cBuf);
	const forest = new Uint8Array(cover.length);
	for (let i = 0; i < cover.length; i++) forest[i] = cover[i] === meta.cover.classes.forest ? 255 : 0;

	// obiekty z OpenStreetMap (drogi, budynki, tory…), jeśli region je ma
	let osm = null;
	if (meta.osm) osm = JSON.parse(new TextDecoder().decode(await src.file(meta.osm.file)));

	return {
		meta,
		osm,
		size: meta.size,
		heights,
		meanHeight: sum / heights.length,
		edgeHeight: edgeSum / edgeCount,
		heightTex: tex(half, n, HalfFloatType, LinearFilter),
		heightBlurTex: tex(blurHalf, blurN, HalfFloatType, LinearFilter),
		coverTex: tex(cover, meta.cover.res, UnsignedByteType, NearestFilter),
		forestTex: tex(forest, meta.cover.res, UnsignedByteType, LinearFilter),
		shoreTex: tex(new Uint8Array(sBuf), meta.shore.res, UnsignedByteType, LinearFilter),
		/** Wysokość terenu (m n.p.m.) w punkcie świata x, z – interpolacja dwuliniowa, poza regionem średnia krawędzi. */
		heightAt(x, z) {
			const fx = (x / meta.size + 0.5) * n - 0.5, fz = (z / meta.size + 0.5) * n - 0.5;
			if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return this.edgeHeight;
			const ix = Math.min(n - 2, Math.floor(fx)), iz = Math.min(n - 2, Math.floor(fz));
			const u = fx - ix, v = fz - iz;
			const a = heights[iz * n + ix], b = heights[iz * n + ix + 1], c = heights[(iz + 1) * n + ix], d = heights[(iz + 1) * n + ix + 1];
			return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
		},
	};
}
