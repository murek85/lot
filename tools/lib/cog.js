// Odczyt kafelków z Cloud Optimized GeoTIFF przez zapytania Range – tylko to, czego potrzebuje ESA WorldCover:
// klasyczny TIFF little-endian, kafelki, 1 kanał 8 bitów, kompresja deflate, bez predyktora.
import zlib from 'node:zlib';
import { fetchCached } from './net.js';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };

/** Czyta pierwszy katalog (IFD) z bufora nagłówka; zwraca wartości znaczników albo [offset, count, type] do doczytania. */
export function parseFirstIfd(buf) {
	if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error('Obsługiwany tylko klasyczny TIFF little-endian');
	const ifd = buf.readUInt32LE(4);
	const count = buf.readUInt16LE(ifd);
	const tags = {};
	for (let i = 0; i < count; i++) {
		const e = ifd + 2 + i * 12;
		const tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), n = buf.readUInt32LE(e + 4);
		const size = (TYPE_SIZE[type] || 1) * n;
		if (size <= 4) tags[tag] = n === 1 ? (type === 3 ? buf.readUInt16LE(e + 8) : buf.readUInt32LE(e + 8)) : [e + 8, n, type];
		else tags[tag] = { offset: buf.readUInt32LE(e + 8), n, type };
	}
	return tags;
}

function readArray(buf, ref) {
	const out = new Array(ref.n);
	for (let i = 0; i < ref.n; i++) out[i] = ref.type === 3 ? buf.readUInt16LE(ref.offset + i * 2) : buf.readUInt32LE(ref.offset + i * 4);
	return out;
}

export async function openCog(url) {
	let head = await fetchCached(url, [0, 65535]);
	const tags = parseFirstIfd(head);
	const need = Math.max(tags[324].offset + tags[324].n * 4, tags[325].offset + tags[325].n * 4);
	if (need > head.length) head = await fetchCached(url, [0, need - 1]);
	if (tags[259] !== 8 && tags[259] !== 32946) throw new Error(`Nieobsługiwana kompresja TIFF: ${tags[259]}`);
	if ((tags[317] || 1) !== 1) throw new Error('Nieobsługiwany predyktor TIFF');
	const cog = {
		width: tags[256], height: tags[257], tileW: tags[322], tileH: tags[323],
		offsets: readArray(head, tags[324]), counts: readArray(head, tags[325]),
	};
	cog.tilesAcross = Math.ceil(cog.width / cog.tileW);
	const cache = new Map();
	cog.tile = async (tx, ty) => {
		const i = ty * cog.tilesAcross + tx;
		if (!cache.has(i)) {
			cache.set(i, (async () => {
				const raw = await fetchCached(url, [cog.offsets[i], cog.offsets[i] + cog.counts[i] - 1]);
				return new Uint8Array(zlib.inflateSync(raw));
			})());
		}
		return cache.get(i);
	};
	return cog;
}
