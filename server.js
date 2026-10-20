// Prosty serwer statyczny do podglądu gry: node server.js → http://localhost:4190
// (moduły ES i dane regionów nie wczytują się z file://, więc gra potrzebuje serwera albo aplikacji).
// node server.js web/lot – podgląd wersji przeglądarkowej zbudowanej przez npm run web.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, process.argv[2] ?? '.');
const PORT = Number(process.env.PORT) || 4190;
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.gz': 'application/octet-stream',
	'.pmtiles': 'application/octet-stream',
	'.ico': 'image/x-icon',
};

http.createServer((req, res) => {
	const url = decodeURIComponent(req.url.split('?')[0]);
	const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
	if (!file.startsWith(ROOT) || file.includes(`${path.sep}tools${path.sep}`)) { res.writeHead(403); res.end(); return; }
	fs.stat(file, (err, st) => {
		if (err || !st.isFile()) { res.writeHead(404); res.end('Nie znaleziono'); return; }
		const head = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
		// zapytanie o fragment pliku (HTTP Range) – kafle z data/tiles/lot.pmtiles; jeden zakres „bytes=a-b”
		const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
		if (m && (m[1] || m[2])) {
			const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
			if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
			res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
			fs.createReadStream(file, { start, end }).pipe(res);
			return;
		}
		res.writeHead(200, { ...head, 'Content-Length': st.size });
		fs.createReadStream(file).pipe(res);
	});
}).listen(PORT, () => console.log(`Lot: http://localhost:${PORT}${process.argv[2] ? ` (${process.argv[2]})` : ''}`));
