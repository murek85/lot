// npm run web: wersja przeglądarkowa do wgrania na serwer (jak w Maszyniście i Pograniczu Galaktyki) – folder web/lot/
// z plikami gry i archiwum web/lot-<wersja>.zip (te same pliki). Tylko to, czego potrzebuje strona:
//   – index.html, style.css, favicon.ico, icons/;
//   – src/ (moduły ES gry), vendor/three/ (Three.js z dodatkami i licencją);
//   – data/regions/ (wypieczone regiony; bez podglądów preview.png).
// Bez narzędzi, testów, serwera Node i opisów .md. Strona działa z każdego serwera statycznego (HTTPS albo localhost –
// WebGPU wymaga bezpiecznego kontekstu); pliki .gz są rozpakowywane w przeglądarce, więc serwer nie musi niczego ustawiać.
import fs from 'node:fs';
import path from 'node:path';
import { zip } from './lib/zip.js';

const ROOT = path.join(import.meta.dirname, '..');
const NAME = 'lot';
const WEB = path.join(ROOT, 'web'), OUT = path.join(WEB, NAME);
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// pliki i foldery gry (ścieżki względem katalogu projektu)
const FILES = ['index.html', 'style.css', 'favicon.ico'];
const DIRS = ['icons', 'src', 'vendor/three', 'data/regions'];
const skip = (rel) => /\.md$/i.test(rel) || /(^|\/)\./.test(rel) || /\/preview\.png$/.test(rel); // opisy, ukryte, podglądy

const list = [...FILES];
const walk = (dir) => {
	for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
		const rel = dir + '/' + e.name;
		if (skip(rel)) continue;
		if (e.isDirectory()) walk(rel);
		else list.push(rel);
	}
};
for (const d of DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(d);
for (const rel of list) if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`brak pliku ${rel} (ikony: npm run icon)`);

// folder web/ od nowa
fs.rmSync(WEB, { recursive: true, force: true });
for (const rel of list) {
	const dst = path.join(OUT, rel);
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.copyFileSync(path.join(ROOT, rel), dst);
}
// własne kafle otwartego świata (npm run pack:tiles): opis tiles.json i archiwa województw <obszar>.pmtiles – tylko
// do folderu (setki MB, wgrywane osobno; luźnych plików kafli nie kopiujemy)
const TILES = 'data/tiles/lot';
const tileFiles = fs.existsSync(path.join(ROOT, TILES, 'tiles.json'))
	? ['tiles.json', ...fs.readdirSync(path.join(ROOT, TILES)).filter((f) => f.endsWith('.pmtiles'))].map((f) => `${TILES}/${f}`) : [];
for (const rel of tileFiles) {
	fs.mkdirSync(path.join(OUT, TILES), { recursive: true });
	fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, rel));
}
const zipName = `${NAME}-${version}.zip`;
fs.writeFileSync(path.join(WEB, zipName), zip(list.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(ROOT, rel)) }))));

const size = list.reduce((a, rel) => a + fs.statSync(path.join(ROOT, rel)).size, 0);
const zsize = fs.statSync(path.join(WEB, zipName)).size;
const mb = (n) => (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
console.log(`Wersja przeglądarkowa ${version}: ${list.length} plików, ${mb(size)}`);
console.log(`  folder:   web/${NAME}/  (zawartość wgraj do katalogu strony, np. public_html)`);
console.log(`  archiwum: web/${zipName}  (${mb(zsize)} – to samo w jednym pliku)`);
if (tileFiles.length > 1) console.log(`  kafle:    web/${NAME}/${TILES}/ (${tileFiles.length - 1} województw, ${mb(tileFiles.reduce((a, rel) => a + fs.statSync(path.join(ROOT, rel)).size, 0))} – bez archiwum ZIP; wgraj osobno, serwer musi obsługiwać HTTP Range)`);
console.log('WebGPU działa tylko na stronach HTTPS (albo z localhost) – serwer musi podawać stronę przez https://.');
