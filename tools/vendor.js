// Kopiuje Three.js (wersja WebGPU) z node_modules do vendor/three/ – gra ładuje go stamtąd przez import map,
// bez bundlera. Uruchom po zmianie wersji three w package.json: npm install && npm run vendor
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'three');
const DST = path.join(ROOT, 'vendor', 'three');

const FILES = ['build/three.core.js', 'build/three.webgpu.js', 'build/three.tsl.js', 'LICENSE'];
// Dodatki TSL (TAA, bloom, …) – cały katalog, bo moduły importują się nawzajem.
const DIRS = ['examples/jsm/tsl'];

function copyDir(from, to) {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		const a = path.join(from, e.name), b = path.join(to, e.name);
		if (e.isDirectory()) copyDir(a, b);
		else if (e.name.endsWith('.js')) fs.copyFileSync(a, b);
	}
}

if (!fs.existsSync(SRC)) {
	console.error('Brak node_modules/three – najpierw npm install');
	process.exit(1);
}
fs.rmSync(DST, { recursive: true, force: true });
for (const f of FILES) {
	const to = path.join(DST, path.basename(f));
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(path.join(SRC, f), to);
}
for (const d of DIRS) copyDir(path.join(SRC, d), path.join(DST, 'addons', path.relative('examples/jsm', d)));
const version = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(DST, 'VERSION'), version + '\n');
console.log(`Three.js ${version} → vendor/three/`);
