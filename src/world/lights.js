// Nocne światła osad w otwartym świecie – ten sam interfejs co src/citylights.js (uniformy, groundLight, poświaty,
// update), ale z kafli: latarnie liczone dla każdego kafla (ulice w zabudowie, jak w regionach), poświaty w jednym
// spricie z instancjami (wszystkie wczytane kafle – łańcuchy świateł po horyzont), plamy światła na ziemi w oknie
// wokół kamery (tekstura adresowana w kółko jak okno gruntu, src/world/window.js).
import { Sprite, SpriteNodeMaterial, AdditiveBlending, DataTexture, RedFormat, UnsignedByteType, LinearFilter, RepeatWrapping, InstancedBufferAttribute, Vector2 } from 'three/webgpu';
import { uniform, texture, vec3, float, uv, dot, exp, max, cameraPosition, length, instancedBufferAttribute, clamp, step } from 'three/tsl';
import { densify } from '../roads.js';
import { onGround } from '../gfx/ground.js';
import { rng } from '../clouds/noise3d.js';
import { lampPositions, windowsLit } from '../citylights.js';
import { gridHeightAt } from './streamer.js';
import { COVER } from '../gen/terrain.js';
import { SignalLights, signalPositions } from '../signals.js';
import { CalendarLights, candlePositions, festivePositions, festiveOn } from '../calendar.js';

const SPACING = 34, DENSE = 50;
const SIZE = 2816, RES = 512, CELL = SIZE / RES, STEP = 128; // okno plam światła (jak okno gruntu)
const CAP = 200000; // poświaty (latarnie kafli bliskich i światła zabudowy dalekiego terenu)
const STREET_E = 0.5;

/** Latarnie kafla: [x, y, z, rodzaj] (rodzaj 0 – sodowa, 1 – LED); ulice klas 1–4 tam, gdzie wokół stoją domy. */
export function chunkLamps(ch) {
	const f = ch.frame, gx = Math.ceil(f.w / DENSE), gz = Math.ceil(f.h / DENSE);
	const dens = new Uint16Array(gx * gz);
	for (const [type, , , , c] of ch.osm.buildings) {
		if (type === 2) continue;
		const i = Math.floor((c[0] / 10 - f.x0) / DENSE), j = Math.floor((c[1] / 10 - f.z0) / DENSE);
		if (i >= 0 && j >= 0 && i < gx && j < gz) dens[j * gx + i]++;
	}
	const built = (x, z) => {
		const i = Math.floor((x - f.x0) / DENSE), j = Math.floor((z - f.z0) / DENSE);
		let n = 0;
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
			const ii = i + di, jj = j + dj;
			if (ii >= 0 && jj >= 0 && ii < gx && jj < gz) n += dens[jj * gx + ii];
		}
		return n >= 4;
	};
	const out = [];
	const r = rng(9090 + (ch.x * 7919 + ch.y) % 100000);
	const inside = (x, z) => x >= f.x0 && x < f.x0 + f.w && z >= f.z0 && z < f.z0 + f.h;
	extraLamps(ch.osm, (x, z, kind, dy) => { if (inside(x, z)) out.push(x, gridHeightAt(ch, x, z) + dy, z, kind); });
	for (const [cls, w10, , bridge, , c] of ch.osm.roads) {
		if (cls < 1 || cls > 4) continue;
		const p = [];
		for (let i = 0; i < c.length; i += 2) p.push(c[i] / 10, c[i + 1] / 10);
		if (p.length < 4) continue;
		for (const [x, z] of lampPositions(densify(p, 20), SPACING, w10 / 20 + 1.2)) {
			if (!built(x, z) && !bridge) continue;
			if (x < f.x0 || x >= f.x0 + f.w || z < f.z0 || z >= f.z0 + f.h) continue;
			out.push(x, gridHeightAt(ch, x, z) + 7.5, z, r() < 0.55 ? 0 : 1);
		}
	}
	return new Float32Array(out);
}

/**
 * Światła lotnisk i oświetlonych tras zjazdowych z danych (pasy, drogi kołowania, trasy z piste:lit): put(x, z,
 * rodzaj, wysokość nad terenem). Lotniska: krawędzie pasa co 30 m po obu stronach (3 – białe), progi (4 – zielone)
 * i końce (5 – czerwone), światła podejścia na przedłużeniu osi (~900 m), krawędzie dróg kołowania (6 – niebieskie).
 * Trasy (2 – reflektory, tylko zimą): maszty co ~30 m po obu stronach linii trasy albo co ~45 m po obrysie.
 */
export function extraLamps(osm, put) {
	const pts = (c) => { const p = []; for (let i = 0; i < c.length; i += 2) p.push(c[i] / 10, c[i + 1] / 10); return p; };
	for (const [w10, c] of osm.runways ?? []) {
		const p = pts(c);
		if (p.length < 4) continue;
		const hw = w10 / 20 + 1;
		for (const [x, z] of lampPositions(densify(p, 20), 30, hw)) put(x, z, 3, 0.6);
		for (const [end, nxt] of [[0, 2], [p.length - 2, p.length - 4]]) {
			const ex = p[end], ez = p[end + 1], dx = ex - p[nxt], dz = ez - p[nxt + 1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
			for (let k = -4; k <= 4; k++) { put(ex - uz * k * hw / 4, ez + ux * k * hw / 4, 4, 0.6); put(ex - uz * k * hw / 4 - ux * 3, ez + ux * k * hw / 4 - uz * 3, 5, 0.6); }
			for (let d = 60; d <= 900; d += 30) put(ex + ux * d, ez + uz * d, 3, 1.5);
		}
	}
	for (const [w10, c] of osm.taxiways ?? []) {
		const p = pts(c);
		if (p.length >= 4) for (const [x, z] of lampPositions(densify(p, 20), 25, Math.min(12, w10 / 20) + 0.5)) put(x, z, 6, 0.4);
	}
	for (const [lit, c, poly] of osm.pistes ?? []) {
		const p = pts(c);
		if (lit && p.length >= 4) for (const [x, z] of lampPositions(densify(p, 20), poly ? 45 : 30, poly ? 0 : 18)) put(x, z, 2, 10);
	}
}

/** Barwy świateł lotnisk (rodzaje 3–6, extraLamps). */
export const AIR_LIGHT = { 3: [1, 0.93, 0.8], 4: [0.15, 1, 0.35], 5: [1, 0.08, 0.04], 6: [0.2, 0.35, 1] };

/**
 * Daleki teren (kafle z11 do ~50 km): światła z zabudowy na rastrze pokrycia (~50 m na piksel) – co trzeci piksel
 * zabudowy, w losowym miejscu piksela, 6 m nad siatką kafla: z daleka miasta i wsie świecą łańcuchami po horyzont.
 * [x, y, z, rodzaj] jak latarnie.
 */
export function farLamps(ch) {
	const R = Math.round(Math.sqrt(ch.cover.length)), f = ch.frame, out = [];
	const r = rng(4242 + (ch.x * 7919 + ch.y) % 100000);
	for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
		if (ch.cover[j * R + i] !== COVER.built || r() > 0.33) continue;
		const x = f.x0 + ((i + r()) / R) * f.w, z = f.z0 + ((j + r()) / R) * f.h;
		out.push(x, gridHeightAt(ch, x, z) + 6, z, r() < 0.55 ? 0 : 1);
	}
	return new Float32Array(out);
}

export class WorldLights {
	constructor() {
		this.U = {
			street: uniform(0), windows: uniform(0), glow: uniform(0), winGlow: uniform(1), festive: uniform(0), camXZ: uniform(new Vector2()),
			org: uniform(new Vector2(1e9, 1e9)), // róg okna plam światła (poza oknem – bez światła)
		};
		this.uniforms = this.U;
		this.lamps = new Map(); // "x/y" → { frame, data }
		this.far = new Map(); // daleki teren: "x/y" → dane jak latarnie (farLamps)
		this.queue = [];
		this.data = new Uint8Array(RES * RES);
		this.tex = new DataTexture(this.data, RES, RES, RedFormat, UnsignedByteType);
		this.tex.wrapS = this.tex.wrapT = RepeatWrapping;
		this.tex.minFilter = this.tex.magFilter = LinearFilter;
		this.tex.needsUpdate = true;
		this.lightTex = texture(this.tex);
		this.ox = null; this.oz = null;
		this.dirty = [];
		this.glowDirty = false;
		this.glowAt = 0;
		this.stats = { lamps: 0, ms: 0 };
	}

	/**
	 * Natężenie światła latarni na ziemi w punkcie p (świat) – z okna wokół kamery. Tekstura adresowana w kółko: poza
	 * oknem (dalej niż ~1,4 km od kamery) odczyt trafiłby w plamy innego miejsca – świecące „ulice” na zboczach gór
	 * i w lasach – więc tam światła nie ma.
	 */
	groundLight(p) {
		const v = this.lightTex.sample(p.xz.div(SIZE)).level(0).r;
		const q = p.xz.sub(this.U.org);
		const inside = step(CELL, q.x).mul(step(q.x, SIZE - CELL)).mul(step(CELL, q.y)).mul(step(q.y, SIZE - CELL));
		return vec3(1.0, 0.72, 0.42).mul(v.mul(255 / 200).mul(STREET_E).mul(this.U.street).mul(inside));
	}

	createGlows(terrain, pixelAngle) {
		this.pos = new InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
		this.col = new InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
		this.pos.setUsage(35048); this.col.setUsage(35048);
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
		const center = instancedBufferAttribute(this.pos), color = instancedBufferAttribute(this.col);
		const world = onGround(center, this.U.camXZ);
		m.positionNode = world;
		const dist = length(cameraPosition.sub(world));
		const s = max(float(1.2), dist.mul(pixelAngle).mul(4)).min(80);
		m.scaleNode = vec3(s, s, 1).xy;
		const q = uv().sub(0.5).mul(2);
		const r2 = dot(q, q);
		const f = exp(r2.mul(-9)).add(float(0.06).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
		// powietrze gasi dalekie światła (~1/3 na 30 km) – łuna po horyzont, ale słabsza niż ulica pod samolotem
		m.colorNode = color.mul(f.mul(this.U.glow).mul(1.6).mul(exp(dist.mul(-1 / 30000))));
		this.sprite = new Sprite(m);
		this.sprite.count = 0;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 15;
		this.signals = new SignalLights();
		this.sprite.add(this.signals.createSprite(this.U.glow, this.U.camXZ, pixelAngle));
		this.calendar = new CalendarLights();
		this.sprite.add(this.calendar.createSprite(this.U.glow, this.U.camXZ, pixelAngle));
		return this.sprite;
	}

	chunkLoaded(ch) { this.queue.push(ch); }

	farLoaded(ch) { if (ch.cover?.length) { this.far.set(ch.key, farLamps(ch)); this.glowDirty = true; } }
	farUnloaded(ch) { if (this.far.delete(ch.key)) this.glowDirty = true; }

	chunkUnloaded(ch) {
		const qi = this.queue.indexOf(ch);
		if (qi >= 0) this.queue.splice(qi, 1);
		if (this.lamps.delete(ch.key)) this.glowDirty = true;
	}

	/** Godzina, wysokość słońca, adaptacja oka, kamera (jak w regionach) + latarnie nowych kafli i okno plam. */
	update(hour, sunY, adapt, camera, day = 180) {
		this.calendar?.update(day, hour);
		// sezon narciarski (XII–III): reflektory tras – przebudowa poświat i plam światła
		const winter = day >= 335 || day <= 80;
		if (winter !== this.winter) { this.winter = winter; this.glowDirty = true; this.glowAt = 0; if (this.ox !== null) this.dirty = [[this.ox, this.ox + SIZE, this.oz, this.oz + SIZE]]; }
		this.U.festive.value = festiveOn(day);
		const dusk = Math.min(1, Math.max(0, (0.03 - sunY) / 0.06));
		this.U.street.value = dusk;
		this.U.windows.value = windowsLit(hour) * Math.min(1, Math.max(0, (0.12 - sunY) / 0.15));
		this.U.glow.value = dusk * adapt;
		this.U.winGlow.value = adapt;
		this.signals?.update(hour);
		const cx = camera.position.x, cz = camera.position.z;
		this.U.camXZ.value.set(cx, cz);
		const t0 = performance.now();
		// latarnie kafli z kolejki (najbliższe najpierw), ~2 ms na klatkę
		if (this.queue.length) {
			this.queue.sort((a, b) => Math.hypot(b.frame.x0 - cx, b.frame.z0 - cz) - Math.hypot(a.frame.x0 - cx, a.frame.z0 - cz));
			while (this.queue.length && performance.now() - t0 < 2) {
				const ch = this.queue.pop();
				const data = chunkLamps(ch), hAt = (x, z) => gridHeightAt(ch, x, z);
				const cal = new Float32Array(festivePositions(data, candlePositions(ch.osm.cemeteries ?? [], hAt)));
				this.lamps.set(ch.key, { frame: ch.frame, data, sig: signalPositions(ch.osm.roads, ch.osm.buildings, hAt), cal });
				this.glowDirty = true;
				this.markRect(ch.frame.x0 - 20, ch.frame.x0 + ch.frame.w + 20, ch.frame.z0 - 20, ch.frame.z0 + ch.frame.h + 20);
			}
		}
		// poświaty: bufor od nowa po zmianie zestawu kafli (najwyżej 2 razy na sekundę)
		if (this.glowDirty && this.pos && performance.now() - this.glowAt > 500) {
			const P = this.pos.array, C = this.col.array;
			let n = 0;
			const put = (data, i) => {
				P[n * 3] = data[i]; P[n * 3 + 1] = data[i + 1]; P[n * 3 + 2] = data[i + 2];
				if (data[i + 3] === 2 && !this.winter) return; // reflektory tras narciarskich – tylko zimą
				const AIR = AIR_LIGHT[data[i + 3]];
				if (AIR) { C[n * 3] = AIR[0]; C[n * 3 + 1] = AIR[1]; C[n * 3 + 2] = AIR[2]; } else if (data[i + 3]) { C[n * 3] = 0.85; C[n * 3 + 1] = 0.9; C[n * 3 + 2] = 1.0; } else { C[n * 3] = 1.0; C[n * 3 + 1] = 0.62; C[n * 3 + 2] = 0.28; }
				n++;
			};
			const near = new Set();
			let ref = null;
			for (const { frame, data } of this.lamps.values()) {
				ref ??= frame;
				near.add(`${Math.round((frame.x0 - ref.x0) / ref.w)},${Math.round((frame.z0 - ref.z0) / ref.h)}`);
				for (let i = 0; i < data.length && n < CAP; i += 4) put(data, i);
			}
			// daleki teren – poza kaflami bliskimi (tam prawdziwe latarnie); kafle z14 to równa siatka w układzie świata
			const covered = (x, z) => ref && near.has(`${Math.floor((x - ref.x0) / ref.w)},${Math.floor((z - ref.z0) / ref.h)}`);
			for (const data of this.far.values()) {
				for (let i = 0; i < data.length && n < CAP; i += 4) if (!covered(data[i], data[i + 2])) put(data, i);
			}
			this.sprite.count = n;
			this.signals.set([...this.lamps.values()].map((l) => l.sig));
			this.calendar.set([...this.lamps.values()].map((l) => l.cal));
			this.pos.needsUpdate = this.col.needsUpdate = true;
			this.glowDirty = false;
			this.glowAt = performance.now();
			this.stats.lamps = n;
		}
		// okno plam światła: przesunięcie skokami, przepisanie pasów, które do niego weszły
		const nx = Math.floor((cx - SIZE / 2) / STEP) * STEP, nz = Math.floor((cz - SIZE / 2) / STEP) * STEP;
		if (this.ox === null || Math.abs(nx - this.ox) >= SIZE || Math.abs(nz - this.oz) >= SIZE) {
			this.ox = nx; this.oz = nz;
			this.U.org.value.set(nx, nz);
			this.dirty = [[nx, nx + SIZE, nz, nz + SIZE]];
		} else if (nx !== this.ox || nz !== this.oz) {
			if (nx > this.ox) this.dirty.push([this.ox + SIZE, nx + SIZE, nz, nz + SIZE]);
			if (nx < this.ox) this.dirty.push([nx, this.ox, nz, nz + SIZE]);
			if (nz > this.oz) this.dirty.push([nx, nx + SIZE, this.oz + SIZE, nz + SIZE]);
			if (nz < this.oz) this.dirty.push([nx, nx + SIZE, nz, this.oz]);
			this.ox = nx; this.oz = nz;
			this.U.org.value.set(nx, nz);
		}
		if (this.dirty.length) {
			while (this.dirty.length) this.fill(...this.dirty.shift());
			this.tex.needsUpdate = true;
		}
		this.stats.ms = performance.now() - t0;
	}

	/** Nowy początek układu w (dx, dz) – wielokrotność SIZE (okno plam zostaje ważne): latarnie i róg okna. */
	shift(dx, dz) {
		for (const data of [...[...this.lamps.values()].flatMap((l) => [l.data, l.sig]), ...this.far.values()]) for (let i = 0; i < data.length; i += 4) { data[i] -= dx; data[i + 2] -= dz; }
		if (this.ox !== null) { this.ox -= dx; this.oz -= dz; this.U.org.value.set(this.ox, this.oz); }
		this.dirty = this.dirty.map(([a, b, c, d]) => [a - dx, b - dx, c - dz, d - dz]);
		for (const { cal } of this.lamps.values()) for (let i = 0; i < cal.length; i += 5) { cal[i] -= dx; cal[i + 2] -= dz; }
		this.glowDirty = true;
		this.glowAt = 0;
	}

	markRect(xa, xb, za, zb) { if (this.ox !== null) this.dirty.push([xa, xb, za, zb]); }

	/** Plamy latarni w prostokącie (środki pikseli w [xa, xb) × [za, zb), w oknie): zerowanie i sumowanie. */
	fill(xa, xb, za, zb) {
		xa = Math.max(xa, this.ox); xb = Math.min(xb, this.ox + SIZE); za = Math.max(za, this.oz); zb = Math.min(zb, this.oz + SIZE);
		if (xa >= xb || za >= zb) return;
		const i0 = Math.ceil(xa / CELL - 0.5), i1 = Math.ceil(xb / CELL - 0.5), j0 = Math.ceil(za / CELL - 0.5), j1 = Math.ceil(zb / CELL - 0.5);
		const d = this.data, w = (i) => ((i % RES) + RES) % RES;
		for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) d[w(j) * RES + w(i)] = 0;
		for (const { frame: f, data } of this.lamps.values()) {
			if (f.x0 > xb + 40 || f.x0 + f.w < xa - 40 || f.z0 > zb + 40 || f.z0 + f.h < za - 40) continue;
			for (let k = 0; k < data.length; k += 4) {
				const x = data[k], z = data[k + 2];
				if ((data[k + 3] === 2 && !this.winter) || data[k + 3] >= 3) continue; // światła lotnisk – bez plam na ziemi
				if (x < xa - 40 || x > xb + 40 || z < za - 40 || z > zb + 40) continue;
				const fx = x / CELL - 0.5, fz = z / CELL - 0.5, ci = Math.floor(fx), cj = Math.floor(fz);
				for (let j = Math.max(j0, cj - 3); j <= Math.min(j1 - 1, cj + 4); j++) for (let i = Math.max(i0, ci - 3); i <= Math.min(i1 - 1, ci + 4); i++) {
					const d2 = ((i - fx) ** 2 + (j - fz) ** 2) * CELL * CELL;
					const o = w(j) * RES + w(i);
					d[o] = Math.min(255, d[o] + Math.round(Math.exp(-d2 / (2 * 11 * 11)) * 200));
				}
			}
		}
	}
}
