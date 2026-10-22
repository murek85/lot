// Przejścia dla pieszych na skrzyżowaniach w zabudowie – bez Three.js, testowane w Node. Z dróg w formacie gry
// ([cls, szerokość × 10, nawierzchnia, most, warstwa, współrzędne w decymetrach, kierunkowość]) i budynków
// ([…, obrys w decymetrach]) – odcinki zebry: { pts: [x0, z0, x1, z1] (metry, wzdłuż drogi), width }. Rysowane jako
// krótkie wstęgi klasy CROSSING materiałem dróg (src/roads.js).

export const CROSSING = 9;
const NEAR = 2.5, LEN = 3; // zebra 2,5 m za krawędzią najszerszej drogi skrzyżowania, 3 m szeroka
const APART = 6; // m – zebry bliżej siebie (nakładające się) – tylko pierwsza
const CELL = 60; // m – siatka zabudowy

/**
 * Odcinki zebry: dla każdego skrzyżowania (węzeł z co najmniej trzema wylotami – sam styk dwóch odcinków tej samej
 * ulicy się nie liczy) dróg klas 1–4 z asfaltem (bez mostów) z udziałem drogi klasy 1–3 (krajowej, wojewódzkiej,
 * powiatowej – na skrzyżowaniach samych osiedlówek zebr zwykle nie ma), w zabudowie (min. 3 budynki w komórkach 60 m
 * wokół) – na każdym wylocie, za krawędzią najszerszej drogi w węźle; bez zebr nakładających się.
 */
export function roadCrossings(roads, buildings, max = 400) {
	// zabudowa: liczba budynków w komórkach siatki (środek pierwszego wierzchołka obrysu wystarczy)
	const built = new Map();
	for (const b of buildings) {
		const c = b[4];
		if (!c || c.length < 2) continue;
		const k = `${Math.floor(c[0] / 10 / CELL)},${Math.floor(c[1] / 10 / CELL)}`;
		built.set(k, (built.get(k) ?? 0) + 1);
	}
	const isBuilt = (x, z) => {
		const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
		let n = 0;
		for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += built.get(`${i + a},${j + b}`) ?? 0;
		return n >= 3;
	};
	// węzły dróg: klucz z decymetrów → drogi, które przez niego przechodzą
	const streets = roads.filter((r) => r[0] >= 1 && r[0] <= 4 && r[2] === 0 && !r[3]);
	const nodes = new Map(), degree = new Map();
	streets.forEach((r, ri) => {
		const c = r[5], n = c.length / 2;
		for (let i = 0; i < n; i++) {
			const k = `${c[i * 2]},${c[i * 2 + 1]}`;
			let s = nodes.get(k);
			if (!s) nodes.set(k, (s = new Set()));
			s.add(ri);
			degree.set(k, (degree.get(k) ?? 0) + (i === 0 || i === n - 1 ? 1 : 2));
		}
	});
	const out = [], placed = [];
	// punkt w odległości d od wierzchołka k wzdłuż drogi w kierunku dir (null – droga krótsza)
	const walk = (c, k, dir, d) => {
		let i = k, left = d;
		for (;;) {
			const j = i + dir;
			if (j < 0 || j >= c.length / 2) return null;
			const x0 = c[i * 2] / 10, z0 = c[i * 2 + 1] / 10, x1 = c[j * 2] / 10, z1 = c[j * 2 + 1] / 10;
			const L = Math.hypot(x1 - x0, z1 - z0);
			if (L >= left) { const t = left / (L || 1); return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]; }
			left -= L;
			i = j;
		}
	};
	for (const [k, set] of nodes) {
		if (set.size < 2 || degree.get(k) < 3) continue;
		const [kx, kz] = k.split(',').map(Number);
		if (!isBuilt(kx / 10, kz / 10)) continue;
		if (![...set].some((ri) => streets[ri][0] <= 3)) continue;
		// odstęp od środka: połowa najszerszej drogi w węźle + zapas
		const near = Math.max(...[...set].map((ri) => streets[ri][1] / 20)) + NEAR;
		for (const ri of set) {
			const r = streets[ri], c = r[5];
			if (r[1] > 140) continue; // nie w poprzek szerokich arterii (ponad 4 pasy – tam przejścia podziemne i kładki)
			for (let v = 0; v < c.length / 2; v++) {
				if (c[v * 2] !== kx || c[v * 2 + 1] !== kz) continue;
				for (const dir of [-1, 1]) {
					if (!walk(c, v, dir, near + LEN + 3)) continue; // za krótki wylot
					const a = walk(c, v, dir, near), b = walk(c, v, dir, near + LEN);
					const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
					if (placed.some(([x, z]) => Math.hypot(x - mx, z - mz) < APART)) continue;
					placed.push([mx, mz]);
					out.push({ pts: dir > 0 ? [...a, ...b] : [...b, ...a], width: r[1] / 10 });
					if (out.length >= max) return out;
				}
			}
		}
	}
	return out;
}
