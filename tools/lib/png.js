// Minimalny dekoder PNG (8 bitów na kanał, szarość/RGB/RGBA, bez przeplotu) – na kafelki Terrarium.
import zlib from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('To nie jest PNG');
	let pos = 8, width = 0, height = 0, type = 0;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const name = buf.toString('latin1', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (name === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			if (data[8] !== 8 || data[12] !== 0) throw new Error('Obsługiwane tylko 8 bitów bez przeplotu');
			type = data[9];
		} else if (name === 'IDAT') idat.push(data);
		else if (name === 'IEND') break;
		pos += 12 + len;
	}
	const ch = CHANNELS[type];
	if (!ch) throw new Error(`Nieobsługiwany typ koloru PNG: ${type}`);
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const stride = width * ch;
	const out = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)];
		const src = y * (stride + 1) + 1;
		const row = y * stride, prev = row - stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= ch ? out[row + x - ch] : 0;
			const b = y > 0 ? out[prev + x] : 0;
			const c = x >= ch && y > 0 ? out[prev + x - ch] : 0;
			let v = raw[src + x];
			if (f === 1) v += a;
			else if (f === 2) v += b;
			else if (f === 3) v += (a + b) >> 1;
			else if (f === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[row + x] = v & 255;
		}
	}
	return { width, height, channels: ch, data: out };
}
