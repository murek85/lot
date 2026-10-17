// Części wspólne modeli samolotów: kadłub z przeszkloną kabiną (wierzchołki ułożone na krawędziach szyb, ramy,
// wnętrze), śmigło ze skręconymi łopatami i tarczą rozmycia, klosze świateł, powierzchnie sterowe na zawiasach,
// opony, znaki rejestracyjne dopasowane do burt, figura pilota. Każdy model składa z nich swój samolot.
import {
	Group, Mesh, SphereGeometry, CircleGeometry, LatheGeometry, PlaneGeometry, MeshBasicNodeMaterial, MeshStandardNodeMaterial, BoxGeometry,
	CanvasTexture, SRGBColorSpace, DoubleSide, Vector2, Vector3, Quaternion,
} from 'three/webgpu';
import { vec3, float, max, uv, length, smoothstep, sin, atan, uniform, texture } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, makeLoft, mergeGeometries, tube } from './geo.js';

const DEG = Math.PI / 180;

/** Dodawanie siatek do grupy (cienie włączone domyślnie) i przesuwanie geometrii. */
export function adder(root) {
	const add = (geo, mat, parent = root, { shadow = true } = {}) => {
		const m = new Mesh(geo, mat);
		m.castShadow = shadow;
		m.receiveShadow = true;
		parent.add(m);
		return m;
	};
	return { add, at: (g, x, y, z) => g.translate(x, y, z) };
}

/**
 * Przeszklona kabina na kadłubie z przekrojów. cabin: { front, roofFront, back, roofX, sillY(z) } – szyba to
 * wszystko powyżej parapetu między front i back; dach (|x| < roofX) jest pełny za roofFront (roofFront ≥ back –
 * owiewka kroplowa bez dachu). Na obwodzie przekroju: 22 wierzchołki do parapetu, 8 do słupka, 8 do krawędzi dachu,
 * 8 do grzbietu – w kabinie leżą dokładnie na krawędziach szyb.
 */
export function cabinKit(cabin) {
	const N = [22, 8, 8, 8];
	const HALF = N[0] + N[1] + N[2] + N[3];
	const K = { SILL: N[0], PILLAR: N[0] + N[1], ROOF: N[0] + N[1] + N[2], HALF };
	const mirrorK = (k) => (k < HALF ? k : 2 * HALF - 1 - k);
	const ringAngles = (st, { thetaForY, thetaForX }) => {
		const z = st.z;
		const w = Math.max(0, Math.min(1, 1 - Math.max(cabin.front - z, z - cabin.back, 0) / 0.3));
		const ts = Math.min(Math.PI / 2 - 0.04, thetaForY(st, Math.min(cabin.sillY(z), st.top - 0.01)));
		const tr = Math.min(Math.PI / 2 - 0.02, Math.max(ts + 0.01, thetaForX(st, cabin.roofX)));
		const marks = [-Math.PI / 2, 0.2 + (ts - 0.2) * w, 0, 1.1 + (tr - 1.1) * w, Math.PI / 2];
		marks[2] = (marks[1] + marks[3]) / 2;
		const right = [];
		for (let i = 0; i < 4; i++) for (let j = 0; j < N[i]; j++) right.push(marks[i] + ((marks[i + 1] - marks[i]) * j) / N[i]);
		right.push(Math.PI / 2);
		const ring = right.slice(0, HALF);
		for (let j = 0; j < HALF; j++) ring.push(Math.PI - right[HALF - j]);
		return ring;
	};
	const isGlassQuad = (z0, z1, k) => {
		const zc = (z0 + z1) / 2, m = mirrorK(k);
		if (zc < cabin.front || zc > cabin.back || m < K.SILL) return false;
		return m < K.ROOF || zc < cabin.roofFront;
	};
	return { ringAngles, isGlassQuad, mirrorK, K };
}

/**
 * Kadłub z kabiną: lakier, szyby, wnętrze (powierzchnia odsunięta do środka), ramy przeszklenia (z zewnątrz w
 * kolorze lakieru, od środka szarozielone). opts: { stations, zMin, zMax, step(z), cabin, pillars (z słupków),
 * frameR, innerY (środek kabiny do odsunięcia ram), aPillar (czy słupek A w wiatrochronie), centerBar }.
 */
export function buildFuselage(add, root, M, opts) {
	const { stations, cabin } = opts;
	const kit = cabinKit(cabin);
	const zs = [];
	for (let z = stations[0].z; z < stations[stations.length - 1].z; z += opts.step(z)) zs.push(z);
	const keyZ = [cabin.front, cabin.back, stations[stations.length - 1].z, ...(opts.pillars ?? [])];
	if (cabin.roofFront < cabin.back) keyZ.push(cabin.roofFront);
	for (const z of keyZ) {
		for (let i = zs.length - 1; i >= 0; i--) if (Math.abs(zs[i] - z) < 0.02) zs.splice(i, 1);
		zs.push(z);
	}
	zs.sort((p, q) => p - q);
	const loft = makeLoft(stations, zs, kit.ringAngles);
	const { K, mirrorK, isGlassQuad } = kit;
	add(loft.mesh((z0, z1, k) => !isGlassQuad(z0, z1, k)), M.fuselage);
	const glass = add(loft.mesh(isGlassQuad), M.glass, root, { shadow: false });
	glass.renderOrder = 2;
	add(loft.mesh((z0, z1, k) => z0 > cabin.front - 0.2 && z1 < cabin.back + 0.2 && !isGlassQuad(z0, z1, k) && mirrorK(k) > 6, { inset: 0.025, flip: true }), M.cabinShell, root, { shadow: false });

	const ringsIn = (z0, z1) => loft.rings.map((st, r) => [st.z, r]).filter(([z]) => z >= z0 - 1e-6 && z <= z1 + 1e-6).map(([, r]) => r);
	const outer = [], inner = [];
	const iy = opts.innerY ?? 0.75;
	const line = (rs, v) => rs.map((r) => loft.vertex(r, v % loft.seg));
	const R = opts.frameR ?? 0.02;
	const frame = (pts, r = R) => {
		if (pts.length < 2) return;
		outer.push(tube(pts, r));
		inner.push(tube(pts.map(([x, y, z]) => { const dx = -x, dy = iy - y, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * 0.022, y + (dy / l) * 0.022, z]; }), r * 0.9));
	};
	const all = ringsIn(cabin.front, cabin.back);
	const H2 = K.HALF * 2;
	for (const v of [K.SILL, H2 - K.SILL]) frame(line(all, v));
	const ringFrame = (z, v0, v1) => { const r = ringsIn(z, z)[0]; if (r === undefined) return; const pts = []; for (let v = v0; v <= v1; v++) pts.push(loft.vertex(r, v % loft.seg)); frame(pts); };
	if (cabin.roofFront < cabin.back) {
		const roofed = ringsIn(cabin.roofFront, cabin.back), shield = ringsIn(cabin.front, cabin.roofFront);
		for (const v of [K.ROOF, H2 - K.ROOF]) frame(line(roofed, v));
		if (opts.aPillar !== false) for (const v of [K.PILLAR, H2 - K.PILLAR]) frame(line(shield, v), R * 1.2);
		if (opts.centerBar !== false) frame(line(shield, K.HALF), R * 0.6);
		ringFrame(cabin.roofFront, K.ROOF, H2 - K.ROOF);
		for (const z of [...(opts.pillars ?? []), cabin.back]) { ringFrame(z, K.SILL, K.ROOF); ringFrame(z, H2 - K.ROOF, H2 - K.SILL); }
	} else {
		// owiewka kroplowa: tylko łuki (wiatrochron, ewentualnie środkowy) i tylna krawędź
		for (const z of [...(opts.pillars ?? []), cabin.back]) ringFrame(z, K.SILL, H2 - K.SILL);
	}
	if (outer.length) add(mergeGeometries(outer), M.frame);
	if (inner.length) add(mergeGeometries(inner), M.cage, root, { shadow: false });
	return { loft, glass };
}

/** Ruchoma powierzchnia sterowa: geometria przeniesiona do układu zawiasu (oś x = linia zawiasu). */
export function hinged(parent, geo, a, b, mat, flipAxis = false) {
	const pivot = new Group();
	const axis = b.clone().sub(a).normalize();
	if (flipAxis) axis.negate();
	const base = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis);
	pivot.position.copy(a);
	pivot.quaternion.copy(base);
	const inv = base.clone().invert();
	geo.translate(-a.x, -a.y, -a.z);
	geo.applyQuaternion(inv);
	const m = new Mesh(geo, mat);
	m.castShadow = m.receiveShadow = true;
	pivot.add(m);
	parent.add(pivot);
	const q = new Quaternion();
	const X = new Vector3(1, 0, 0);
	return {
		pivot,
		/** Wychylenie w radianach (+ – krawędź spływu w dół dla osi zawiasu w +x). */
		deflect(angle) { pivot.quaternion.copy(base).multiply(q.setFromAxisAngle(X, angle)); },
	};
}

/** Łopata śmigła o promieniu R: skręcony profil zwężający się ku końcówce, osobno końcówka (kolorowa). */
export function bladeGeometry(R = 1.5, rootChord = 0.24, { tipFrom = 0.887, tipChord = 0.3, twist = [45, 15] } = {}) {
	const k = R / 1.5;
	const foil = airfoil(10, 0.12, 0.03, 0.4);
	const sec = profileSection(foil, 0, 1);
	// cięciwa: liniowo zwężająca się, na końcówce szybko zaokrąglona (jak w łopatach Dromadera, przeskalowanych do R)
	const c = (r) => rootChord * (1 - (r / k) * 0.2083 - Math.max(0, (r - R * tipFrom) / k) * 2.5 * (tipChord / 0.3));
	const build = (r0, r1, steps) => {
		const g = airfoilPanel(sec, r0, r1, { chord: (r) => Math.max(0.02, c(r)), leZ: (r) => -Math.max(0.02, c(r)) * 0.35, y: 0, steps });
		const p = g.getAttribute('position');
		for (let i = 0; i < p.count; i++) {
			const r = p.getX(i), y = p.getY(i), z = p.getZ(i);
			const tw = (twist[0] - (r / R) * (twist[0] - twist[1])) * DEG;
			const cs = Math.cos(tw), sn = Math.sin(tw);
			p.setXYZ(i, z * cs - y * sn, r, z * sn + y * cs);
		}
		g.computeVertexNormals();
		return g;
	};
	return { body: build(0.28 * k, R * tipFrom, 10), tip: build(R * tipFrom, R, 2) };
}

/**
 * Śmigło: kołpak, n łopat, tarcza rozmycia przy obrotach (smugi łopat i pierścień końcówek, oświetlona jak
 * otoczenie). opts: { pos [x,y,z], radius, blades, spinner: [promień, długość], bladeMat, tipMat, tipColor, rootChord }.
 */
export function propeller(root, add, M, atmo, opts) {
	const { radius: R = 1.5, blades: nb = 3 } = opts;
	const prop = new Group();
	prop.position.set(...opts.pos);
	root.add(prop);
	const [sr, sl] = opts.spinner ?? [0.33, 0.48];
	const spinner = new LatheGeometry(Array.from({ length: 12 }, (_, i) => { const t = 1 - i / 11; return new Vector2(Math.max(0.001, sr * Math.sqrt(1 - t * t)), -t * sl); }), 24);
	spinner.deleteAttribute('uv');
	spinner.rotateX(Math.PI / 2);
	add(spinner, opts.spinnerMat ?? M.metal, prop);
	const blades = new Group();
	prop.add(blades);
	const blade = bladeGeometry(R, opts.rootChord ?? 0.24);
	for (let i = 0; i < nb; i++) {
		const b = add(blade.body.clone(), opts.bladeMat ?? M.black, blades);
		b.rotation.z = (i * Math.PI * 2) / nb;
		const t = add(blade.tip.clone(), opts.tipMat ?? M.yellow, blades);
		t.rotation.z = b.rotation.z;
	}
	const discMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
	const q = uv().sub(0.5).mul(2);
	const r = length(q);
	const ang = atan(q.y, q.x);
	const discOpacity = uniform(0), discPhase = uniform(0);
	const discLight = atmo.sunLight(float(500)).mul(max(0, atmo.u.lightDir.y)).mul(0.4).add(atmo.skyIrradiance()).div(Math.PI);
	const tc = opts.tipColor ?? [0.5, 0.36, 0.02];
	const streak = sin(ang.mul(nb).add(discPhase)).mul(0.5).add(0.5).mul(0.22).add(0.14);
	const ring = smoothstep(0.86, 0.9, r).mul(smoothstep(0.97, 1.0, r).oneMinus());
	discMat.opacityNode = streak.mul(smoothstep(0.86, 1.0, r).oneMinus()).mul(smoothstep(0.2, 0.28, r)).mul(discOpacity).add(ring.mul(0.32).mul(discOpacity));
	discMat.colorNode = vec3(0.05, 0.05, 0.052).mul(discLight).add(vec3(...tc).mul(ring).mul(0.6).mul(discLight));
	const disc = new Mesh(new CircleGeometry(R, 64), discMat);
	disc.position.z = -0.05;
	disc.castShadow = false;
	disc.renderOrder = 3;
	prop.add(disc);
	return {
		prop, blades, disc,
		spin(dt, rpm) {
			prop.rotation.z -= (rpm / 60) * Math.PI * 2 * dt;
			const fast = Math.min(1, Math.max(0, (rpm - 300) / 900));
			blades.visible = fast < 0.95;
			discOpacity.value = fast;
			discPhase.value = (discPhase.value + dt * 2.1) % (Math.PI * 2);
		},
	};
}

/** Klosze świateł w punktach anchors (kolor i jasność ustawia lights.js). */
export function lamps(root, add, A) {
	const at = (g, p) => g.translate(...p);
	const shape = (p, r) => { const g = new SphereGeometry(r, 12, 8); g.scale(0.6, 0.7, 1.3); return at(g, p); };
	const mk = (geo) => add(geo, new MeshBasicNodeMaterial(), root, { shadow: false });
	return {
		navL: mk(shape(A.navL, 0.06)),
		navR: mk(shape(A.navR, 0.06)),
		strobeL: mk(shape(A.strobeL, 0.045)),
		strobeR: mk(shape(A.strobeR, 0.045)),
		tail: mk(shape(A.tail, 0.04)),
		beacon: mk(at(new SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), A.beacon)),
		landingL: mk(at(new CircleGeometry(0.08, 20).rotateY(Math.PI), A.landingL)),
		landingR: mk(at(new CircleGeometry(0.08, 20).rotateY(Math.PI), A.landingR)),
	};
}

/** Opona (bryła obrotowa wokół osi x): promień zewnętrzny, wewnętrzny, szerokość. */
export function tyre(rOut, rIn, width) {
	const pts = [];
	for (let i = 0; i <= 16; i++) {
		const a = (i / 16) * Math.PI;
		pts.push(new Vector2(rIn + (rOut - rIn) * Math.sin(a), -(width / 2) * Math.cos(a)));
	}
	const t = new LatheGeometry(pts, 28);
	t.deleteAttribute('uv');
	t.rotateZ(Math.PI / 2);
	return t;
}

/** Pilot widoczny z zewnątrz: tułów, kask, wizjer. head – położenie głowy. */
export function pilotFigure(root, add, M, head, scale = 1) {
	const pilot = new Group();
	root.add(pilot);
	const [hx, hy, hz] = head;
	add(new BoxGeometry(0.42 * scale, 0.55, 0.26).deleteAttribute('uv').translate(hx, hy - 0.45, hz + 0.16), M.strap, pilot);
	add(new SphereGeometry(0.135, 16, 12).translate(hx, hy, hz), M.helmet, pilot);
	const visor = new SphereGeometry(0.14, 16, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.38, Math.PI * 0.22);
	visor.rotateY(Math.PI);
	add(visor.translate(hx, hy, hz), M.black, pilot);
	return pilot;
}

/** Tekstura znaków rejestracyjnych (przezroczyste tło). */
export function registrationTexture(text, color = '#111') {
	const c = document.createElement('canvas');
	c.width = 1024; c.height = 256;
	const ctx = c.getContext('2d');
	ctx.fillStyle = color;
	ctx.font = 'bold 200px "Arial Narrow", Arial, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, 512, 136, 1000);
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

/** Materiał znaków rejestracyjnych (alfa z tekstury, odrobina odbicia nieba). */
export function registrationMaterial(text, environment, color) {
	const tex = registrationTexture(text, color);
	const m = new MeshStandardNodeMaterial({ alphaTest: 0.5, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	m.colorNode = texture(tex).rgb;
	m.opacityNode = texture(tex).a;
	m.emissiveNode = environment(vec3(0, 1, 0)).mul(0.02);
	return m;
}

/** Znaki na obu burtach, dopasowane do zakrzywionej powierzchni kadłuba (4 mm nad lakierem). */
export function sideRegistration(root, loft, mat, { zc, y, len = 1.5, h = 0.3 }) {
	for (const s of [-1, 1]) {
		const g = new PlaneGeometry(len, h, 24, 4);
		const p = g.getAttribute('position');
		for (let i = 0; i < p.count; i++) {
			const u = p.getX(i), yy = y + p.getY(i), z = zc - s * u;
			const st = loft.stationAt(z);
			p.setXYZ(i, s * (loft.point(st, loft.thetaForY(st, yy))[0] + 0.004), yy, z);
		}
		g.computeVertexNormals();
		root.add(new Mesh(g, mat));
	}
}

/** Znaki na spodzie (lewego) skrzydła: środek, nachylenie wzniosu, rozmiar. */
export function underwingRegistration(root, mat, { pos, dihedral = 0, w = 3, h = 0.9 }) {
	const d = new Mesh(new PlaneGeometry(w, h), mat);
	d.position.set(...pos);
	d.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -dihedral)
		.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))
		.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)));
	root.add(d);
}

/** Wspólne zakończenie modelu: bez odrzucania poza kadrem (części blisko kamery w kabinie). */
export function finish(root) {
	root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
	return root;
}

export { airfoil, profileSection, airfoilPanel };
