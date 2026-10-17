// Prosty serwer statyczny do podglądu gry: node server.js → http://localhost:4190
// (moduły ES i dane regionów nie wczytują się z file://, więc gra potrzebuje serwera albo aplikacji).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT) || 4190;
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.gz': 'application/octet-stream',
};

http.createServer((req, res) => {
	const url = decodeURIComponent(req.url.split('?')[0]);
	const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
	if (!file.startsWith(ROOT) || file.includes(`${path.sep}tools${path.sep}`)) { res.writeHead(403); res.end(); return; }
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404); res.end('Nie znaleziono'); return; }
		res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
		res.end(data);
	});
}).listen(PORT, () => console.log(`Lot: http://localhost:${PORT}`));
