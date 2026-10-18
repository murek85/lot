// Drogi z OpenStreetMap jako wstęgi położone na siatce terenu: szerokość z klasy (albo tagów), nawierzchnia,
// linie krawędziowe i przerywana oś na drogach publicznych, koleiny i trawa pośrodku dróg leśnych i polnych.
// Krawędzie wygładzone przezroczystością zależną od wielkości piksela (wąska droga z daleka staje się cienką,
// bladą kreską, a nie migoczącymi pikselami). Do tego maska dróg dla lasu – drzewa nie stają na duktach.
import { Mesh, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, DataTexture, RedFormat, UnsignedByteType, LinearFilter, Vector2 } from 'three/webgpu';
import {
	Fn, float, vec3, attribute, varying, positionLocal, uniform, abs, max, min, clamp, mix, smoothstep, step, fract,
	fwidth, dot, select,
} from 'three/tsl';
import { onGround, cityLight } from './gfx/ground.js';
import { valueNoise } from './gfx/noise.js';

const EARTH_R = 6371000;
const STEP = 12; // maksymalna długość odcinka wstęgi (m) – żeby nadążała za rzeźbą
const LIFT = 0.25;
export const ROAD_MASK_RES = 4096;

/** Zagęszcza linię (pary x, z w metrach) tak, by żaden odcinek nie był dłuższy niż step. */
export function densify(pts, step = STEP) {
	const out = [pts[0], pts[1]];
	for (let i = 2; i < pts.length; i += 2) {
		const x0 = out[out.length - 2], z0 = out[out.length - 1], x1 = pts[i], z1 = pts[i + 1];
		const d = Math.hypot(x1 - x0, z1 - z0);
		if (d < 0.01) continue;
		const k = Math.ceil(d / step);
		for (let j = 1; j <= k; j++) out.push(x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k);
	}
	return out;
}

/**
 * Wstęga wzdłuż linii: dwa wierzchołki na punkt, przesunięte w bok o połowę szerokości (z ograniczonym „uskokiem”
 * na ostrych załamaniach). heightAt(x, z) → y. Zwraca tablice pozycji, strony (−1/1), odległości wzdłuż i indeksów.
 */
export function ribbon(pts, halfWidth, heightAt, startIndex = 0) {
	const n = pts.length / 2;
	const pos = [], side = [], dist = [], idx = [];
	let along = 0;
	for (let i = 0; i < n; i++) {
		const x = pts[i * 2], z = pts[i * 2 + 1];
		const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
		const nx = pts[Math.min(n - 1, i + 1) * 2], nz = pts[Math.min(n - 1, i + 1) * 2 + 1];
		let tx = nx - px, tz = nz - pz;
		const tl = Math.hypot(tx, tz) || 1;
		tx /= tl; tz /= tl;
		// miter: przy załamaniu odsunięcie rośnie, ale najwyżej 2×
		let mx = -tz, mz = tx;
		if (i > 0 && i < n - 1) {
			const ax = x - px, az = z - pz, al = Math.hypot(ax, az) || 1;
			const dotv = (-az / al) * mx + (ax / al) * mz;
			const s = 1 / Math.max(0.5, dotv);
			mx *= s; mz *= s;
		}
		if (i > 0) along += Math.hypot(x - px, z - pz);
		const y = heightAt(x, z);
		for (const sgn of [-1, 1]) {
			pos.push(x + mx * halfWidth * sgn, y, z + mz * halfWidth * sgn);
			side.push(sgn);
			dist.push(along);
		}
		if (i > 0) {
			const a = startIndex + (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
			idx.push(a, b, c, b, d, c); // przeciwnie do wskazówek zegara patrząc z góry – przód wstęgi w górę
		}
	}
	return { pos, side, dist, idx };
}

/** Maska dróg (0..255) na siatce res² regionu: komórki bliżej osi drogi niż połowa szerokości + margines. */
export function rasterizeMask(lines, size, res, margin) {
	const mask = new Uint8Array(res * res);
	const cell = size / res;
	for (const { pts, half } of lines) {
		const r = half + margin;
		for (let i = 2; i < pts.length; i += 2) {
			const x0 = pts[i - 2], z0 = pts[i - 1], x1 = pts[i], z1 = pts[i + 1];
			const minI = Math.max(0, Math.floor((Math.min(x0, x1) - r + size / 2) / cell));
			const maxI = Math.min(res - 1, Math.floor((Math.max(x0, x1) + r + size / 2) / cell));
			const minJ = Math.max(0, Math.floor((Math.min(z0, z1) - r + size / 2) / cell));
			const maxJ = Math.min(res - 1, Math.floor((Math.max(z0, z1) + r + size / 2) / cell));
			const dx = x1 - x0, dz = z1 - z0, len2 = dx * dx + dz * dz || 1;
			for (let j = minJ; j <= maxJ; j++) for (let k = minI; k <= maxI; k++) {
				const cx = (k + 0.5) * cell - size / 2, cz = (j + 0.5) * cell - size / 2;
				const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / len2));
				const ex = x0 + dx * t - cx, ez = z0 + dz * t - cz;
				if (ex * ex + ez * ez <= r * r) mask[j * res + k] = 255;
			}
		}
	}
	return mask;
}

export function createRoads(osm, region, terrain, atmo, clouds, plane, worldShadow = null, extraMaskLines = []) {
	const size = region.size, half = size / 2 - 30;
	const groups = new Map(); // klasa → dane geometrii (osobne siatki: kolejność rysowania od dróg polnych do głównych)
	const maskLines = [];
	for (const [cls, w10, surface, bridge, , c] of osm.roads) {
		let pts = [];
		for (let i = 0; i < c.length; i += 2) {
			const x = c[i] / 10, z = c[i + 1] / 10;
			if (Math.abs(x) < half && Math.abs(z) < half) pts.push(x, z);
			else if (pts.length >= 4) break;
		}
		if (pts.length < 4) continue;
		pts = densify(pts);
		const width = w10 / 10;
		maskLines.push({ pts, half: width / 2 });
		let g = groups.get(cls);
		if (!g) groups.set(cls, (g = { pos: [], side: [], dist: [], idx: [], width: [], surf: [], count: 0 }));
		// most: wstęga po prostej między końcami (nie opada do doliny), dalej – po siatce terenu
		let hAt = (x, z) => terrain.meshHeightAt(x, z) + LIFT;
		if (bridge) {
			const n = pts.length / 2;
			const h0 = terrain.meshHeightAt(pts[0], pts[1]), h1 = terrain.meshHeightAt(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
			let i = 0;
			hAt = () => {
				const t = n > 1 ? i++ / (n - 1) : 0;
				return h0 + (h1 - h0) * t + 0.6;
			};
		}
		const rb = ribbon(pts, width / 2, hAt, g.count);
		g.pos.push(...rb.pos);
		g.side.push(...rb.side);
		g.dist.push(...rb.dist);
		g.idx.push(...rb.idx);
		for (let i = 0; i < rb.side.length; i++) { g.width.push(width); g.surf.push(surface); }
		g.count += rb.side.length;
	}

	const material = makeRoadMaterial(region, atmo, clouds, plane, worldShadow);
	const meshes = [];
	for (const [cls, g] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(g.pos, 3));
		geo.setAttribute('aSide', new Float32BufferAttribute(g.side, 1));
		geo.setAttribute('aDist', new Float32BufferAttribute(g.dist, 1));
		geo.setAttribute('aWidth', new Float32BufferAttribute(g.width, 1));
		geo.setAttribute('aSurf', new Float32BufferAttribute(g.surf, 1));
		geo.setAttribute('aCls', new Float32BufferAttribute(new Array(g.count).fill(cls), 1));
		geo.setIndex(g.idx);
		const m = new Mesh(geo, material);
		m.renderOrder = 10 - cls; // polne pod spodem, główne na wierzchu
		m.frustumCulled = false;
		meshes.push(m);
	}

	const mask = rasterizeMask([...maskLines, ...extraMaskLines], size, ROAD_MASK_RES, 3);
	const maskTex = new DataTexture(mask, ROAD_MASK_RES, ROAD_MASK_RES, RedFormat, UnsignedByteType);
	maskTex.minFilter = maskTex.magFilter = LinearFilter;
	maskTex.needsUpdate = true;
	return {
		objects: meshes, maskTex, count: osm.roads.length, material,
		update(camera) { material.userData.camXZ.value.set(camera.position.x, camera.position.z); },
	};
}

export function makeRoadMaterial(region, atmo, clouds, plane, worldShadow) {
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
	const vWorld = varying(vec3(0), 'vRoadWorld');
	const camXZ = uniform(new Vector2()); // krzywizna Ziemi względem kamery – jak teren
	m.userData.camXZ = camXZ;
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	const side = varying(attribute('aSide', 'float'), 'vRoadSide');
	const along = varying(attribute('aDist', 'float'), 'vRoadDist');
	const width = varying(attribute('aWidth', 'float'), 'vRoadWidth');
	const surf = varying(attribute('aSurf', 'float'), 'vRoadSurf');
	const cls = varying(attribute('aCls', 'float'), 'vRoadCls');

	m.colorNode = Fn(() => {
		const xz = vWorld.xz;
		const footprint = max(fwidth(xz.x), fwidth(xz.y)).max(0.05);
		const u = side; // −1..1 w poprzek
		const fromEdge = float(1).sub(abs(u)).mul(width).mul(0.5); // metry od krawędzi
		const nearDetail = float(1).sub(smoothstep(0.6, 3, footprint));
		// nawierzchnie
		const asphalt = vec3(0.052, 0.052, 0.056).mul(mix(float(0.82), float(1.18), valueNoise(xz.div(7))).mul(mix(float(0.92), float(1.08), valueNoise(xz.div(1.3)))));
		const pavers = vec3(0.15, 0.14, 0.13).mul(mix(float(0.88), float(1.1), valueNoise(xz.div(4))));
		const sett = vec3(0.11, 0.105, 0.1).mul(mix(float(0.8), float(1.15), valueNoise(xz.div(0.4)).mul(nearDetail).add(float(0.5).mul(nearDetail.oneMinus()))));
		const gravel = vec3(0.24, 0.215, 0.17).mul(mix(float(0.85), float(1.1), valueNoise(xz.div(2.5))));
		const sand = vec3(0.30, 0.255, 0.17).mul(mix(float(0.85), float(1.1), valueNoise(xz.div(3.5))));
		const albedo = select(surf.lessThan(0.5), asphalt, select(surf.lessThan(1.5), pavers, select(surf.lessThan(2.5), sett, select(surf.lessThan(3.5), gravel, sand)))).toVar();
		// drogi polne i leśne: dwie koleiny i trawa pośrodku
		const isTrack = step(5.5, cls).mul(step(cls, 6.5));
		const rut = smoothstep(0.12, 0.28, abs(abs(u).sub(0.5))).oneMinus();
		const grassMid = smoothstep(0.18, 0.3, abs(u)).oneMinus().mul(step(0.5, valueNoise(xz.div(9)).add(0.25)));
		albedo.assign(mix(albedo, albedo.mul(0.72), rut.mul(isTrack).mul(0.8)));
		albedo.assign(mix(albedo, vec3(0.09, 0.14, 0.05), grassMid.mul(isTrack).mul(0.85)));
		// oznakowanie na drogach publicznych z twardą nawierzchnią: linie krawędziowe i przerywana oś
		const paved = step(surf, 0.5).mul(step(cls, 3.5));
		const lineW = float(0.13);
		const aa = footprint.mul(0.5);
		const edgeLine = smoothstep(lineW.sub(aa).max(0), lineW.add(aa), abs(fromEdge.sub(0.35))).oneMinus();
		const dash = step(fract(along.div(12)), 0.33);
		const center = smoothstep(lineW.sub(aa).max(0), lineW.add(aa), abs(u.mul(width).mul(0.5))).oneMinus().mul(dash).mul(step(0.5, cls)).mul(step(6, width));
		const paint = clamp(edgeLine.add(center), 0, 1).mul(paved).mul(min(1, lineW.mul(2).div(footprint)));
		albedo.assign(mix(albedo, vec3(0.55), paint));
		// światło jak na terenie (płaska powierzchnia)
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld, 0.3));
		return albedo.div(Math.PI).mul(sunE.mul(max(0, sun.y)).mul(shadow).add(atmo.skyIrradiance()).add(plane.lights.landingLight(vWorld, vec3(0, 1, 0))).add(cityLight(vWorld)));
	})();
	// krycie: miękka krawędź (wygładzona do wielkości piksela), a wąska droga z daleka – proporcjonalnie bledsza
	m.opacityNode = Fn(() => {
		const footprint = max(fwidth(vWorld.x), fwidth(vWorld.z)).max(0.05);
		const fromEdge = float(1).sub(abs(side)).mul(width).mul(0.5);
		return clamp(fromEdge.div(footprint).add(0.5), 0, 1).mul(min(1, width.div(footprint.mul(1.5))));
	})();
	return m;
}

