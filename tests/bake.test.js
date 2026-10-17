import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng } from '../tools/lib/png.js';
import { parseFirstIfd } from '../tools/lib/cog.js';
import { COVER, worldCoverClass, components, flattenWater, signedShoreDistance } from '../tools/lib/terrain.js';

function crc32(buf) {
	let c = 0xffffffff;
	for (const v of buf) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
	return (c ^ 0xffffffff) >>> 0;
}
function png(width, height, rgb, filter) {
	const chunk = (name, data) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(name, 'latin1'), data]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
	const rows = [];
	for (let y = 0; y < height; y++) {
		const row = Buffer.alloc(1 + width * 3);
		row[0] = filter;
		for (let x = 0; x < width * 3; x++) {
			const v = rgb[y * width * 3 + x];
			const left = x >= 3 ? rgb[y * width * 3 + x - 3] : 0;
			row[1 + x] = filter === 1 ? (v - left) & 255 : v; // filtr Sub albo brak
		}
		rows.push(row);
	}
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

test('dekoder PNG odtwarza piksele (filtry None i Sub)', () => {
	const rgb = Uint8Array.from({ length: 4 * 3 * 3 }, (_, i) => (i * 37) & 255);
	for (const f of [0, 1]) {
		const out = decodePng(png(4, 3, rgb, f));
		assert.equal(out.width, 4);
		assert.equal(out.channels, 3);
		assert.deepEqual(Array.from(out.data), Array.from(rgb));
	}
});

test('nagłówek TIFF: wartości i odnośniki do tablic', () => {
	const b = Buffer.alloc(200);
	b.write('II', 0, 'latin1'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
	b.writeUInt16LE(2, 8);
	// 256 (szerokość) SHORT = 1000; 324 (przesunięcia kafelków) LONG ×3 pod adresem 100
	b.writeUInt16LE(256, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(1000, 18);
	b.writeUInt16LE(324, 22); b.writeUInt16LE(4, 24); b.writeUInt32LE(3, 26); b.writeUInt32LE(100, 30);
	const tags = parseFirstIfd(b);
	assert.equal(tags[256], 1000);
	assert.deepEqual(tags[324], { offset: 100, n: 3, type: 4 });
});

test('klasy WorldCover → klasy gry', () => {
	assert.equal(worldCoverClass(10), COVER.forest);
	assert.equal(worldCoverClass(40), COVER.crop);
	assert.equal(worldCoverClass(80), COVER.water);
	assert.equal(worldCoverClass(0), COVER.grass);
});

test('spójne składowe maski', () => {
	const n = 5;
	const m = Uint8Array.from([
		1, 1, 0, 0, 0,
		1, 0, 0, 1, 1,
		0, 0, 0, 1, 0,
		0, 0, 0, 0, 0,
		1, 0, 0, 0, 0,
	]);
	const { comps } = components(m, n);
	assert.deepEqual(comps.map((c) => c.cells.length).sort(), [1, 3, 3]);
});

test('jezioro dostaje jeden poziom wody, ląd przy brzegu nie leży niżej', () => {
	const n = 6;
	const water = new Uint8Array(n * n), h = new Float32Array(n * n).fill(100);
	for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) { water[y * n + x] = 1; h[y * n + x] = 90 + x + y; }
	h[1 * n + 2] = 80; // dziura w danych przy brzegu
	const out = flattenWater(h, water, n, 10);
	const lake = [14, 15, 20, 21].map((i) => out[i]);
	assert.ok(lake.every((v) => v === lake[0]));
	assert.ok(out[1 * n + 2] >= lake[0]);
});

test('odległość od brzegu ze znakiem: woda ujemna, ląd dodatni', () => {
	const n = 7;
	const water = new Uint8Array(n * n);
	for (let y = 0; y < n; y++) for (let x = 0; x < 3; x++) water[y * n + x] = 1;
	const d = signedShoreDistance(water, n);
	assert.ok(d[3 * n + 0] < d[3 * n + 2] && d[3 * n + 2] < 0);
	assert.ok(d[3 * n + 3] > 0 && d[3 * n + 6] > d[3 * n + 3]);
	assert.ok(Math.abs(d[3 * n + 6] - 4) < 1e-6);
});
