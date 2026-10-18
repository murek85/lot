// Budynki 3D z obrysów OpenStreetMap: ściany do wysokości z pięter (albo domyślnej dla rodzaju budynku), dachy
// dwuspadowe dla domów i budynków gospodarczych o kształcie bliskim prostokąta (kalenica wzdłuż dłuższego boku
// najmniejszego prostokąta otaczającego), płaskie dla bloków, hal i obrysów nieregularnych. Kolory dachów i elewacji
// losowane z typowych dla Pomorza, okna rysowane w shaderze z siatki pięter. Geometria scalona w kafelki 2 km.
import { Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, ShapeUtils, Vector2, DoubleSide, SpriteNodeMaterial, Sprite, InstancedBufferAttribute, AdditiveBlending } from 'three/webgpu';
import {
	Fn, float, vec2, vec3, floor, attribute, varying, positionLocal, uniform, max, mix, smoothstep, step, fract, dot, normalize,
	cameraPosition, pow, select, fwidth, instancedBufferAttribute, uv, exp, clamp, length, time,
} from 'three/tsl';
import { onGround, cityLight, cityUniforms, worldOffset } from './gfx/ground.js';
import { hash12 } from './gfx/noise.js';
import { valueNoise } from './gfx/noise.js';
import { rng } from './clouds/noise3d.js';
import { CASTER_LAYER } from './shadows.js';
import { structureKind, coolingProfile, beaconHeights } from './gfx/structures.js';

const EARTH_R = 6371000;
const TILE = 2000;

// Typy z wypiekania: 0 dom, 1 blok, 2 gospodarczy/garaż, 3 przemysł, 4 usługi, 5 publiczny, 6 kościół, 7 inny
const ROOF_COLORS = [
	[0.30, 0.085, 0.045], [0.24, 0.07, 0.04], [0.16, 0.075, 0.05], [0.055, 0.055, 0.06], [0.11, 0.10, 0.10], [0.20, 0.11, 0.08],
];
const WALL_COLORS = [
	[0.62, 0.58, 0.50], [0.55, 0.52, 0.46], [0.66, 0.64, 0.58], [0.50, 0.44, 0.34], [0.30, 0.13, 0.08], [0.45, 0.46, 0.44],
];

/** Najmniejszy prostokąt otaczający (po kierunkach krawędzi): { angle, w, h, cx, cz, area }. */
export function minRect(pts) {
	const n = pts.length / 2;
	let best = null;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const a = Math.atan2(pts[j * 2 + 1] - pts[i * 2 + 1], pts[j * 2] - pts[i * 2]);
		const c = Math.cos(a), s = Math.sin(a);
		let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
		for (let k = 0; k < n; k++) {
			const x = pts[k * 2], z = pts[k * 2 + 1];
			const u = x * c + z * s, v = -x * s + z * c;
			minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
		}
		const area = (maxU - minU) * (maxV - minV);
		if (!best || area < best.area) {
			const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
			best = { angle: a, w: maxU - minU, h: maxV - minV, cx: cu * c - cv * s, cz: cu * s + cv * c, area };
		}
	}
	return best;
}

export function polygonArea2(pts) {
	let a = 0;
	const n = pts.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
	}
	return a / 2;
}

/** Geometria jednego budynku dopisywana do bufora b. pts – obrys (metry, bez powtórzonego końca), base – wysokość podstawy. */
export function addBuilding(b, pts, base, wallH, roofKind, wall, roof, seed) {
	const n = pts.length / 2;
	const push = (x, y, z, nx, ny, nz, kind, u, v) => {
		b.pos.push(x, y, z); b.nrm.push(nx, ny, nz); b.kind.push(kind); b.uv.push(u, v);
		b.wall.push(...wall); b.roof.push(...roof);
		return b.count++;
	};
	// ściany (płaskie cieniowanie – osobne wierzchołki na ścianę), u = metry wzdłuż obwodu, v = metry w górę
	let perim = 0;
	const top = base + wallH;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[j * 2], z1 = pts[j * 2 + 1];
		const len = Math.hypot(x1 - x0, z1 - z0);
		if (len < 0.05) continue;
		const nx = (z1 - z0) / len, nz = -(x1 - x0) / len; // na zewnątrz dla obrysu o dodatnim polu (x–z)
		const a = push(x0, base, z0, nx, 0, nz, 0, perim, 0), c = push(x1, base, z1, nx, 0, nz, 0, perim + len, 0);
		const d = push(x1, top, z1, nx, 0, nz, 0, perim + len, wallH), e = push(x0, top, z0, nx, 0, nz, 0, perim, wallH);
		b.idx.push(a, c, d, a, d, e);
		perim += len;
	}
	if (roofKind === 4) {
		// hełm wieży: ostrosłup nad obrysem
		let cx = 0, cz = 0;
		for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
		cx /= n; cz /= n;
		let rad = 0;
		for (let i = 0; i < n; i++) rad = Math.max(rad, Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cz));
		const apex = top + rad * 3.2;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			const mx = (pts[i * 2] + pts[j * 2]) / 2 - cx, mz = (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2 - cz;
			const ml = Math.hypot(mx, mz) || 1;
			const ny = 0.3, k = Math.sqrt(1 - ny * ny);
			const a = push(pts[i * 2], top, pts[i * 2 + 1], (mx / ml) * k, ny, (mz / ml) * k, 1, 0, 0);
			const c = push(pts[j * 2], top, pts[j * 2 + 1], (mx / ml) * k, ny, (mz / ml) * k, 1, 1, 0);
			const e = push(cx, apex, cz, (mx / ml) * k, ny, (mz / ml) * k, 1, 0.5, 1);
			b.idx.push(a, c, e);
		}
	} else if (roofKind === 1) {
		// dach dwuspadowy na najmniejszym prostokącie otaczającym (z okapem 0,4 m), kalenica wzdłuż dłuższego boku
		const r = minRect(pts);
		let ang = r.angle, L = r.w, W = r.h;
		if (W > L) { ang += Math.PI / 2; [L, W] = [W, L]; }
		const c = Math.cos(ang), s = Math.sin(ang);
		const hl = L / 2 + 0.4, hw = W / 2 + 0.5;
		const pitch = 0.62 + seed * 0.25; // ~32–42°
		const rise = (W / 2) * Math.tan(pitch);
		const P = (u, v, y) => [r.cx + u * c - v * s, y, r.cz + u * s + v * c];
		const eave = top - 0.15;
		const ridge = top + rise;
		for (const side of [-1, 1]) {
			const [ax, ay, az] = P(-hl, side * hw, eave), [bx, by, bz] = P(hl, side * hw, eave);
			const [cx, cy, cz] = P(hl, 0, ridge), [dx, dy, dz] = P(-hl, 0, ridge);
			// normalna połaci
			const ny = Math.cos(pitch), off = Math.sin(pitch) * side;
			const nx = -s * off, nz = c * off;
			const i0 = push(ax, ay, az, nx, ny, nz, 1, 0, 0), i1 = push(bx, by, bz, nx, ny, nz, 1, hl * 2, 0);
			const i2 = push(cx, cy, cz, nx, ny, nz, 1, hl * 2, hw), i3 = push(dx, dy, dz, nx, ny, nz, 1, 0, hw);
			if (side > 0) b.idx.push(i0, i1, i2, i0, i2, i3); else b.idx.push(i0, i2, i1, i0, i3, i2);
		}
		// szczyty (trójkąty ścian pod dachem)
		for (const end of [-1, 1]) {
			const e = L / 2;
			const [ax, , az] = P(end * e, -W / 2, 0), [bx, , bz] = P(end * e, W / 2, 0), [tx, , tz] = P(end * e, 0, 0);
			const nx = c * end, nz = s * end;
			const i0 = push(ax, top, az, nx, 0, nz, 0, 0, wallH), i1 = push(bx, top, bz, nx, 0, nz, 0, W, wallH);
			const i2 = push(tx, ridge - 0.1, tz, nx, 0, nz, 0, W / 2, wallH + rise);
			if (end > 0) b.idx.push(i0, i1, i2); else b.idx.push(i0, i2, i1);
		}
	} else {
		// dach płaski: triangulacja obrysu, lekki attyk
		const contour = [];
		for (let i = 0; i < n; i++) contour.push(new Vector2(pts[i * 2], pts[i * 2 + 1]));
		const tris = ShapeUtils.triangulateShape(contour, []);
		const start = b.count;
		for (let i = 0; i < n; i++) push(pts[i * 2], top, pts[i * 2 + 1], 0, 1, 0, 2, pts[i * 2], pts[i * 2 + 1]);
		for (const t of tris) b.idx.push(start + t[0], start + t[2], start + t[1]);
	}
}

/**
 * Chłodnia kominowa: powłoka hiperboloidy (gładkie normalne) wokół środka (cx, cz), promień podstawy r0, wysokość h;
 * otwarta u góry (od środka ciemna – patrz cieniowanie tylnych ścian).
 */
export function addCoolingTower(b, cx, cz, r0, base, h, wall) {
	const SEG = 40, RINGS = 14;
	const first = b.count;
	for (let k = 0; k <= RINGS; k++) {
		const t = k / RINGS;
		const r = r0 * coolingProfile(t);
		// nachylenie powłoki dr/dy → normalna odchylona od poziomu
		const t0 = Math.max(0, t - 0.01), t1 = Math.min(1, t + 0.01);
		const dr = (r0 * (coolingProfile(t1) - coolingProfile(t0))) / ((t1 - t0) * h);
		const ny = -dr / Math.hypot(1, dr), nh = 1 / Math.hypot(1, dr);
		for (let i = 0; i <= SEG; i++) {
			const a = (i / SEG) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
			b.pos.push(cx + c * r, base + t * h, cz + s * r);
			b.nrm.push(c * nh, ny, s * nh);
			b.kind.push(0);
			b.uv.push((i / SEG) * 2 * Math.PI * r0, t * h);
			b.wall.push(...wall);
			b.roof.push(...wall);
			b.count++;
		}
	}
	for (let k = 0; k < RINGS; k++) for (let i = 0; i < SEG; i++) {
		const a = first + k * (SEG + 1) + i, c = a + SEG + 1;
		b.idx.push(a, c, a + 1, a + 1, c, c + 1);
	}
}

export function createBuildings(osm, region, terrain, atmo, clouds, plane, worldShadow = null, shared = null) {
	const half = region.size / 2 - 30;
	const tiles = new Map();
	const r = rng(77);
	let count = 0;
	const beacons = []; // światła przeszkodowe: [x, y, z] (y – bezwzględnie, nad poziomem morza)
	const structures = { chimney: 0, cooling: 0, tank: 0 };
	for (const [type, h10, roofTag, known, c] of osm.buildings) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) pts.push(c[i] / 10, c[i + 1] / 10);
		if (pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) pts = pts.slice(0, -2);
		const n = pts.length / 2;
		if (n < 3 || Math.abs(pts[0]) > half || Math.abs(pts[1]) > half) continue;
		let area = polygonArea2(pts);
		if (Math.abs(area) < 6) continue;
		// obrys o dodatnim polu w układzie x–z: wtedy normalna (dz, −dx) każdej krawędzi wskazuje na zewnątrz
		if (area < 0) {
			const rev = [];
			for (let i = n - 1; i >= 0; i--) rev.push(pts[i * 2], pts[i * 2 + 1]);
			pts = rev;
		}
		area = Math.abs(area);
		let cx = 0, cz = 0;
		for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
		cx /= n; cz /= n;
		let base = Infinity;
		for (let i = 0; i < n; i++) base = Math.min(base, terrain.meshHeightAt(pts[i * 2], pts[i * 2 + 1]));
		base -= 0.4;
		const seed = r();
		// wysokość ścian: z danych albo z rodzaju (domy: parterowe lub piętrowe)
		let wallH;
		const h = h10 / 10;
		if (known) wallH = Math.max(2.4, h - (type === 0 ? 1.2 : 0));
		else wallH = [seed < 0.55 ? 3.2 : 5.9, h, 2.7, Math.min(9, 4 + area / 300), 4, 7, 9, area > 120 ? 3.5 : 2.6][type];
		// budowle bez okien (kominy, chłodnie, zbiorniki) – z kształtu obrysu (src/gfx/structures.js)
		const sk = structureKind(pts, wallH, known);
		if (sk) {
			structures[sk]++;
			const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`;
			let b = tiles.get(key);
			if (!b) tiles.set(key, (b = { pos: [], nrm: [], kind: [], uv: [], wall: [], roof: [], idx: [], light: [], count: 0 }));
			const first = b.count;
			const concrete = [0.52 + seed * 0.08, 0.51 + seed * 0.08, 0.48 + seed * 0.07];
			// komin ceglany (niższe, starsze) albo betonowy; od 100 m – pasy przeszkodowe (biało-czerwone, w cieniowaniu)
			const striped = sk === 'chimney' && wallH >= 100;
			if (sk === 'cooling') addCoolingTower(b, cx, cz, Math.sqrt(area / Math.PI), base, wallH, concrete);
			else {
				const wall = sk === 'chimney' && wallH < 90 && seed < 0.5 ? [0.34, 0.15, 0.1] : sk === 'tank' ? [0.6, 0.6, 0.58] : concrete;
				addBuilding(b, pts, base, wallH, 0, wall, sk === 'chimney' ? [0.02, 0.02, 0.02] : [0.4, 0.4, 0.39], seed);
			}
			// x < 0 – bez okien (−2: z pasami); y – wysokość budowli (do pasów)
			for (let i = first; i < b.count; i++) b.light.push(striped ? -2 : -1, wallH);
			// lampy: nad wylotem (w osi trzon by je zasłaniał), niżej – po dwóch na zewnętrznej ścianie
			if (sk !== 'tank') {
				const rad = Math.sqrt(area / Math.PI) * (sk === 'cooling' ? coolingProfile(0.5) : 1) + 0.6;
				beaconHeights(wallH).forEach((y, i) => {
					if (i === 0) beacons.push([cx, base + wallH + 1.2, cz]);
					else beacons.push([cx + rad, base + y, cz], [cx - rad, base + y, cz]);
				});
			}
			count++;
			continue;
		}
		// dach: tag z OSM, inaczej dwuspadowy dla domów i gospodarczych o obrysie zbliżonym do prostokąta
		const rect = minRect(pts);
		const rectish = area / rect.area > 0.82 && rect.w * rect.h < 1600;
		let roofKind = roofTag === 1 || roofTag === 2 ? 1 : roofTag === 0 ? 0 : (type === 0 || type === 2 || type === 6 || (type === 7 && area < 400)) && rectish ? 1 : 0;
		if (roofKind === 1 && !rectish) roofKind = 0;
		const roof = type === 1 || type === 3 || roofKind === 0
			? (seed < 0.5 ? [0.13, 0.13, 0.135] : [0.07, 0.07, 0.075])
			: ROOF_COLORS[Math.floor(r() * ROOF_COLORS.length)];
		const wall = type === 3 ? [0.5, 0.5, 0.49] : type === 2 && r() < 0.5 ? WALL_COLORS[4] : WALL_COLORS[Math.floor(r() * WALL_COLORS.length)];
		const key = `${Math.floor(cx / TILE)},${Math.floor(cz / TILE)}`;
		let b = tiles.get(key);
		if (!b) tiles.set(key, (b = { pos: [], nrm: [], kind: [], uv: [], wall: [], roof: [], idx: [], light: [], count: 0 }));
		const first = b.count;
		addBuilding(b, pts, base, wallH, roofKind, wall, roof, r());
		// okna nocą: domy i bloki często, usługi i urzędy rzadziej, przemysł rzadko, gospodarcze – nigdy
		const lightP = [1, 1.1, 0, 0.25, 0.6, 0.45, 0.15, 0.7][type];
		for (let i = first; i < b.count; i++) b.light.push(lightP, seed);
		// kościół: wieża z hełmem na końcu dłuższego boku
		if (type === 6 && area > 120) {
			const rr = minRect(pts);
			let ang = rr.angle, L = rr.w, W = rr.h;
			if (W > L) { ang += Math.PI / 2; [L, W] = [W, L]; }
			const s = Math.min(W * 0.55, 7), c = Math.cos(ang), sn = Math.sin(ang);
			const tx = rr.cx - c * (L / 2 - s / 2), tz = rr.cz - sn * (L / 2 - s / 2);
			let corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [tx + ((u * c - v * sn) * s) / 2, tz + ((u * sn + v * c) * s) / 2]);
			if (polygonArea2(corners.flat()) < 0) corners = corners.reverse();
			const first2 = b.count;
			addBuilding(b, corners.flat(), base, wallH * 2.4 + 6, 4, wall, [0.12, 0.2, 0.16], 0.5);
			for (let i = first2; i < b.count; i++) b.light.push(0, seed);
		}
		count++;
	}

	// shared – wspólne materiały (kafle otwartego świata: jeden shader na wszystkie kafle)
	const material = shared?.material ?? makeMaterial(atmo, clouds, plane, worldShadow);
	const shadowMaterial = shared?.shadowMaterial ?? makeShadowMaterial(material.userData.camXZ);
	const meshes = [], shadowCasters = [];
	for (const b of tiles.values()) {
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute(b.pos, 3));
		g.setAttribute('normal', new Float32BufferAttribute(b.nrm, 3));
		g.setAttribute('aKind', new Float32BufferAttribute(b.kind, 1));
		g.setAttribute('aUv', new Float32BufferAttribute(b.uv, 2));
		g.setAttribute('aWall', new Float32BufferAttribute(b.wall, 3));
		g.setAttribute('aRoof', new Float32BufferAttribute(b.roof, 3));
		g.setAttribute('aLight', new Float32BufferAttribute(b.light, 2));
		g.setIndex(b.idx);
		g.computeBoundingSphere();
		const m = new Mesh(g, material);
		meshes.push(m);
		const s = new Mesh(g, shadowMaterial);
		s.layers.set(CASTER_LAYER);
		shadowCasters.push(s);
	}
	return {
		objects: meshes,
		shadowCasters,
		count,
		structures,
		beacons,
		material, shadowMaterial,
		dispose() { for (const m of [...meshes, ...shadowCasters]) m.geometry.dispose(); },
		/** Czerwone światła przeszkodowe na kominach i chłodniach – nocą, migające; jeden sprite z instancjami. */
		createBeacons(pixelAngle) {
			return beacons.length ? beaconSprite(beacons, material.userData.camXZ, pixelAngle) : null;
		},
		update(camera) { material.userData.camXZ.value.set(camera.position.x, camera.position.z); },
	};
}

function beaconSprite(beacons, camXZ, pixelAngle) {
	const n = beacons.length;
	const pos = new Float32Array(n * 3), phase = new Float32Array(n);
	beacons.forEach((p, i) => { pos.set(p, i * 3); phase[i] = (Math.abs(Math.round(p[0] * 7 + p[2] * 3)) % 100) / 100; });
	const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
	const center = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3));
	const ph = instancedBufferAttribute(new InstancedBufferAttribute(phase, 1));
	const world = onGround(center, camXZ);
	m.positionNode = world;
	// z daleka nie mniejsze niż kilka pikseli – kominy widać z kilometrów jako czerwone punkty
	const dist = length(cameraPosition.sub(world));
	const sz = max(float(3), dist.mul(pixelAngle).mul(6)).min(70);
	m.scaleNode = vec2(sz, sz);
	const q = uv().sub(0.5).mul(2);
	const r2 = dot(q, q);
	const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(10).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
	// miganie ~1 Hz (każda budowla w innej fazie); świecą od zmierzchu jak latarnie
	const ft = fract(time.mul(0.9).add(ph));
	const blink = smoothstep(0.35, 0.5, ft).mul(smoothstep(0.85, 1, ft).oneMinus()).mul(0.85).add(0.15);
	const CU = cityUniforms();
	const on = CU ? CU.street : float(1);
	const glow = CU ? max(CU.glow, 0.2) : float(1);
	m.colorNode = vec3(1, 0.06, 0.03).mul(f.mul(blink).mul(on).mul(glow).mul(9));
	const sprite = new Sprite(m);
	sprite.count = n;
	sprite.frustumCulled = false;
	sprite.renderOrder = 16;
	return sprite;
}

/** Tani materiał do mapy cieni: ta sama pozycja (z krzywizną), bez oświetlenia. */
function makeShadowMaterial(camXZ) {
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	m.positionNode = Fn(() => {
		const p = positionLocal;
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	m.colorNode = vec3(0);
	return m;
}

function makeMaterial(atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(vec3(0), 'vBldWorld');
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	const kind = varying(attribute('aKind', 'float'), 'vBldKind');
	const buv = varying(attribute('aUv', 'vec2'), 'vBldUv');
	const wallC = varying(attribute('aWall', 'vec3'), 'vBldWall');
	const roofC = varying(attribute('aRoof', 'vec3'), 'vBldRoof');
	const nrm = varying(attribute('normal', 'vec3'), 'vBldNormal');
	const light = varying(attribute('aLight', 'vec2'), 'vBldLight'); // (szansa zapalonych okien, los budynku)
	m.colorNode = Fn(() => {
		const N = normalize(nrm);
		const footprint = max(fwidth(vWorld.x), fwidth(vWorld.z)).max(0.02);
		const detail = float(1).sub(smoothstep(0.4, 1.6, footprint));
		// okna: siatka co 3 m w poziomie i co piętro (3 m), od 0,9 m nad podłogą; z daleka uśrednione
		const cellU = fract(buv.x.div(3.1)), cellV = fract(buv.y.div(3));
		// budowle bez okien (kominy, chłodnie, zbiorniki): light.x < 0
		const hasWin = step(0, light.x);
		const win = step(0.3, cellU).mul(step(cellU, 0.72)).mul(step(0.3, cellV)).mul(step(cellV, 0.78)).mul(step(1, buv.y)).mul(hasWin);
		const V = normalize(cameraPosition.sub(vWorld));
		// szyby: ciemne, z odrobiną odbitego nieba (jako albedo – światło dolicza się niżej)
		const glass = vec3(0.025, 0.03, 0.036).add(atmo.skyRadiance(normalize(vec3(N.x, 0.35, N.z))).mul(0.02));
		// pasy przeszkodowe na kominach ≥ 100 m (light.x = −2, light.y = wysokość): 7 pasów w górnych 45%
		const H = light.y;
		const band = step(0.5, fract(buv.y.div(H.mul(0.45 / 7)).mul(0.5)));
		const striped = step(light.x, -1.5).mul(step(H.mul(0.55), buv.y));
		const wallBase = mix(wallC, mix(vec3(0.78, 0.78, 0.76), vec3(0.6, 0.07, 0.04), band), striped);
		const wallAlb = mix(wallBase.mul(mix(float(0.9), float(1.05), valueNoise(vWorld.xz.add(worldOffset).div(2)))), glass, win.mul(detail).add(float(0.18).mul(detail.oneMinus()).mul(hasWin)));
		// dachówki: drobne pasy wzdłuż połaci, płaskie dachy – plamy papy
		const tiles = mix(float(0.88), float(1.08), step(0.5, fract(buv.y.div(0.35))).mul(detail));
		const roofAlb = roofC.mul(tiles).mul(mix(float(0.85), float(1.1), valueNoise(vWorld.xz.add(worldOffset).div(3))));
		const flatAlb = roofC.mul(mix(float(0.8), float(1.15), valueNoise(vWorld.xz.add(worldOffset).div(4))));
		// tylne ściany (wnętrze chłodni widziane z góry) – ciemne
		const back = select(dot(N, V).lessThan(0), float(0.12), float(1));
		const albedo = select(kind.lessThan(0.5), wallAlb, select(kind.lessThan(1.5), roofAlb, flatAlb)).mul(back);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld.add(vec3(nrm).mul(0.25)), 0.5));
		const ndl = max(0, dot(N, sun));
		const skyE = atmo.skyIrradiance();
		// ściany dostają mniej nieba (zasłania je połowa nieboskłonu) i trochę światła odbitego od ziemi
		const sky = skyE.mul(N.y.mul(0.5).add(0.5)).add(sunE.mul(max(0, sun.y)).mul(0.12).mul(float(1).sub(N.y)).mul(0.5));
		const spec = pow(max(0, dot(V.negate().sub(N.mul(dot(V.negate(), N).mul(2))), sun)), 60).mul(0.15).mul(win).mul(detail);
		// latarnie oświetlają ściany od dołu (słabnie z wysokością nad ulicą)
		const street = cityLight(vWorld).mul(float(1).sub(N.y.max(0).mul(0.3))).mul(0.35);
		const lit = albedo.div(Math.PI).mul(sunE.mul(ndl).mul(shadow).add(sky).add(plane.lights.landingLight(vWorld, N)).add(street)).add(sunE.mul(spec).mul(shadow));
		// zapalone okna: los na okno (komórka siatki + budynek), odsetek z godziny; barwa ciepła, czasem chłodna (telewizor)
		const CU = cityUniforms();
		if (!CU) return lit;
		const cellId = vec2(floor(buv.x.div(3.1)), floor(buv.y.div(3)));
		const hw = hash12(cellId.add(vec2(light.y.mul(913.7), light.y.mul(271.3))));
		const on = step(hw, CU.windows.mul(light.x)).mul(step(1, buv.y)).mul(step(kind, 0.5));
		const tone = hash12(cellId.add(vec2(light.y.mul(57.1), 3.3)));
		const wcol = mix(vec3(1.0, 0.68, 0.36), vec3(0.62, 0.72, 1.0), step(0.86, tone)).mul(mix(float(0.55), float(1.1), tone));
		// z bliska – kształt okna; z daleka – średnia (okna zajmują ~18% ściany)
		const shape = win.mul(detail).add(float(0.18).mul(detail.oneMinus()));
		return lit.add(wcol.mul(on.mul(shape).mul(1.3).mul(CU.winGlow)));
	})();
	return m;
}

