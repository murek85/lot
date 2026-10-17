// Kabina Dromadera: tablica przyrządów (tarcze rysowane na canvasie, wskazówki jako osobne siatki), sztuczny
// horyzont i żyrobusola liczone na bieżąco, zegar z godziną gry, przyrządy silnika, lampki ostrzegawcze,
// przełączniki, radio z wyświetlaczem, listwa LED nawigacji agrolotniczej na osłonie przeciwodblaskowej, kompas,
// drążek i dźwignie poruszające się razem ze sterowaniem, fotel z pasami, kratownica kabiny i podłoga.
// Nocą tarcze świecą ciepłym podświetleniem. Układ współrzędnych kabiny: oko pilota w (0; 1,2; −0,42), nos w −z;
// cała kabina jest przesuwana do samolotu (origin), zwężana (width – rozstaw elementów przy burtach, bez
// zniekształcania), tablica skalowana jednolicie (panelScale), a fotel z drążkiem przesunięty na miejsce pilota
// (pilotX – np. lewy fotel w kabinie dwuosobowej).
import {
	Group, Mesh, BoxGeometry, CircleGeometry, TorusGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, ShapeGeometry, Shape,
	InstancedMesh, MeshStandardNodeMaterial, MeshBasicNodeMaterial, CanvasTexture, SRGBColorSpace, Color, Object3D,
} from 'three/webgpu';
import { uniform, texture, vec2, vec3, float, uv, cos, sin, abs, clamp, mix, smoothstep, fwidth, max, min, select } from 'three/tsl';
import { rod, mergeGeometries } from './geo.js';

const DEG = Math.PI / 180;
const MS_TO_KMH = 3.6;

export function createCockpit(M, atmo, {
	loft, origin = [0, 0, 0], width = 1, panelScale = 1, pilotX = 0, panelX = 0, sill = 0.8, bulkheadZ = 0.42, cage = true, spray = false, secondSeat = false,
}) {
	const group = new Group();
	group.name = 'cockpit';
	const [ox, oy, oz] = origin;
	group.position.set(ox, oy, oz);
	const w = width, ps = panelScale;
	const backlight = uniform(0); // 0 – dzień, 1 – noc (podświetlenie tarcz)
	const glow = vec3(1.0, 0.82, 0.55);
	const add = (geo, mat, parent = group, shadow = true) => {
		const m = new Mesh(geo, mat);
		m.castShadow = shadow;
		m.receiveShadow = true;
		parent.add(m);
		return m;
	};
	const box = (w, h, d, x, y, z) => new BoxGeometry(w, h, d).deleteAttribute('uv').translate(x, y, z);

	// ======================= konstrukcja =======================
	add(box(1.12 * w, 0.03, 2.3, 0, -0.11, -0.55), M.cabin); // podłoga
	add(box(0.9 * w, 0.98 * ps, 0.02, 0, -0.1 + 0.49 * ps, -1.73 + (1 - ps) * 0.3), M.cabin); // ściana ogniowa za tablicą
	// tylna ściana za fotelem – przekrój kadłuba
	{
		const st = loft.stationAt(bulkheadZ + oz);
		const shape = new Shape();
		for (let k = 0; k <= 48; k++) {
			const th = -Math.PI / 2 + (k / 48) * Math.PI * 2;
			const [x, y] = loft.point(st, th);
			const p = [x * 0.96 - ox, Math.max(-0.1, (y - st.belt) * 0.97 + st.belt - oy)];
			k ? shape.lineTo(...p) : shape.moveTo(...p);
		}
		const g = new ShapeGeometry(shape, 4);
		g.deleteAttribute('uv');
		g.rotateY(Math.PI); // ku przodowi (ku pilotowi)
		g.translate(0, 0, bulkheadZ);
		add(g, M.cabinShell);
	}
	// parapety i kratownica bezpieczeństwa
	const rods = [];
	const sy = sill - oy; // parapet w układzie kabiny
	for (const s of [-1, 1]) {
		const pts = [];
		for (let z = -1.3; z <= bulkheadZ - 0.04; z += 0.12) {
			const st = loft.stationAt(z + oz);
			const [x] = loft.point(st, thetaForY(loft, st, sill));
			pts.push([s * (x - 0.05) - ox, sy, z]);
		}
		for (let i = 1; i < pts.length; i++) rods.push(rod(pts[i - 1], pts[i], 0.035, 0.035, 6));
		if (cage) rods.push(rod([s * 0.58 * w, -0.08, -1.45], [s * 0.5 * w, sy - 0.01, -1.15], 0.018), rod([s * 0.6 * w, -0.08, -0.2], [s * 0.55 * w, sy - 0.01, -0.55], 0.018), rod([s * 0.55 * w, sy, -0.55], [s * 0.33 * w, 1.6, -0.55], 0.016));
	}
	if (cage) rods.push(rod([-0.33 * w, 1.6, -0.55], [0.33 * w, 1.6, -0.55], 0.016));
	add(mergeGeometries(rods), M.cage);
	// klamka drzwi (lewa burta), gaśnica za fotelem, kieszeń na mapy
	add(rod([-0.58 * w, Math.min(0.95, sy + 0.12), -0.35], [-0.58 * w, Math.min(0.95, sy + 0.12), -0.15], 0.012), M.knobRed);
	add(new CylinderGeometry(0.055, 0.055, 0.34, 14).translate(0.34 * w, 0.08, Math.min(0.25, bulkheadZ - 0.12)), M.knobRed);
	add(box(0.02, 0.2, 0.3, 0.6 * w, 0.35, -0.6), M.seat);

	// ======================= fotel (i drugi, gdy kabina dwuosobowa) =======================
	const seatAt = (sx, belts) => {
		const seat = new Group();
		seat.position.x = sx;
		group.add(seat);
		add(box(0.48 * Math.min(1, w * 1.3), 0.09, 0.48, 0, 0.32, -0.36), M.seat, seat);
		add(box(0.5 * Math.min(1, w * 1.3), 0.06, 0.5, 0, 0.25, -0.36), M.cabin, seat);
		const back = add(box(0.48 * Math.min(1, w * 1.3), 0.7, 0.08, 0, 0.35, 0), M.seat, seat);
		back.position.set(0, 0.36, -0.1);
		back.rotation.x = 0.16;
		add(box(0.26, 0.16, 0.07, 0, 0.82, -0.02), M.seat, seat);
		if (!belts) return;
		// pasy czteropunktowe rozłożone na fotelu
		add(mergeGeometries([box(0.05, 0.6, 0.008, -0.12, 0.58, -0.155), box(0.05, 0.6, 0.008, 0.12, 0.58, -0.155), box(0.05, 0.008, 0.36, -0.17, 0.37, -0.42), box(0.05, 0.008, 0.36, 0.17, 0.37, -0.42)]), M.strap, seat);
		add(box(0.07, 0.012, 0.07, 0, 0.38, -0.5), M.chrome, seat);
	};
	seatAt(pilotX, true);
	if (secondSeat) seatAt(-pilotX, true);

	// ======================= drążek, dźwignie, pedały =======================
	const stick = new Group();
	stick.position.set(pilotX, -0.06, -0.95);
	group.add(stick);
	add(mergeGeometries([rod([0, 0, 0], [0, 0.5, 0.06], 0.016, 0.013, 10), new SphereGeometry(0.04, 10, 6).translate(0, 0, 0)]), M.cage, stick);
	add(new CylinderGeometry(0.022, 0.026, 0.13, 12).translate(0, 0.56, 0.065), M.knobBlack, stick);
	add(new CylinderGeometry(0.008, 0.008, 0.012, 8).translate(0, 0.63, 0.07), M.knobRed, stick);
	add(new CylinderGeometry(0.09, 0.12, 0.06, 16).translate(pilotX, -0.02, -0.95), M.rubber); // osłona u podstawy

	const tx = -0.47 * w + pilotX * (w < 0.8 ? 1 : 0.35); // pulpit przepustnicy przy lewej burcie
	add(box(0.08, 0.1, 0.32, tx, 0.33, -1.0), M.panel);
	const levers = [];
	for (const [x, mat] of [[tx - 0.02, M.knobBlack], [tx, M.knobBlue], [tx + 0.02, M.knobRed]]) {
		const g = new Group();
		g.position.set(x, 0.38, -1.02);
		group.add(g);
		add(rod([0, 0, 0], [0, 0.17, 0], 0.006), M.chrome, g);
		add(new SphereGeometry(0.018, 10, 8).translate(0, 0.18, 0), mat, g);
		g.rotation.x = -0.35;
		levers.push(g);
	}
	if (spray) {
		// zawór oprysku (żółta dźwignia, prawa burta)
		add(box(0.07, 0.08, 0.2, 0.47, 0.33, -0.95), M.panel);
		const lever = new Group();
		lever.position.set(0.47, 0.37, -0.95);
		group.add(lever);
		add(rod([0, 0, 0], [0, 0.15, 0.05], 0.007), M.chrome, lever);
		add(box(0.03, 0.05, 0.03, 0, 0.17, 0.06), M.knobYellow, lever);
	}
	for (const s of [-1, 1]) {
		add(box(0.09, 0.14, 0.02, pilotX + s * 0.16 * Math.min(1, w * 1.3), 0.06, -1.38).rotateX(-0.4), M.darkMetal);
		add(rod([pilotX + s * 0.16 * Math.min(1, w * 1.3), -0.08, -1.3], [pilotX + s * 0.16 * Math.min(1, w * 1.3), 0.02, -1.36], 0.012), M.darkMetal);
	}

	// ======================= tablica przyrządów =======================
	const panel = new Group();
	panel.position.set(panelX, 0.62, -1.36);
	panel.rotation.x = -0.2;
	panel.scale.setScalar(ps);
	group.add(panel);
	// osłona przeciwodblaskowa, listwa LED i kompas – w układzie punktu tablicy, skalowane razem z nią
	const dash = new Group();
	dash.position.set(panelX, 0.62, -1.36);
	dash.scale.setScalar(ps);
	group.add(dash);
	const PW = 1.04, PH = 0.52;
	add(box(PW, PH, 0.03, 0, 0, -0.016), M.panel, panel);
	const placard = placardTexture();
	const faceMat = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
	faceMat.colorNode = texture(placard).rgb;
	faceMat.emissiveNode = texture(placard).rgb.mul(glow).mul(backlight).mul(0.35);
	faceMat.aoNode = float(0.75);
	add(new PlaneGeometry(PW, PH).translate(0, 0, 0.0005), faceMat, panel, false);
	// osłona przeciwodblaskowa nad tablicą (z zaokrągloną krawędzią)
	add(box(1.0, 0.03, 0.3, 0, 0.275, -0.18), M.panel, dash);
	add(new CylinderGeometry(0.022, 0.022, 1.0, 12).rotateZ(Math.PI / 2).translate(0, 0.28, -0.03), M.rubber, dash);

	const needleMat = new MeshStandardNodeMaterial({ color: 0xf2f2ea, roughness: 0.4 });
	needleMat.emissiveNode = vec3(0.9, 0.9, 0.85).mul(glow).mul(backlight).mul(0.6);
	needleMat.aoNode = float(0.6);
	const orangeMat = new MeshStandardNodeMaterial({ color: 0xff7a10, roughness: 0.4 });
	orangeMat.emissiveNode = vec3(1, 0.45, 0.05).mul(backlight).mul(0.6);
	const bezelMat = M.knobBlack;
	const needleGeo = (len, w, tail = 0.15) => {
		const s = new Shape();
		s.moveTo(-w, -len * tail);
		s.lineTo(-w * 0.8, len * 0.7);
		s.lineTo(0, len);
		s.lineTo(w * 0.8, len * 0.7);
		s.lineTo(w, -len * tail);
		s.closePath();
		const g = new ShapeGeometry(s);
		g.deleteAttribute('uv');
		return g;
	};
	const faceMaterial = (canvas, overlay = false) => {
		const t = new CanvasTexture(canvas);
		t.colorSpace = SRGBColorSpace;
		t.anisotropy = 8;
		const m = new MeshStandardNodeMaterial({ roughness: 0.55 });
		m.colorNode = texture(t).rgb;
		m.emissiveNode = texture(t).rgb.mul(glow).mul(backlight).mul(0.5);
		m.aoNode = float(0.85);
		if (overlay) {
			m.transparent = true;
			m.opacityNode = texture(t).a;
			m.depthWrite = false;
		}
		return m;
	};
	/** Przyrząd: tarcza, pierścień, wskazówki (obracane wokół osi tarczy). */
	const gauge = (x, y, d, face, needles = [{ len: 0.4, w: 0.012 }]) => {
		const g = new Group();
		g.position.set(x, y, 0);
		panel.add(g);
		if (face) add(new CircleGeometry(d / 2, 48).translate(0, 0, 0.0015), face.isMaterial ? face : faceMaterial(face), g, false);
		add(new TorusGeometry(d / 2 + 0.004, 0.006, 6, 40).translate(0, 0, 0.003), bezelMat, g);
		const ns = needles.map(({ len, w, mat = needleMat, tail }) => {
			const p = new Group();
			p.position.z = 0.002 + ns_z++ * 0.0008;
			g.add(p);
			add(needleGeo(len * d, w * d * 2, tail), mat, p, false);
			return p;
		});
		add(new CircleGeometry(d * 0.045, 16).translate(0, 0, 0.006), M.knobBlack, g, false);
		return { group: g, needles: ns };
	};
	let ns_z = 0;
	const set = (needle, deg) => { needle.rotation.z = -deg * DEG; };

	const D = 0.092, d = 0.062;
	const R1 = 0.115, R2 = 0.012;
	const asi = gauge(-0.105, R1, D, dial({ title: 'km/h', min: 0, max: 400, a0: 20, a1: 340, major: 50, minor: 10, labels: 50,
		arcs: [[100, 180, '#eee', 0.72], [110, 260, '#1fa64a'], [260, 340, '#e8c11b']], redline: 342 }));
	// sztuczny horyzont: tarcza liczona w shaderze, nieruchoma nakładka (skala przechyłu, samolocik)
	const hz = { pitch: uniform(0), bank: uniform(0) };
	const aiMat = new MeshStandardNodeMaterial({ roughness: 0.5 });
	{
		const p = uv().sub(0.5).mul(2);
		const c = cos(hz.bank), s = sin(hz.bank);
		const q = vec2(p.x.mul(c).add(p.y.mul(s)), p.y.mul(c).sub(p.x.mul(s)));
		const K = 1 / (28 * DEG);
		const h = q.y.add(hz.pitch.mul(K));
		const fw = max(fwidth(h), 0.004);
		const sky = mix(vec3(0.06, 0.28, 0.62), vec3(0.2, 0.5, 0.86), clamp(h, 0, 1));
		const ground = mix(vec3(0.36, 0.2, 0.08), vec3(0.18, 0.1, 0.04), clamp(h.negate(), 0, 1));
		let col = mix(ground, sky, smoothstep(fw.negate(), fw, h));
		let line = float(1).sub(smoothstep(0.006, fw.add(0.012), abs(h)));
		for (const k of [-3, -2, -1, 1, 2, 3]) {
			const y = k * 10 * DEG * K * -1;
			const half = k % 2 === 0 ? 0.32 : 0.18;
			line = max(line, float(1).sub(smoothstep(0.005, fw.add(0.01), abs(h.add(y)))).mul(float(1).sub(smoothstep(half, half + 0.01, abs(q.x)))));
		}
		// wskaźnik przechyłu na obracającej się tarczy
		const tri = float(1).sub(smoothstep(0, 0.015, abs(q.x).sub(float(0.77).sub(q.y).mul(0.5)))).mul(smoothstep(0.65, 0.66, q.y));
		col = mix(col, vec3(0.95), max(line, tri));
		aiMat.colorNode = col;
		aiMat.emissiveNode = col.mul(glow).mul(backlight).mul(0.5);
		aiMat.aoNode = float(0.85);
	}
	const ai = gauge(0, R1, D, aiMat, []);
	add(new CircleGeometry(D / 2, 48).translate(0, 0, 0.0025), faceMaterial(attitudeOverlay(), true), ai.group, false);
	const alt = gauge(0.105, R1, D, dial({ title: 'm ×100', min: 0, max: 10, a0: 0, a1: 360, major: 1, minor: 0.2, labels: 1, fmt: (v) => (v % 10).toString(), skipLast: true }),
		[{ len: 0.27, w: 0.022 }, { len: 0.42, w: 0.012 }]);
	const turn = gauge(-0.105, R2, D, dial({ title: 'ZAKRĘT  2 MIN', min: -1, max: 1, a0: -60, a1: 60, major: 0.5, minor: 0.25, labels: 99, marks: [[-30, 'L'], [30, 'P']] }),
		[{ len: 0.4, w: 0.03, mat: orangeMat, tail: 0.05 }]);
	const cardMat = faceMaterial(headingCard());
	const hdg = gauge(0, R2, D, null, []);
	const card = add(new CircleGeometry(D / 2, 48).translate(0, 0, 0.0015), cardMat, hdg.group, false);
	const hdgOver = add(new CircleGeometry(D / 2, 48).translate(0, 0, 0.0025), faceMaterial(headingOverlay(), true), hdg.group, false);
	const vsi = gauge(0.105, R2, D, dial({ title: 'm/s', min: -10, max: 10, a0: 100, a1: 440, major: 2, minor: 1, labels: 2, fmt: (v) => Math.abs(v).toString() }));
	const clock = gauge(-0.27, R1, 0.08, dial({ title: 'ZEGAR', min: 0, max: 12, a0: 0, a1: 360, major: 1, minor: 0.2, labels: 1, fmt: (v) => (v === 0 ? '12' : v.toString()), skipLast: true }),
		[{ len: 0.26, w: 0.025 }, { len: 0.4, w: 0.016 }, { len: 0.43, w: 0.006, mat: orangeMat }]);
	const fuel = gauge(-0.27, R2, 0.07, dial({ title: 'PALIWO l', min: 0, max: 700, a0: -60, a1: 60, major: 100, minor: 50, labels: 200, arcs: [[0, 100, '#d02020']] }));
	const tach = gauge(0.255, R1, 0.085, dial({ title: 'obr/min ×100', min: 0, max: 30, a0: -135, a1: 135, major: 5, minor: 1, labels: 5, arcs: [[16, 21, '#1fa64a'], [21, 22, '#e8c11b']], redline: 22 }));
	const map = gauge(0.36, R1, 0.085, dial({ title: 'ŁAD. mm Hg', min: 300, max: 1300, a0: -135, a1: 135, major: 100, minor: 50, labels: 200, arcs: [[600, 1050, '#1fa64a']], redline: 1100 }));
	const oilT = gauge(0.24, 0.015, d, dial({ title: 'OLEJ °C', min: 0, max: 125, a0: -120, a1: 120, major: 25, minor: 5, labels: 50, arcs: [[60, 85, '#1fa64a']], redline: 85 }));
	const oilP = gauge(0.315, 0.015, d, dial({ title: 'OLEJ bar', min: 0, max: 10, a0: -120, a1: 120, major: 2, minor: 1, labels: 2, arcs: [[4, 6, '#1fa64a']], redline: 7 }));
	const cht = gauge(0.39, 0.015, d, dial({ title: 'GŁOWICE', min: 0, max: 300, a0: -120, a1: 120, major: 50, minor: 10, labels: 100, arcs: [[150, 215, '#1fa64a']], redline: 245 }));

	// lampki ostrzegawcze i przełączniki (dolny rząd), radio
	const lamp = (x, y, color) => {
		const c = uniform(new Color(0, 0, 0));
		const m = new MeshBasicNodeMaterial();
		m.colorNode = c;
		add(new PlaneGeometry(0.03, 0.018).translate(x, y, 0.003), m, panel, false);
		return { c, color: new Color(color) };
	};
	const lamps = {
		stall: lamp(-0.44, -0.07, 0xff2010), fuel: lamp(-0.385, -0.07, 0xffa010), gen: lamp(-0.33, -0.07, 0xffa010),
		strobe: lamp(-0.275, -0.07, 0xffffff), beacon: lamp(-0.22, -0.07, 0xff3020), landing: lamp(-0.165, -0.07, 0x30ff60),
	};
	const switches = [];
	for (let i = 0; i < 7; i++) {
		const g = new Group();
		g.position.set(-0.43 + i * 0.045, -0.17, 0.004);
		panel.add(g);
		add(new CylinderGeometry(0.009, 0.009, 0.006, 12).rotateX(Math.PI / 2), M.chrome, g, false);
		const lever = new Group();
		g.add(lever);
		add(rod([0, 0, 0], [0, 0, 0.028], 0.0035, 0.0025, 6), M.chrome, lever, false);
		lever.rotation.x = -0.45;
		switches.push(lever);
	}
	// radio: obudowa i wyświetlacz z częstotliwością
	add(box(0.22, 0.07, 0.03, 0.31, -0.13, 0.0), M.darkMetal, panel);
	const lcd = new MeshBasicNodeMaterial();
	const lcdTex = new CanvasTexture(lcdCanvas());
	lcdTex.colorSpace = SRGBColorSpace;
	lcd.colorNode = texture(lcdTex).rgb.mul(1.6);
	add(new PlaneGeometry(0.15, 0.03).translate(0.29, -0.12, 0.016), lcd, panel, false);
	for (let i = 0; i < 2; i++) add(new CylinderGeometry(0.011, 0.011, 0.015, 12).rotateX(Math.PI / 2).translate(0.39, -0.14 + i * 0.03, 0.02), M.knobBlack, panel);

	// listwa LED nawigacji agrolotniczej (25 diod) i kompas magnetyczny na osłonie
	add(box(0.36, 0.035, 0.035, 0, 0.31, -0.1), M.darkMetal, dash);
	const LEDS = 25;
	const ledMat = new MeshBasicNodeMaterial();
	const leds = new InstancedMesh(new SphereGeometry(0.0055, 8, 6), ledMat, LEDS);
	const o = new Object3D();
	for (let i = 0; i < LEDS; i++) {
		o.position.set((i - (LEDS - 1) / 2) * 0.0128, 0.31, -0.081);
		o.updateMatrix();
		leds.setMatrixAt(i, o.matrix);
		leds.setColorAt(i, new Color(0.02, 0.02, 0.02));
	}
	leds.frustumCulled = false;
	dash.add(leds);
	add(box(0.08, 0.04, 0.07, 0.24, 0.31, -0.14), M.knobBlack, dash);
	const compassCard = add(new CylinderGeometry(0.026, 0.026, 0.03, 20).translate(0, 0, 0), faceMaterial(compassStrip()), dash, false);
	compassCard.position.set(0.24, 0.345, -0.14);
	add(new SphereGeometry(0.031, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.24, 0.33, -0.14), M.glass, dash, false);

	const ledColor = new Color();
	let fuelL = 690;
	return {
		group, backlight, panel,
		/**
		 * Stan przyrządów. s – stan lotu, c – sterowanie (−1..1), rpm, hour – godzina gry, t – czas,
		 * L – stany świateł { strobeFlash, beaconFlash, landing }, night – 0..1, adapt – przyciemnienie świecących
		 * elementów przy dużej ekspozycji nocą (oko przystosowane do ciemności nie widzi ich jaśniej).
		 */
		update(s, c, rpm, hour, t, dt, L, night, adapt = 1) {
			backlight.value = night * adapt;
			const k = 1 - night * (1 - adapt);
			const kmh = s.speed * MS_TO_KMH;
			set(asi.needles[0], 20 + (Math.min(400, kmh) / 400) * 320);
			hz.pitch.value = s.gamma + s.alpha;
			hz.bank.value = s.bank;
			set(alt.needles[0], (s.y / 10000) * 360);
			set(alt.needles[1], ((s.y % 1000) / 1000) * 360);
			const rate = s.turnRate ?? (s.onGround ? 0 : (9.81 * Math.tan(s.bank)) / Math.max(20, s.speed)); // rad/s
			set(turn.needles[0], Math.max(-60, Math.min(60, (rate / (3 * DEG)) * 30)));
			card.rotation.z = s.heading;
			compassCard.rotation.y = s.heading + Math.sin(t * 1.3) * 0.02 * Math.abs(c.roll);
			const vs = Math.max(-10, Math.min(10, Math.sin(s.gamma) * s.speed));
			set(vsi.needles[0], 270 + vs * 17);
			const sec = (hour * 3600) % 43200;
			set(clock.needles[0], (sec / 43200) * 360);
			set(clock.needles[1], ((sec % 3600) / 3600) * 360);
			set(clock.needles[2], ((sec % 60) / 60) * 360);
			fuelL = Math.max(0, fuelL - dt * (0.02 + 0.06 * s.throttle));
			set(fuel.needles[0], -60 + (fuelL / 700) * 120);
			set(tach.needles[0], -135 + (Math.min(3000, rpm + Math.sin(t * 23) * 6) / 3000) * 270);
			set(map.needles[0], -135 + ((350 + s.throttle * 700 + (rpm > 0 ? 0 : -50)) - 300) / 1000 * 270);
			set(oilT.needles[0], -120 + ((62 + s.throttle * 16) / 125) * 240);
			set(oilP.needles[0], -120 + ((rpm > 0 ? 4.4 + s.throttle * 1.1 : 0) / 10) * 240);
			set(cht.needles[0], -120 + ((165 + s.throttle * 45) / 300) * 240);
			// drążek i dźwignie
			stick.rotation.set(c.pitch * -0.22 * -1, 0, -c.roll * 0.22);
			levers[0].rotation.x = 0.5 - s.throttle * 1.0;
			levers[1].rotation.x = -0.45;
			levers[2].rotation.x = -0.5;
			// lampki: przeciągnięcie (miga), mało paliwa, prądnica, stroboskop, błyskacz, reflektory
			const stall = s.speed < 36 && !s.onGround;
			const on = (lp, v) => lp.c.value.copy(lp.color).multiplyScalar((v ? 1.8 : 0.004 + 0.02 * (1 - night)) * k);
			on(lamps.stall, stall && (t * 4) % 1 < 0.5);
			on(lamps.fuel, fuelL < 100);
			on(lamps.gen, rpm < 400);
			on(lamps.strobe, L.strobeFlash > 0.5);
			on(lamps.beacon, L.beaconFlash > 0.3);
			on(lamps.landing, L.landing);
			// przełączniki: akumulator, prądnica, nawigacyjne, stroboskop, błyskacz, reflektory, ogrzewanie Pitota
			const sw = [1, 1, 1, 1, 1, L.landing ? 1 : 0, 0];
			switches.forEach((lv, i) => (lv.rotation.x = sw[i] ? -0.45 : 0.45));
			// listwa LED: zielony środek, punkt świetlny wędruje z przechyłem (wychylenie od kursu), skraje czerwone
			const pos = Math.round(((s.bank / 1.05) * 0.5 + 0.5) * (LEDS - 1));
			const lvl = (0.35 + night * 0.8) * k;
			for (let i = 0; i < LEDS; i++) {
				const dist = Math.abs(i - (LEDS - 1) / 2);
				const off = 0.003 + 0.012 * (1 - night);
				let r = off, g = off, b = off;
				if (i === pos || (Math.abs(i - pos) === 1 && dist < 2)) {
					if (dist < 2) { g = 2.4; r = 0.2; } else if (dist < 8) { r = 2.4; g = 1.4; } else { r = 2.6; g = 0.15; }
					r *= lvl * 2; g *= lvl * 2; b *= lvl;
				} else if (dist < 0.5) { g = 0.5 * lvl; }
				leds.setColorAt(i, ledColor.setRGB(r, g, b));
			}
			leds.instanceColor.needsUpdate = true;
		},
	};
}

function thetaForY(loft, st, y) {
	return loft.thetaForY(st, y);
}

// ======================= tarcze (canvas) =======================

function canvas(size = 256) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	return c;
}

/**
 * Tarcza przyrządu: kąty w stopniach zgodnie z ruchem wskazówek zegara od godziny 12. arcs – kolorowe łuki
 * zakresów [od, do, kolor, promień], redline – czerwona kreska, labels – co ile opisy, fmt – format opisu.
 */
function dial({ title = '', min, max, a0, a1, major, minor, labels, fmt = (v) => String(v), arcs = [], redline = null, marks = [], skipLast = false }) {
	const c = canvas(256);
	const g = c.getContext('2d');
	const C = 128;
	const ang = (v) => (a0 + ((v - min) / (max - min)) * (a1 - a0)) * DEG;
	const pt = (a, r) => [C + Math.sin(a) * r, C - Math.cos(a) * r];
	g.fillStyle = '#0d0e10';
	g.beginPath(); g.arc(C, C, 128, 0, Math.PI * 2); g.fill();
	const grad = g.createRadialGradient(C, C - 30, 10, C, C, 128);
	grad.addColorStop(0, 'rgba(255,255,255,0.05)'); grad.addColorStop(1, 'rgba(0,0,0,0.25)');
	g.fillStyle = grad; g.fill();
	for (const [from, to, color, rr = 0.88] of arcs) {
		g.strokeStyle = color;
		g.lineWidth = 10;
		g.beginPath();
		g.arc(C, C, 128 * rr - 5, ang(from) - Math.PI / 2, ang(to) - Math.PI / 2);
		g.stroke();
	}
	g.strokeStyle = '#f2f2ea';
	g.lineCap = 'butt';
	const n = Math.round((max - min) / minor);
	for (let i = 0; i <= n; i++) {
		const v = min + i * minor;
		if (skipLast && i === n) break;
		const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
		const a = ang(v);
		const [x0, y0] = pt(a, isMajor ? 96 : 106), [x1, y1] = pt(a, 120);
		g.lineWidth = isMajor ? 5 : 2.5;
		g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
		const isLabel = Math.abs(v / labels - Math.round(v / labels)) < 1e-6;
		if (isMajor && isLabel) {
			const [lx, ly] = pt(a, 74);
			g.fillStyle = '#f2f2ea';
			g.font = 'bold 26px Arial, sans-serif';
			g.textAlign = 'center'; g.textBaseline = 'middle';
			g.fillText(fmt(Math.round(v * 100) / 100), lx, ly);
		}
	}
	for (const [a, label] of marks) {
		const [lx, ly] = pt(a * DEG, 80);
		g.fillStyle = '#f2f2ea'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
		g.fillText(label, lx, ly);
	}
	if (redline !== null) {
		const a = ang(redline);
		const [x0, y0] = pt(a, 92), [x1, y1] = pt(a, 124);
		g.strokeStyle = '#e01818'; g.lineWidth = 6;
		g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
	}
	g.fillStyle = '#d8d8d0';
	g.font = 'bold 19px Arial, sans-serif';
	g.textAlign = 'center'; g.textBaseline = 'middle';
	g.fillText(title, C, C + 40);
	return c;
}

function attitudeOverlay() {
	const c = canvas(256);
	const g = c.getContext('2d');
	const C = 128;
	g.clearRect(0, 0, 256, 256);
	// czarny pierścień ze skalą przechyłu
	g.fillStyle = '#0d0e10';
	g.beginPath(); g.arc(C, C, 128, 0, Math.PI * 2); g.arc(C, C, 100, 0, Math.PI * 2, true); g.fill();
	g.strokeStyle = '#f2f2ea';
	for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
		const r = a * DEG;
		const len = Math.abs(a) % 30 === 0 ? 22 : 12;
		g.lineWidth = Math.abs(a) % 30 === 0 ? 5 : 3;
		g.beginPath(); g.moveTo(C + Math.sin(r) * 102, C - Math.cos(r) * 102); g.lineTo(C + Math.sin(r) * (102 + len), C - Math.cos(r) * (102 + len)); g.stroke();
	}
	g.fillStyle = '#f2f2ea';
	g.beginPath(); g.moveTo(C, 102); g.lineTo(C - 9, 118); g.lineTo(C + 9, 118); g.fill();
	// samolocik (pomarańczowy)
	g.strokeStyle = '#ff7a10'; g.lineWidth = 8; g.lineCap = 'round';
	g.beginPath(); g.moveTo(C - 64, C); g.lineTo(C - 22, C); g.lineTo(C - 10, C + 12); g.stroke();
	g.beginPath(); g.moveTo(C + 64, C); g.lineTo(C + 22, C); g.lineTo(C + 10, C + 12); g.stroke();
	g.fillStyle = '#ff7a10'; g.beginPath(); g.arc(C, C, 6, 0, Math.PI * 2); g.fill();
	return c;
}

function headingCard() {
	const c = canvas(256);
	const g = c.getContext('2d');
	const C = 128;
	g.fillStyle = '#0d0e10';
	g.beginPath(); g.arc(C, C, 128, 0, Math.PI * 2); g.fill();
	g.strokeStyle = '#f2f2ea'; g.fillStyle = '#f2f2ea';
	for (let a = 0; a < 360; a += 5) {
		const r = a * DEG;
		const len = a % 30 === 0 ? 20 : a % 10 === 0 ? 14 : 8;
		g.lineWidth = a % 10 === 0 ? 3.5 : 2;
		g.beginPath(); g.moveTo(C + Math.sin(r) * (122 - len), C - Math.cos(r) * (122 - len)); g.lineTo(C + Math.sin(r) * 122, C - Math.cos(r) * 122); g.stroke();
		if (a % 30 === 0) {
			const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10);
			g.save();
			g.translate(C + Math.sin(r) * 84, C - Math.cos(r) * 84);
			g.rotate(r);
			g.font = `bold ${label.length > 1 ? 22 : 28}px Arial`;
			g.textAlign = 'center'; g.textBaseline = 'middle';
			g.fillText(label, 0, 0);
			g.restore();
		}
	}
	return c;
}

function headingOverlay() {
	const c = canvas(256);
	const g = c.getContext('2d');
	const C = 128;
	g.clearRect(0, 0, 256, 256);
	g.fillStyle = '#ff7a10';
	g.beginPath(); g.moveTo(C, 4); g.lineTo(C - 8, 22); g.lineTo(C + 8, 22); g.fill();
	// sylwetka samolotu
	g.fillStyle = '#ff7a10';
	g.beginPath();
	g.moveTo(C, C - 40); g.lineTo(C + 5, C - 10); g.lineTo(C + 40, C + 2); g.lineTo(C + 40, C + 9); g.lineTo(C + 5, C + 6);
	g.lineTo(C + 4, C + 28); g.lineTo(C + 15, C + 33); g.lineTo(C + 15, C + 38); g.lineTo(C, C + 36); g.lineTo(C - 15, C + 38); g.lineTo(C - 15, C + 33);
	g.lineTo(C - 4, C + 28); g.lineTo(C - 5, C + 6); g.lineTo(C - 40, C + 9); g.lineTo(C - 40, C + 2); g.lineTo(C - 5, C - 10);
	g.closePath(); g.fill();
	for (const a of [45, 90, 135, 225, 270, 315]) {
		const r = a * DEG;
		g.strokeStyle = '#f2f2ea'; g.lineWidth = 4;
		g.beginPath(); g.moveTo(C + Math.sin(r) * 112, C - Math.cos(r) * 112); g.lineTo(C + Math.sin(r) * 126, C - Math.cos(r) * 126); g.stroke();
	}
	return c;
}

function compassStrip() {
	const c = document.createElement('canvas');
	c.width = 512; c.height = 64;
	const g = c.getContext('2d');
	g.fillStyle = '#16181a'; g.fillRect(0, 0, 512, 64);
	g.fillStyle = '#f2f2ea'; g.strokeStyle = '#f2f2ea'; g.font = 'bold 22px Arial'; g.textAlign = 'center';
	for (let a = 0; a < 360; a += 10) {
		const x = 512 - (a / 360) * 512;
		g.lineWidth = 2;
		g.beginPath(); g.moveTo(x, 0); g.lineTo(x, a % 30 === 0 ? 18 : 10); g.stroke();
		if (a % 30 === 0) g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] ?? String(a / 10), x, 44);
	}
	return c;
}

function lcdCanvas() {
	const c = document.createElement('canvas');
	c.width = 512; c.height = 102;
	const g = c.getContext('2d');
	g.fillStyle = '#0a0602'; g.fillRect(0, 0, 512, 102);
	g.fillStyle = '#ffae2a'; g.font = 'bold 56px "Courier New", monospace'; g.textBaseline = 'middle';
	g.fillText('122.800', 18, 52);
	g.font = 'bold 34px "Courier New", monospace';
	g.fillStyle = '#c47a14';
	g.fillText('↔ 129.125', 270, 54);
	return c;
}

/** Nadruki na tablicy: opisy lampek i przełączników, wkręty, delikatna faktura. */
function placardTexture() {
	const c = document.createElement('canvas');
	c.width = 1024; c.height = 512;
	const g = c.getContext('2d');
	g.fillStyle = '#1a1b1d'; g.fillRect(0, 0, 1024, 512);
	for (let i = 0; i < 6000; i++) {
		g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
		g.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
	}
	const X = (x) => (x / 1.04 + 0.5) * 1024, Y = (y) => (0.5 - y / 0.52) * 512;
	g.fillStyle = '#d8d8d0'; g.textAlign = 'center'; g.textBaseline = 'middle';
	g.font = 'bold 10px Arial';
	const lampNames = ['PRZECIĄG', 'PALIWO', 'PRĄDN.', 'STROBO', 'BŁYSK.', 'REFL.'];
	lampNames.forEach((t, i) => g.fillText(t, X(-0.44 + i * 0.055), Y(-0.093)));
	const sw = ['AKU', 'PRĄD', 'NAW', 'STROB', 'BŁYSK', 'REFL', 'PITOT'];
	sw.forEach((t, i) => g.fillText(t, X(-0.43 + i * 0.045), Y(-0.198)));
	g.font = 'bold 15px Arial';
	g.fillText('RADIO VHF', X(0.31), Y(-0.185));
	g.fillText('SILNIK', X(0.31), Y(0.235));
	g.fillText('LOT', X(0), Y(0.235));
	g.strokeStyle = 'rgba(220,220,210,0.5)'; g.lineWidth = 2;
	g.strokeRect(X(-0.465), Y(-0.045), X(-0.14) - X(-0.465), Y(-0.215) - Y(-0.045));
	// wkręty w narożnikach
	for (const [x, y] of [[-0.5, 0.24], [0.5, 0.24], [-0.5, -0.24], [0.5, -0.24], [-0.17, 0.24], [0.17, 0.24]]) {
		g.fillStyle = '#5a5c5e'; g.beginPath(); g.arc(X(x), Y(y), 6, 0, Math.PI * 2); g.fill();
		g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(x) - 4, Y(y)); g.lineTo(X(x) + 4, Y(y)); g.stroke();
	}
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}
