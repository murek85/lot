// Podgląd wypieczonego regionu jako PNG (pokrycie terenu + cieniowanie rzeźby) – do sprawdzenia danych bez gry.
// Użycie: node tools/preview-region.js [id] → data/regions/<id>/preview.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const id = process.argv[2] || 'bory-tucholskie';
const DIR = path.join(import.meta.dirname, '..', 'data', 'regions', id);
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const read = (f, T) => { const b = zlib.gunzipSync(fs.readFileSync(path.join(DIR, f))); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const h16 = read(meta.height.file, Uint16Array), cover = read(meta.cover.file, Uint8Array);
const n = meta.height.res, cn = meta.cover.res, out = 1024;
const COLORS = [[150, 170, 90], [40, 80, 40], [120, 140, 70], [200, 180, 110], [170, 120, 110], [210, 200, 170], [40, 80, 140], [90, 120, 100]];
const hAt = (x, y) => meta.height.min + (h16[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))] / 65535) * (meta.height.max - meta.height.min);
const cell = meta.size / n;

const rows = [];
for (let y = 0; y < out; y++) {
	const row = Buffer.alloc(1 + out * 3);
	for (let x = 0; x < out; x++) {
		const hx = Math.floor((x / out) * n), hy = Math.floor((y / out) * n);
		const dx = (hAt(hx + 1, hy) - hAt(hx - 1, hy)) / (2 * cell), dy = (hAt(hx, hy + 1) - hAt(hx, hy - 1)) / (2 * cell);
		const shade = Math.max(0.35, Math.min(1.3, 1 + (-dx + -dy) * 6));
		const c = COLORS[cover[Math.floor((y / out) * cn) * cn + Math.floor((x / out) * cn)]];
		for (let k = 0; k < 3; k++) row[1 + x * 3 + k] = Math.min(255, c[k] * shade);
	}
	rows.push(row);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (name, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(name, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(out, 0); ihdr.writeUInt32BE(out, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(DIR, 'preview.png'), png);
console.log(`→ ${path.relative(process.cwd(), path.join(DIR, 'preview.png'))}`);
