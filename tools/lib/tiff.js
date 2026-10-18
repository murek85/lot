// Odczyt prostego GeoTIFF z usługi WCS GUGiK: TIFF little-endian, pasy (strips), bez kompresji, 1 kanał float32.
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

/** Bufor TIFF → { width, height, data: Float32Array (wiersz 0 – północ) }. */
export function readFloatTiff(buf) {
	if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error('Obsługiwany tylko klasyczny TIFF little-endian');
	const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd), tags = {};
	for (let i = 0; i < n; i++) {
		const e = ifd + 2 + i * 12, tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), cnt = buf.readUInt32LE(e + 4);
		const inline = (TYPE_SIZE[type] || 1) * cnt <= 4;
		const at = inline ? e + 8 : buf.readUInt32LE(e + 8);
		const read = (k) => (type === 3 ? buf.readUInt16LE(at + k * 2) : buf.readUInt32LE(at + k * 4));
		tags[tag] = cnt === 1 ? read(0) : Array.from({ length: cnt }, (_, k) => read(k));
	}
	if ((tags[259] ?? 1) !== 1) throw new Error(`Nieobsługiwana kompresja TIFF: ${tags[259]}`);
	if (tags[258] !== 32 || tags[339] !== 3) throw new Error('Oczekiwany kanał float32');
	const width = tags[256], height = tags[257];
	const offs = [].concat(tags[273]), counts = [].concat(tags[279]);
	const raw = Buffer.concat(offs.map((o, i) => buf.subarray(o, o + counts[i])));
	const data = new Float32Array(width * height);
	for (let i = 0; i < data.length; i++) data[i] = raw.readFloatLE(i * 4);
	return { width, height, data };
}
