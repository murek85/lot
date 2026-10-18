// Ptaki (sama logika – testowana w Node): stada i pojedyncze ptaki wokół samolotu, gatunek z miejsca (pokrycie
// terenu), pory dnia, roku i pogody. Stada lecą jak „boidy” (spójność, wyrównanie, odstęp) za wędrującym celem
// i trzymają wysokość nad terenem; drapieżniki krążą w kominach termicznych, bociany szybują. Przelatywany z bliska
// samolot płoszy stado (ucieczka od niego), a ptak bliżej niż ~3 m od kadłuba to zderzenie.

/**
 * Gatunki: rozpiętość (m), prędkość (m/s), wysokość nad terenem [min, max], liczebność [min, max], machanie (Hz),
 * szybowanie (udział czasu bez machania), barwy [ciało, końce skrzydeł], gdzie (klasy pokrycia), kiedy.
 */
export const SPECIES = {
	starling: { span: 0.4, speed: 13, alt: [8, 70], count: [25, 70], flap: 9, glide: 0.1, col: [[0.06, 0.06, 0.07], [0.04, 0.04, 0.05]], cover: ['crop', 'grass'], flock: true },
	stork: { span: 2.0, speed: 10, alt: [40, 200], count: [1, 4], flap: 2, glide: 0.7, col: [[0.85, 0.85, 0.83], [0.05, 0.05, 0.05]], cover: ['grass', 'wetland'], flock: false, season: [80, 250] },
	buzzard: { span: 1.25, speed: 9, alt: [70, 320], count: [1, 2], flap: 3, glide: 0.9, col: [[0.32, 0.22, 0.14], [0.15, 0.1, 0.07]], cover: ['crop', 'grass', 'forest'], flock: false, thermal: true },
	gull: { span: 1.2, speed: 11, alt: [10, 70], count: [4, 14], flap: 3.5, glide: 0.5, col: [[0.88, 0.88, 0.9], [0.35, 0.36, 0.4]], cover: ['water'], flock: true },
	crow: { span: 0.95, speed: 11, alt: [15, 90], count: [6, 24], flap: 4, glide: 0.25, col: [[0.05, 0.05, 0.06], [0.03, 0.03, 0.035]], cover: ['built', 'crop'], flock: true },
};
export const SPECIES_IDS = Object.keys(SPECIES);

const rnd = (r, a, b) => a + r() * (b - a);
function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/**
 * Które gatunki teraz: env { sunY, day (dzień roku), hour, weather: { precip, storm } }. Zwraca wagi gatunków
 * (0 – brak). Noc i burza – nic; deszcz – mniej, śnieg – tylko wrony; o zmierzchu – duże stada szpaków.
 */
export function speciesWeights(env) {
	const w = {};
	const day = env.sunY > -0.03;
	for (const id of SPECIES_IDS) w[id] = day ? 1 : 0;
	if (!day || env.weather?.storm) return Object.fromEntries(SPECIES_IDS.map((k) => [k, 0]));
	const pr = env.weather?.precip;
	if (pr?.type === 'snow') return { starling: 0, stork: 0, buzzard: 0, gull: 0.3, crow: 1 };
	const rain = pr?.type === 'rain' ? 0.35 : 1;
	for (const id of SPECIES_IDS) {
		const s = SPECIES[id];
		if (s.season && (env.day < s.season[0] || env.day > s.season[1])) w[id] = 0;
		w[id] *= rain;
	}
	// myszołowy krążą w kominach termicznych – pogodne popołudnie; szpaki – o zmierzchu najwięcej
	w.buzzard *= env.hour > 10 && env.hour < 18 && !pr ? 1.4 : 0.3;
	if (env.sunY < 0.12) w.starling *= 2.5;
	return w;
}

export class BirdSim {
	/** opts: { groundAt(x, z), coverAt(x, z) → nazwa klasy, radius, maxGroups, seed }. */
	constructor(opts = {}) {
		this.groundAt = opts.groundAt ?? (() => 0);
		this.coverAt = opts.coverAt ?? (() => 'crop');
		this.radius = opts.radius ?? 3000;
		this.maxGroups = opts.maxGroups ?? 14;
		this.random = rng(opts.seed ?? 4242);
		this.groups = [];
		this.weights = Object.fromEntries(SPECIES_IDS.map((k) => [k, 1]));
		this.density = 1;
		this.events = []; // { type: 'strike' | 'scare' | 'call', species, x, y, z }
		this.t = 0;
	}

	get birds() { return this.groups.flatMap((g) => g.birds); }

	/**
	 * Nowa grupa w pierścieniu 400 m … promień: gatunek z pokrycia terenu w tym miejscu (wagami pory i pogody).
	 * Gdy znany kurs (center.hx, hz) – zwykle przed samolotem (±60°), żeby ptaki były w kadrze.
	 */
	spawn(center) {
		const r = this.random;
		const ahead = center.hx !== undefined && r() < 0.75;
		const a = ahead ? Math.atan2(center.hz, center.hx) + (r() - 0.5) * (Math.PI * 2 / 3) : r() * Math.PI * 2;
		// przed samolotem bliżej (w kadrze kamery pościgowej), dookoła – dalej
		const d = ahead ? rnd(r, 150, Math.min(1500, this.radius)) : rnd(r, 400, this.radius);
		const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
		const cover = this.coverAt(x, z);
		const cands = SPECIES_IDS.filter((id) => SPECIES[id].cover.includes(cover) && this.weights[id] > 0);
		if (!cands.length) return null;
		let pick = r() * cands.reduce((s, id) => s + this.weights[id], 0), id = cands[0];
		for (const c of cands) { pick -= this.weights[c]; if (pick <= 0) { id = c; break; } }
		const S = SPECIES[id];
		const big = id === 'starling' && this.weights.starling > 1.5 ? 3 : 1; // stada szpaków o zmierzchu
		const n = Math.round(rnd(r, S.count[0], S.count[1]) * big);
		const alt = rnd(r, S.alt[0], S.alt[1]);
		const g = {
			id, S, x, z, alt, birds: [], scared: 0,
			// cel wędrówki (stado krąży po okolicy), u drapieżnika – środek komina termicznego
			tx: x, tz: z, retarget: 0, thermal: S.thermal ? { x, z, r: rnd(r, 35, 80), w: (r() < 0.5 ? 1 : -1) * rnd(r, 0.08, 0.14) } : null,
		};
		const heading = r() * Math.PI * 2;
		for (let i = 0; i < n; i++) {
			const spread = S.flock ? 6 + Math.sqrt(n) * 2.5 : 30;
			const b = {
				species: id, span: S.span * rnd(r, 0.9, 1.1),
				x: x + (r() - 0.5) * spread, z: z + (r() - 0.5) * spread, y: 0,
				vx: Math.sin(heading) * S.speed, vy: 0, vz: -Math.cos(heading) * S.speed,
				phase: r() * Math.PI * 2, flapK: rnd(r, 0.85, 1.15), glide: 0, group: g,
			};
			b.y = this.groundAt(b.x, b.z) + alt + (r() - 0.5) * 8;
			if (g.thermal) { b.ang = (i / n) * Math.PI * 2; b.ty = b.y; }
			g.birds.push(b);
		}
		this.groups.push(g);
		return g;
	}

	/** Krok: center – samolot (punkt odniesienia i płoszenie), plane – { x, y, z, vx, vy, vz } albo null. */
	step(dt, center, plane = null) {
		this.t += dt;
		this.events.length = 0;
		const target = Math.round(this.maxGroups * this.density * Math.min(1, Object.values(this.weights).reduce((a, b) => a + b, 0) / 2));
		for (let tries = 0; tries < 3 && this.groups.length < target; tries++) this.spawn(center);
		const r = this.random, R2 = (this.radius * 1.2) ** 2;
		// grupy daleko za samolotem ustępują miejsca nowym przed nim (gdy osiągnięto limit) – jedna na ~2 s
		if (this.groups.length >= target && center.hx !== undefined && r() < dt * 0.5) {
			const i = this.groups.findIndex((g) => (g.x - center.x) * center.hx + (g.z - center.z) * center.hz < -700);
			if (i >= 0) this.groups.splice(i, 1);
		}
		const keep = [];
		for (const g of this.groups) {
			const S = g.S;
			// środek grupy
			let cx = 0, cy = 0, cz = 0, avx = 0, avz = 0;
			for (const b of g.birds) { cx += b.x; cy += b.y; cz += b.z; avx += b.vx; avz += b.vz; }
			const n = g.birds.length || 1;
			cx /= n; cy /= n; cz /= n; avx /= n; avz /= n;
			g.x = cx; g.z = cz; g.y = cy;
			// płoszenie: samolot bliżej niż ~140 m od stada
			if (plane) {
				const d = Math.hypot(plane.x - cx, plane.y - cy, plane.z - cz);
				if (d < 140 && g.scared <= 0) { g.scared = 6; this.events.push({ type: 'scare', species: g.id, x: cx, y: cy, z: cz }); }
			}
			if (g.scared > 0) g.scared -= dt;
			// nowy cel wędrówki co kilkanaście sekund (stado krąży w promieniu ~600 m)
			g.retarget -= dt;
			if (g.retarget <= 0 && !g.thermal) {
				g.retarget = rnd(r, 8, 20);
				g.tx = cx + (r() - 0.5) * 1200; g.tz = cz + (r() - 0.5) * 1200;
			}
			// odgłosy (do dźwięku) – co jakiś czas od grupy
			if (r() < dt * (S.flock ? 0.6 : 0.15)) this.events.push({ type: 'call', species: g.id, x: cx, y: cy, z: cz });
			for (const b of g.birds) {
				let ax = 0, ay = 0, az = 0;
				const ground = this.groundAt(b.x, b.z);
				if (g.thermal && g.scared <= 0) {
					// krążenie w kominie termicznym: po okręgu, powolne wznoszenie i opadanie
					b.ang += g.thermal.w * dt * (S.speed / 9);
					const px = g.thermal.x + Math.cos(b.ang) * g.thermal.r, pz = g.thermal.z + Math.sin(b.ang) * g.thermal.r;
					const py = ground + g.alt + Math.sin(this.t * 0.05 + b.phase) * 40;
					ax += (px - b.x) * 0.8 - b.vx * 0.4; az += (pz - b.z) * 0.8 - b.vz * 0.4; ay += (py - b.y) * 0.3 - b.vy * 0.5;
				} else {
					// cel stada i wysokość nad terenem
					const tx = g.tx - b.x, tz = g.tz - b.z, tl = Math.hypot(tx, tz) || 1;
					ax += (tx / tl) * 2; az += (tz / tl) * 2;
					ay += (ground + g.alt - b.y) * 0.25 - b.vy * 0.6;
					if (S.flock) {
						// spójność, wyrównanie, odstęp (z sąsiadami w stadzie)
						ax += (cx - b.x) * 0.15 + (avx - b.vx) * 0.5;
						az += (cz - b.z) * 0.15 + (avz - b.vz) * 0.5;
						ay += (cy - b.y) * 0.1;
						for (const o of g.birds) {
							if (o === b) continue;
							const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, d2 = dx * dx + dy * dy + dz * dz;
							if (d2 < 9 && d2 > 1e-4) { const k = 6 / d2; ax += dx * k; ay += dy * k; az += dz * k; }
						}
						// falowanie stada szpaków (wirująca chmura)
						if (g.id === 'starling') { ax += Math.sin(this.t * 0.7 + b.phase * 0.2) * 3; az += Math.cos(this.t * 0.5 + b.phase * 0.2) * 3; ay += Math.sin(this.t * 1.1 + b.phase) * 1.5; }
					}
				}
				// ucieczka: od samolotu, w bok i w dół (ptaki nurkują przed zagrożeniem)
				if (g.scared > 0 && plane) {
					const dx = b.x - plane.x, dy = b.y - plane.y, dz = b.z - plane.z, d = Math.hypot(dx, dy, dz) || 1;
					const k = 40 / Math.max(15, d);
					ax += (dx / d) * k * 6; az += (dz / d) * k * 6; ay += ((dy / d) * k - 1) * 4;
				}
				// zderzenie z samolotem
				if (plane && Math.hypot(b.x - plane.x, b.y - plane.y, b.z - plane.z) < 3 + b.span) {
					this.events.push({ type: 'strike', species: b.species, x: b.x, y: b.y, z: b.z });
					b.dead = true;
				}
				b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
				// prędkość w granicach gatunku (wystraszony – szybciej)
				const vmax = S.speed * (g.scared > 0 ? 1.7 : 1.15), vmin = S.speed * 0.6;
				const v = Math.hypot(b.vx, b.vy, b.vz) || 1;
				const k = v > vmax ? vmax / v : v < vmin ? vmin / v : 1;
				b.vx *= k; b.vy *= k; b.vz *= k;
				b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
				if (b.y < ground + 2) { b.y = ground + 2; b.vy = Math.abs(b.vy); }
				// machanie: szybowanie z przerwami (bocian, myszołów), wystraszony – machanie ciągłe
				b.glide = g.scared > 0 ? 0 : (Math.sin(this.t * 0.4 + b.phase) * 0.5 + 0.5) < S.glide ? 1 : 0;
				b.phase += dt * S.flap * b.flapK * Math.PI * 2 * (1 - b.glide * 0.97);
			}
			g.birds = g.birds.filter((b) => !b.dead);
			if (g.birds.length && (cx - center.x) ** 2 + (cz - center.z) ** 2 < R2) keep.push(g);
		}
		this.groups = keep;
	}
}
