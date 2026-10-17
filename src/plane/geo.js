// Bryły do modelu samolotu: kadłub z przekrojów (loft superelips), panele o profilu lotniczym (skrzydło, klapy,
// lotki, usterzenie), rury między dwoma punktami i łączenie geometrii w jedną siatkę (mniej wywołań rysowania).
import { BufferGeometry, Float32BufferAttribute, Vector3, Quaternion, CylinderGeometry } from 'three/webgpu';

/** Profil NACA 4-cyfrowy (cięciwa 1): punkty od krawędzi spływu górą do noska i z powrotem dołem. */
export function airfoil(n = 24, thickness = 0.15, camber = 0.04, camberPos = 0.4) {
	const yt = (x) => 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
	const yc = (x) => (x < camberPos ? (camber / camberPos ** 2) * (2 * camberPos * x - x * x) : (camber / (1 - camberPos) ** 2) * (1 - 2 * camberPos + 2 * camberPos * x - x * x));
	const upper = [], lower = [];
	for (let i = 0; i <= n; i++) {
		const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
		upper.push([x, yc(x) + yt(x)]);
		lower.push([x, yc(x) - yt(x)]);
	}
	return { upper, lower, at: (x) => [yc(x) + yt(x), yc(x) - yt(x)] };
}

/**
 * Zamknięty przekrój profilu między a i b (ułamki cięciwy): górą od b do a, dołem od a do b.
 * Dla a = 0, b = 1 – cały profil (krawędź spływu domknięta).
 */
export function profileSection(foil, a, b) {
	const pts = [];
	const [ua, la] = foil.at(Math.max(a, 1e-4)), [ub, lb] = foil.at(b);
	pts.push([b, ub]);
	for (let i = foil.upper.length - 1; i >= 0; i--) { const [x, y] = foil.upper[i]; if (x < b - 1e-4 && x > a + 1e-4) pts.push([x, y]); }
	if (a > 1e-4) pts.push([a, ua], [a, la]);
	else pts.push([0, foil.at(0)[0]]);
	for (let i = 0; i < foil.lower.length; i++) { const [x, y] = foil.lower[i]; if (x < b - 1e-4 && x > a + 1e-4) pts.push([x, y]); }
	if (b < 1 - 1e-4) pts.push([b, lb]);
	return pts;
}

/**
 * Panel o profilu wyciągnięty wzdłuż osi x (rozpiętość) od x0 do x1. Cięciwa wzdłuż +z od krawędzi natarcia leZ.
 * chord / thick / y mogą być funkcjami położenia x (zbieżność, grubość, wznios). caps – denka na końcach.
 */
export function airfoilPanel(section, x0, x1, { chord, leZ, y, thick = () => 1, steps = 1, caps = true, sweep = () => 0 }) {
	const pos = [], idx = [];
	const m = section.length;
	const fn = (v) => (typeof v === 'function' ? v : () => v);
	const C = fn(chord), Y = fn(y), Th = fn(thick), L = fn(leZ);
	for (let s = 0; s <= steps; s++) {
		const x = x0 + ((x1 - x0) * s) / steps;
		const c = C(x), yy = Y(x), th = Th(x), le = L(x) + sweep(x);
		for (const [u, v] of section) pos.push(x, yy + v * c * th, le + u * c);
	}
	for (let s = 0; s < steps; s++) for (let i = 0; i < m; i++) {
		const a = s * m + i, b = s * m + ((i + 1) % m), c = a + m, d = b + m;
		if (x1 > x0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
	}
	const g = smoothGeometry(pos, idx);
	if (!caps) return g;
	const capGeo = (s, flip) => {
		const P = [], I = [];
		const base = s * m * 3;
		let cx = 0, cy = 0, cz = 0;
		for (let i = 0; i < m; i++) { cx += pos[base + i * 3]; cy += pos[base + i * 3 + 1]; cz += pos[base + i * 3 + 2]; }
		P.push(cx / m, cy / m, cz / m);
		for (let i = 0; i < m; i++) P.push(pos[base + i * 3], pos[base + i * 3 + 1], pos[base + i * 3 + 2]);
		for (let i = 0; i < m; i++) { const a = 1 + i, b = 1 + ((i + 1) % m); flip ? I.push(0, b, a) : I.push(0, a, b); }
		return flatGeometry(P, I);
	};
	const dir = x1 > x0;
	return mergeGeometries([g, capGeo(0, !dir), capGeo(steps, dir)]);
}

/** Geometria z wygładzonymi normalnymi (współdzielone wierzchołki). */
export function smoothGeometry(pos, idx) {
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

/** Geometria z płaskimi ścianami (każdy trójkąt osobno). */
export function flatGeometry(pos, idx) {
	const P = [];
	for (const i of idx) P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(P, 3));
	g.computeVertexNormals();
	return g;
}

/** Łączy geometrie (pozycje i normalne; indeksowane i nie) w jedną indeksowaną. */
export function mergeGeometries(geos) {
	const pos = [], nrm = [], idx = [];
	let base = 0;
	for (const g of geos) {
		const p = g.getAttribute('position'), n = g.getAttribute('normal');
		for (let i = 0; i < p.count; i++) {
			pos.push(p.getX(i), p.getY(i), p.getZ(i));
			nrm.push(n.getX(i), n.getY(i), n.getZ(i));
		}
		if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
		else for (let i = 0; i < p.count; i++) idx.push(base + i);
		base += p.count;
	}
	const out = new BufferGeometry();
	out.setAttribute('position', new Float32BufferAttribute(pos, 3));
	out.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
	out.setIndex(idx);
	return out;
}

/** Walec (rura, pręt) od punktu a do b o promieniu r (r1 – na końcu b). */
export function rod(a, b, r, r1 = r, seg = 8, open = false) {
	const A = new Vector3(...a), B = new Vector3(...b);
	const d = B.clone().sub(A);
	const g = new CylinderGeometry(r1, r, d.length(), seg, 1, open);
	g.deleteAttribute('uv');
	const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize());
	g.applyQuaternion(q);
	const mid = A.add(B).multiplyScalar(0.5);
	g.translate(mid.x, mid.y, mid.z);
	return g;
}

/** Rura wzdłuż łamanej (punkty [x,y,z]) – kolejne odcinki jako walce z przegubami-kulkami pominiętymi. */
export function tube(points, r, seg = 6) {
	const parts = [];
	for (let i = 1; i < points.length; i++) parts.push(rod(points[i - 1], points[i], r, r, seg, true));
	return mergeGeometries(parts);
}

/**
 * Kadłub z przekrojów. Stacje: { z, w (pół szerokości), top, bot, belt (wysokość najszerszego miejsca), n (wykładnik
 * superelipsy – 2 koło, więcej – kanciasto) }. thetas(st, api) – kąty wierzchołków na obwodzie przekroju (ta sama
 * liczba dla każdego przekroju; pozwala ułożyć wierzchołki dokładnie na krawędziach szyb). Zwraca funkcję punktu
 * powierzchni i budowniczego siatek z podziałem na strefy (lakier / szyby) według położenia czworokąta.
 */
export function makeLoft(keys, zs, thetas) {
	const stationAt = (z) => {
		if (z <= keys[0].z) return { ...keys[0], z };
		for (let i = 1; i < keys.length; i++) {
			if (z <= keys[i].z) {
				const a = keys[i - 1], b = keys[i], t = (z - a.z) / (b.z - a.z);
				// gładkie przejście – bez załamań na stacjach kluczowych
				const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
				const o = { z };
				for (const k of ['w', 'top', 'bot', 'belt', 'n']) o[k] = a[k] + (b[k] - a[k]) * s;
				return o;
			}
		}
		return { ...keys[keys.length - 1], z };
	};
	const point = (st, th) => {
		const c = Math.cos(th), s = Math.sin(th);
		const e = 2 / st.n;
		const x = st.w * Math.sign(c) * Math.abs(c) ** e;
		const h = s >= 0 ? st.top - st.belt : st.belt - st.bot;
		return [x, st.belt + h * Math.sign(s) * Math.abs(s) ** e, st.z];
	};
	/** Kąt na prawej burcie (−π/2..π/2), przy którym powierzchnia ma wysokość y (lub najbliższy). */
	const thetaForY = (st, y) => {
		let lo = -Math.PI / 2, hi = Math.PI / 2;
		for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (point(st, m)[1] < y) lo = m; else hi = m; }
		return (lo + hi) / 2;
	};
	/** Kąt na prawej burcie (0..π/2), przy którym powierzchnia ma odległość x od osi. */
	const thetaForX = (st, x) => {
		let lo = 0, hi = Math.PI / 2;
		for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (point(st, m)[0] > x) lo = m; else hi = m; }
		return (lo + hi) / 2;
	};
	const api = { stationAt, point, thetaForY, thetaForX };
	const rings = zs.map(stationAt);
	const angles = rings.map((st) => thetas(st, api));
	const seg = angles[0].length;
	const pos = [];
	rings.forEach((st, r) => { for (let k = 0; k < seg; k++) pos.push(...point(st, angles[r][k])); });
	const full = [];
	const quads = [];
	for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < seg; k++) {
		const a = r * seg + k, b = r * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
		quads.push([a, b, c, d, r, k]);
		full.push(a, b, c, b, d, c);
	}
	const base = smoothGeometry(pos, full);
	return {
		...api, rings, seg,
		/** Wierzchołek: przekrój r, indeks k na obwodzie. */
		vertex: (r, k) => [pos[(r * seg + k) * 3], pos[(r * seg + k) * 3 + 1], pos[(r * seg + k) * 3 + 2]],
		/**
		 * Siatka z czworokątów, dla których pick(z0, z1, k) zwraca true (z0..z1 – przekroje, k – indeks odcinka na
		 * obwodzie); inset – odsunięcie do środka, flip – normalne do środka (wnętrze kabiny).
		 */
		mesh(pick, { inset = 0, flip = false } = {}) {
			const idx = [];
			for (const [a, b, c, d, r, k] of quads) {
				if (!pick(rings[r].z, rings[r + 1].z, k)) continue;
				flip ? idx.push(a, c, b, b, c, d) : idx.push(a, b, c, b, d, c);
			}
			const g = new BufferGeometry();
			const n = base.getAttribute('normal');
			if (inset) {
				const P = pos.slice();
				for (let i = 0; i < P.length / 3; i++) for (let j = 0; j < 3; j++) P[i * 3 + j] -= n.array[i * 3 + j] * inset;
				g.setAttribute('position', new Float32BufferAttribute(P, 3));
			} else g.setAttribute('position', base.getAttribute('position'));
			g.setAttribute('normal', flip ? new Float32BufferAttribute(n.array.map((v) => -v), 3) : n);
			g.setIndex(idx);
			return g;
		},
	};
}
