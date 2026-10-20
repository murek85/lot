/* Pliki gry dla protokołu app:// aplikacji desktopowej: ścieżka z adresu → plik w folderze gry (nigdy poza nim)
   i jego typ. Czyste funkcje – wspólne dla electron/main.cjs i testów. */
'use strict';
const path = require('node:path');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.gz': 'application/gzip', // dane regionów – rozpakowywane w stronie (src/region.js)
	'.woff2': 'font/woff2',
};

// plik dla ścieżki adresu („/” → index.html) albo null – ścieżka wychodząca poza folder gry lub złe kodowanie
function resolveAsset(root, pathname) {
	let rel;
	try {
		rel = decodeURIComponent(pathname || '/');
	} catch {
		return null;
	}
	if (rel.includes('\0')) return null;
	if (rel === '/' || rel === '') rel = '/index.html';
	const base = path.resolve(root);
	const file = path.resolve(base, '.' + rel.replace(/\\/g, '/'));
	return file.startsWith(base + path.sep) ? file : null;
}

// zakres z nagłówka Range („bytes=a-b”, „bytes=a-”, „bytes=-n”) dla pliku o rozmiarze size: { start, end } (włącznie),
// 'invalid' – poza plikiem (odpowiedź 416), null – bez nagłówka albo inna postać (cały plik). Archiwa kafli
// województw (data/tiles/lot/*.pmtiles) gra czyta wyłącznie fragmentami.
function parseRange(header, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
	if (!m || (!m[1] && !m[2])) return null;
	const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
	const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
	return start > end || start >= size ? 'invalid' : { start, end };
}

function mimeOf(file) {
	return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

module.exports = { resolveAsset, mimeOf, parseRange, MIME };
