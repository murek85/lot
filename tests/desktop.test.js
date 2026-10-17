// Aplikacja desktopowa i wersja przeglądarkowa: pliki gry dla protokołu app:// (electron/assets.cjs), archiwum ZIP
// (tools/lib/zip.js) i ustawienia pakowania.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { zip, crc32 } from '../tools/lib/zip.js';

const require = createRequire(import.meta.url);
const { resolveAsset, mimeOf } = require('../electron/assets.cjs');
const ROOT = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('ścieżki app:// trafiają do folderu gry i nigdy poza niego', () => {
	assert.equal(resolveAsset(ROOT, '/'), path.join(ROOT, 'index.html'));
	assert.equal(resolveAsset(ROOT, '/src/plane/flight.js'), path.join(ROOT, 'src', 'plane', 'flight.js'));
	assert.equal(resolveAsset(ROOT, '/a%20b.js'), path.join(ROOT, 'a b.js'));
	for (const bad of ['/../package.json', '/%2e%2e/secret', '/..%5c..%5cwindows', '/a/../../x', '/%E0%A4%A', '/x\0y']) assert.equal(resolveAsset(ROOT, bad), null, bad);
	assert.match(mimeOf('a.js'), /javascript/);
	assert.match(mimeOf('a.HTML'), /text\/html/);
	assert.equal(mimeOf('x.unknown'), 'application/octet-stream');
});

test('każdy plik ze strony i mapy importów istnieje i ma znany typ', () => {
	const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
	const refs = [...html.matchAll(/(?:src|href)="([^"#?:]+)"/g)].map((m) => m[1]);
	const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
	for (const target of Object.values(imports)) if (!target.endsWith('/')) refs.push(target);
	assert.ok(refs.length >= 8);
	for (const ref of refs) {
		const file = resolveAsset(ROOT, '/' + ref.replace(/^\.\//, ''));
		assert.ok(file && fs.existsSync(file), ref);
		assert.notEqual(mimeOf(file), 'application/octet-stream', ref);
	}
});

test('ZIP: nagłówki, CRC i dane do odtworzenia', () => {
	const a = Buffer.from('ą'.repeat(500)), b = Buffer.from([1, 2, 3]);
	const z = zip([{ name: 'src/a.txt', data: a }, { name: 'b.bin', data: b }]);
	assert.equal(z.readUInt32LE(0), 0x04034b50);
	assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
	assert.equal(z.readUInt16LE(z.length - 12), 2);
	assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
	// pierwszy wpis: deflate, rozpakowany daje oryginał
	assert.equal(z.readUInt16LE(8), 8);
	const size = z.readUInt32LE(18), nameLen = z.readUInt16LE(26);
	assert.equal(z.subarray(30, 30 + nameLen).toString(), 'src/a.txt');
	assert.deepEqual(zlib.inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size)), a);
});

test('pakowanie: główny plik aplikacji, ikona, pliki gry bez narzędzi i testów', () => {
	assert.equal(pkg.main, 'electron/main.cjs');
	for (const f of [pkg.main, 'electron/preload.cjs', 'favicon.ico', 'build/icon.png', 'icons/icon-256.png']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
	const files = pkg.build.files;
	for (const need of ['index.html', 'src/**', 'vendor/three/**', 'data/regions/**', 'electron/**']) assert.ok(files.includes(need), need);
	assert.ok(!files.some((f) => /^(tools|tests|server)/.test(f)));
	for (const s of ['web', 'app', 'app:check', 'dist', 'dist:dir', 'icon']) assert.ok(pkg.scripts[s], s);
});
