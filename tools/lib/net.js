// Pobieranie z pamięcią podręczną w tools/.cache (kolejne wypieczenia nie pobierają danych ponownie).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CACHE = path.join(import.meta.dirname, '..', '.cache');
const UA = 'lot-prototyp/0.1 (gra; narzedzie do wypiekania terenu)';

export async function fetchCached(url, range) {
	const key = crypto.createHash('sha1').update(url + (range ? `#${range[0]}-${range[1]}` : '')).digest('hex');
	const file = path.join(CACHE, key);
	if (fs.existsSync(file)) return fs.readFileSync(file);
	const headers = { 'User-Agent': UA };
	if (range) headers.Range = `bytes=${range[0]}-${range[1]}`;
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { headers });
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			const buf = Buffer.from(await res.arrayBuffer());
			fs.mkdirSync(CACHE, { recursive: true });
			fs.writeFileSync(file, buf);
			return buf;
		} catch (e) {
			if (attempt >= 4) throw e;
			await new Promise((r) => setTimeout(r, 1000 * attempt));
		}
	}
}

/** Uruchamia zadania z ograniczoną liczbą naraz. */
export async function pool(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	}));
	return out;
}
