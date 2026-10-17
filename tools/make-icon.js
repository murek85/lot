// Ikona aplikacji: sylwetka samolotu z logo ekranu startowego (bursztyn #f6c344, niebieska szyba kabiny) w cienkim
// okręgu, na ciemnogranatowym zaokrąglonym kwadracie. npm run icon zapisuje:
//   – build/icon.png 512 × 512 – dla electron-builder (robi z niego .ico pliku .exe),
//   – favicon.ico (16/32/48/64/256) – karta przeglądarki i okno aplikacji desktopowej na Windows,
//   – icons/icon-256.png – okno aplikacji desktopowej poza Windows, icons/apple-touch-icon.png 180 × 180.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from './lib/zip.js';

const BG = [11, 16, 24];
const PANEL = [16, 24, 36];
const EDGE = [40, 54, 72];
const AMBER = [246, 195, 68];
const GLASS = [143, 208, 255];
const RING = [92, 84, 52];

// obrys samolotu z logo (index.html, viewBox 64 × 64; łuk nosa rozpisany na punkty)
const PLANE = [[32, 5], [33.4, 5.5], [34.4, 6.9], [34.9, 8.9], [34.9, 10.2], [34.9, 22], [59.5, 24.6], [59.5, 30.8], [34.9, 33], [34.9, 46.6], [42.5, 49.2], [42.5, 53.4], [32, 52.2],
	[21.5, 53.4], [21.5, 49.2], [29.1, 46.6], [29.1, 33], [4.5, 30.8], [4.5, 24.6], [29.1, 22], [29.1, 10.2], [29.1, 8.9], [29.6, 6.9], [30.6, 5.5]];
const inside = (poly, x, y) => {
	let on = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i], [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) on = !on;
	}
	return on;
};
// zaokrąglony prostokąt (środek cx, cy, połowy w, h, promień r): odległość ze znakiem (ujemna – w środku)
const rbox = (x, y, cx, cy, w, h, r) => {
	const qx = Math.max(Math.abs(x - cx) - (w - r), 0), qy = Math.max(Math.abs(y - cy) - (h - r), 0);
	return Math.hypot(qx, qy) - r;
};
const K = 6.2; // skala logo 64 → kafel 512
function colourAt(x, y) {
	const tile = rbox(x, y, 256, 256, 220, 220, 92);
	if (tile > 0) return null;
	const u = 32 + (x - 256) / K, v = 29 + (y - 256) / K; // współrzędne logo
	if (u > 30.2 && u < 33.8 && v > 13 && v < 17.2) return GLASS;
	if (inside(PLANE, u, v)) return AMBER;
	if (Math.abs(Math.hypot(u - 32, v - 29) - 29) < 0.9) return RING;
	if (tile > -9) return EDGE;
	return PANEL;
}

// rysunek (współrzędne 512 × 512) przeskalowany do size × size; tight – bez marginesu wokół kafla (favikony:
// w 16 px każdy piksel się liczy); mniejsze rozmiary gęściej nadpróbkowane
function render(size, tight) {
	const SS = size >= 256 ? 4 : 8, o0 = tight ? 36 : 0, k = (512 - 2 * o0) / size;
	const rgba = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let j = 0; j < SS; j++)
				for (let i = 0; i < SS; i++) {
					const col = colourAt(o0 + (x + (i + 0.5) / SS) * k, o0 + (y + (j + 0.5) / SS) * k);
					if (!col) continue;
					r += col[0]; g += col[1]; b += col[2]; a++;
				}
			const o = (y * size + x) * 4;
			rgba[o] = a ? Math.round(r / a) : BG[0];
			rgba[o + 1] = a ? Math.round(g / a) : BG[1];
			rgba[o + 2] = a ? Math.round(b / a) : BG[2];
			rgba[o + 3] = Math.round((255 * a) / (SS * SS));
		}
	return rgba;
}

// PNG: sygnatura, IHDR, IDAT (każdy wiersz z bajtem filtra 0), IEND
const chunk = (type, data) => {
	const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]), sum = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	sum.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, sum]);
};
function png(size, tight) {
	const rgba = render(size, tight);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // głębia bitowa
	ihdr[9] = 6; // RGBA
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ICO z obrazami PNG w środku (Windows Vista+, wszystkie przeglądarki): nagłówek, katalog po 16 B, dane
function ico(sizes) {
	const imgs = sizes.map((n) => png(n, true));
	const head = Buffer.alloc(6 + 16 * imgs.length);
	head.writeUInt16LE(1, 2); // typ: ikona
	head.writeUInt16LE(imgs.length, 4);
	let off = head.length;
	imgs.forEach((img, i) => {
		const e = 6 + 16 * i, s = sizes[i] >= 256 ? 0 : sizes[i]; // 0 = 256
		head[e] = s;
		head[e + 1] = s;
		head.writeUInt16LE(1, e + 4); // płaszczyzny
		head.writeUInt16LE(32, e + 6); // bity na piksel
		head.writeUInt32LE(img.length, e + 8);
		head.writeUInt32LE(off, e + 12);
		off += img.length;
	});
	return Buffer.concat([head, ...imgs]);
}

const root = path.join(import.meta.dirname, '..');
const outputs = [
	['build/icon.png', () => png(512)],
	['favicon.ico', () => ico([16, 32, 48, 64, 256])],
	['icons/icon-256.png', () => png(256, true)],
	['icons/apple-touch-icon.png', () => png(180, true)],
];
for (const [rel, make] of outputs) {
	const out = path.join(root, rel), data = make();
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, data);
	console.log(`${rel}: ${data.length} B`);
}
