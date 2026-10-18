// PZL-130TC-II Orlik – turbośmigłowy samolot szkolny Sił Powietrznych: długi, smukły nos z silnikiem PT6A,
// dwiema rurami wydechowymi po bokach i wlotem powietrza pod kołpakiem, pięciołopatowe śmigło, kabina tandem pod
// długą owiewką z łukiem między fotelami, dolnopłat zbieżny ze wzniosem, skośny statecznik pionowy. Podwozie
// trójkołowe chowane – samo, gdy prędkość przekroczy ~180 km/h (główne do wnętrza skrzydeł, przednie do tyłu).
// Malowanie: biel z czerwonym pasem, matowy pas przed owiewką, szachownice na skrzydłach i usterzeniu, numer
// taktyczny na nosie. Rozpiętość 9,0 m, długość 9,0 m. Oś x – w prawo, y – w górę, z – do tyłu.
import { Group, CylinderGeometry, SphereGeometry, CircleGeometry, Vector3 } from 'three/webgpu';
import { vec3, float, max, mix, smoothstep } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, checkerboard, finish } from './parts.js';

const DEG = Math.PI / 180;
export const REGISTRATION = '042';

const WING = { tip: 4.5, root: 1.95, tipChord: 1.05, le: -0.85, y: -0.32, dihedral: 6 * DEG };
const wingChord = (x) => WING.root - (Math.abs(x) / WING.tip) * (WING.root - WING.tipChord);
const wingLe = (x) => WING.le + Math.abs(x) * 0.1;
const wingY = (x) => WING.y + Math.max(0, Math.abs(x) - 0.45) * Math.tan(WING.dihedral);
const GEAR_UP = 50; // m/s – powyżej podwozie chowa się, poniżej wypuszcza

const FUSELAGE = [
	{ z: -3.45, w: 0.29, top: 0.29, bot: -0.27, belt: 0.02, n: 2 },
	{ z: -3.32, w: 0.35, top: 0.34, bot: -0.38, belt: 0, n: 2.2 },
	{ z: -2.6, w: 0.42, top: 0.4, bot: -0.47, belt: -0.02, n: 2.4 },
	{ z: -1.9, w: 0.45, top: 0.45, bot: -0.5, belt: -0.02, n: 2.6 },
	{ z: -1.5, w: 0.46, top: 0.52, bot: -0.5, belt: -0.02, n: 2.8 },
	{ z: -0.85, w: 0.47, top: 0.97, bot: -0.5, belt: 0, n: 2.6 },
	{ z: 0.0, w: 0.47, top: 1.1, bot: -0.48, belt: 0, n: 2.5 },
	{ z: 0.9, w: 0.46, top: 1.08, bot: -0.45, belt: 0, n: 2.5 },
	{ z: 1.6, w: 0.4, top: 0.8, bot: -0.38, belt: 0.02, n: 2.3 },
	{ z: 2.4, w: 0.3, top: 0.6, bot: -0.25, belt: 0.06, n: 2.2 },
	{ z: 3.6, w: 0.2, top: 0.5, bot: -0.05, belt: 0.15, n: 2.1 },
	{ z: 4.8, w: 0.11, top: 0.42, bot: 0.12, belt: 0.25, n: 2 },
	{ z: 5.3, w: 0.04, top: 0.38, bot: 0.22, belt: 0.3, n: 2 },
];
// owiewka tandem: szkło od szyny (0,5 m) w górę, bez dachu; łuki – wiatrochron i między fotelami
const CABIN = { front: -1.45, roofFront: 1.55, back: 1.55, roofX: 0 };
const sillY = () => 0.5;

export const ANCHORS = {
	navL: [-WING.tip - 0.04, wingY(WING.tip) + 0.02, wingLe(WING.tip) + 0.2],
	navR: [WING.tip + 0.04, wingY(WING.tip) + 0.02, wingLe(WING.tip) + 0.2],
	strobeL: [-WING.tip - 0.04, wingY(WING.tip) + 0.02, wingLe(WING.tip) + 0.65],
	strobeR: [WING.tip + 0.04, wingY(WING.tip) + 0.02, wingLe(WING.tip) + 0.65],
	tail: [0, 0.32, 5.34],
	beacon: [0, 0.74, 2.0],
	landingL: [-1.1, wingY(1.1), wingLe(1.1) - 0.012],
	landingR: [1.1, wingY(1.1), wingLe(1.1) - 0.012],
	exhaustL: [-0.5, 0.02, -2.45],
	exhaustR: [0.5, 0.02, -2.45],
	eye: [0, 0.95, -0.22],
	cabinLight: [0, 1.0, -0.2],
};

const RED = vec3(0.8, 0.04, 0.08);
const livery = {
	base: 0xf2f2ef,
	trim: 0xc8102e,
	trim2: 0x2a2d30,
	// czerwony pas wzdłuż kadłuba, matowy szary pas przed owiewką, numer na nosie, linie blach
	fuselageDetail: (p, { seam, down }) => {
		const d = p.y.add(p.z.mul(0.05));
		const red = smoothstep(-0.24, -0.22, d).mul(down(-0.06, -0.08, d)).mul(smoothstep(-3.0, -2.95, p.z));
		const glare = smoothstep(0.24, 0.27, p.y).mul(smoothstep(-2.95, -2.9, p.z)).mul(down(-1.46, -1.5, p.z)).mul(down(0.28, 0.25, p.x.abs()));
		let lines = float(0);
		for (const z of [-3.3, -2.0, -1.5, 1.6, 2.4, 3.6]) lines = max(lines, seam(p.z.sub(z)));
		const base = vec3(1).mul(float(1).sub(lines.mul(0.35)));
		return { tint: mix(mix(base, RED, red), vec3(0.05, 0.055, 0.06), glare), rough: glare.mul(0.5) };
	},
	// szachownice z obwódką na górze i spodzie obu skrzydeł (na nieruchomej części, przed lotką)
	wingDetail: (p, { seam }) => {
		const ax = p.x.abs();
		const c = checkerboard(ax.sub(3.25).div(0.3), p.z.add(0.08).div(0.3), 0.12);
		let lines = seam(ax.sub(0.45));
		lines = max(lines, seam(ax.sub(2.18)));
		return { tint: mix(vec3(1).mul(float(1).sub(lines.mul(0.3))), c.color, c.inside), rough: float(0) };
	},
};

export function createOrlik(atmo) {
	const root = new Group();
	root.name = 'orlik';
	const { M, environment, paint } = makeMaterials(atmo, livery);
	const { add, at } = adder(root);

	// ======================= kadłub i owiewka =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -1.4 ? 0.07 : z < 1.6 ? 0.05 : 0.16),
		pillars: [-0.85, 0.42], innerY: 0.6, frameR: 0.022,
	});
	add(at(new SphereGeometry(0.045, 10, 8), 0, 0.3, 5.3), M.fuselage);
	// wlot powietrza pod kołpakiem, rury wydechowe po bokach, chłodnica oleju
	add(at(new SphereGeometry(1, 20, 10).scale(0.2, 0.12, 0.45), 0, -0.36, -2.95), M.fuselage);
	add(at(new CircleGeometry(1, 20).scale(0.16, 0.08, 1).rotateY(Math.PI), 0, -0.36, -3.38), M.black);
	for (const s of [-1, 1]) add(rod([s * 0.36, 0.04, -2.75], [s * 0.5, 0.02, -2.42], 0.09, 0.1, 12, true), M.darkMetal);
	const prop = propeller(root, add, M, atmo, { pos: [0, 0.02, -3.52], radius: 1.18, blades: 5, spinner: [0.27, 0.55], rootChord: 0.18, bladeMat: M.black, tipMat: M.white, tipColor: [0.5, 0.05, 0.05], spinnerMat: M.trim2 });

	// ======================= skrzydło =======================
	const foil = airfoil(26, 0.15, 0.02, 0.4);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.72), surface = profileSection(foil, 0.74, 1);
	const W = { chord: wingChord, leZ: wingLe, y: wingY };
	const parts = [airfoilPanel(full, -0.5, 0.5, { ...W, caps: false })];
	const tips = [], ailerons = [];
	for (const s of [-1, 1]) {
		parts.push(airfoilPanel(fixed, s * 0.5, s * 4.2, { ...W, steps: 6 }));
		parts.push(airfoilPanel(surface, s * 0.5, s * 2.15, { ...W, steps: 3 })); // klapa
		tips.push(airfoilPanel(full, s * 4.2, s * WING.tip, { ...W, steps: 3, thick: (x) => 1 - ((Math.abs(x) - 4.2) / 0.3) ** 2 * 0.55 }));
		const a = airfoilPanel(surface, s * 2.2, s * 4.18, { ...W, steps: 3 });
		const h = (x) => new Vector3(s * x, wingY(x) + 0.012 * wingChord(x), wingLe(x) + 0.74 * wingChord(x));
		ailerons.push(hinged(root, a, h(2.2), h(4.18), M.yellow, s < 0));
	}
	add(mergeGeometries(parts), M.wing);
	add(mergeGeometries(tips), M.white);
	const lamps = lampSet(root, add, ANCHORS);

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.1, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.58), tSurf = profileSection(tailFoil, 0.6, 1);
	const HY = 0.3;
	const H = { chord: (x) => 1.05 - Math.abs(x) * 0.22, leZ: (x) => 4.1 + Math.abs(x) * 0.25, y: HY };
	add(mergeGeometries([airfoilPanel(tFixed, -0.15, 0.15, { ...H, caps: false }), airfoilPanel(tFixed, -0.15, -1.85, { ...H, steps: 2 }), airfoilPanel(tFixed, 0.15, 1.85, { ...H, steps: 2 })]), M.fuselage);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.02, s * 1.85, { ...H, steps: 2 });
		elevators.push(hinged(root, g, new Vector3(s * 0.02, HY, H.leZ(0.02) + 0.6 * H.chord(0.02)), new Vector3(s * 1.85, HY, H.leZ(1.85) + 0.6 * H.chord(1.85)), M.yellow, s < 0));
	}
	// statecznik pionowy (skośny) z szachownicą z obwódką, grzbietowa płetwa przed nim
	const finMat = paint(0xf2f2ef, {
		detail: (p) => {
			const c = checkerboard(p.z.sub(4.36).div(0.22), p.y.sub(1.02).div(0.22), 0.12);
			return { tint: mix(vec3(1), c.color, c.inside), rough: float(0) };
		},
	});
	const F = { chord: (s) => 1.55 - s * 0.55, leZ: (s) => 3.55 + s * 0.75, y: 0 };
	const fin = airfoilPanel(tFixed, 0, 1.3, { ...F, steps: 3 });
	const finTop = airfoilPanel(tFull, 1.3, 1.36, { ...F, steps: 1 });
	const dorsal = airfoilPanel(tFull, 0, 0.3, { chord: (s) => 1.4 - s * 3.5, leZ: (s) => 2.75 + s * 2.6, y: 0, steps: 2 });
	for (const g of [fin, finTop, dorsal]) { g.rotateZ(Math.PI / 2); g.translate(0, 0.4, 0); }
	dorsal.translate(0, -0.02, 0);
	add(mergeGeometries([fin, finTop]), finMat);
	add(dorsal, M.fuselage);
	const rud = airfoilPanel(tSurf, 0.04, 1.3, { ...F, steps: 3 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 0.4, 0);
	const rudder = hinged(root, rud, new Vector3(0, 0.44, F.leZ(0.04) + 0.6 * F.chord(0.04)), new Vector3(0, 1.7, F.leZ(1.3) + 0.6 * F.chord(1.3)), M.white);

	// ======================= podwozie chowane =======================
	// każda goleń w osobnej grupie obracanej wokół zawiasu (główne – do środka, przednia – do tyłu)
	const legs = [];
	for (const s of [-1, 1]) {
		const pivot = new Group();
		pivot.position.set(s * 1.5, wingY(1.5) - 0.02, 0.12);
		root.add(pivot);
		add(rod([0, 0, 0], [0, -0.72, 0], 0.05, 0.05, 10), M.darkMetal, pivot);
		add(rod([0, -0.72, 0], [0, -1.0, 0], 0.035, 0.035, 10), M.chrome, pivot);
		add(rod([0, -0.35, 0], [0, -0.05, 0.32], 0.025, 0.025, 6), M.darkMetal, pivot); // zastrzał
		add(at(tyre(0.27, 0.16, 0.15), s * 0.1, -1.0, 0), M.rubber, pivot);
		add(at(new CylinderGeometry(0.12, 0.12, 0.12, 14).deleteAttribute('uv').rotateZ(Math.PI / 2), s * 0.1, -1.0, 0), M.metal, pivot);
		legs.push({ pivot, up: (k) => pivot.rotation.set(0, 0, -s * k * Math.PI / 2) });
	}
	{
		const pivot = new Group();
		pivot.position.set(0, -0.3, -2.55);
		root.add(pivot);
		add(rod([0, 0, 0], [0, -0.62, -0.02], 0.04, 0.04, 10), M.darkMetal, pivot);
		add(rod([0, -0.62, -0.02], [0, -0.95, -0.05], 0.03, 0.03, 10), M.chrome, pivot);
		add(rod([0.07, -0.95, -0.05], [0.07, -0.83, -0.05], 0.015), M.darkMetal, pivot);
		add(rod([-0.07, -0.95, -0.05], [-0.07, -0.83, -0.05], 0.015), M.darkMetal, pivot);
		add(at(tyre(0.2, 0.11, 0.12), 0, -0.95, -0.05), M.rubber, pivot);
		legs.push({ pivot, up: (k) => pivot.rotation.set(-k * Math.PI / 2, 0, 0) });
	}
	// rurka Pitota pod prawym skrzydłem, antena na grzbiecie
	add(rod([3.5, wingY(3.5) - 0.06, wingLe(3.5) + 0.2], [3.5, wingY(3.5) - 0.06, wingLe(3.5) - 0.35], 0.011, 0.008), M.chrome);
	add(rod([0, 0.68, 2.3], [0, 0.98, 2.6], 0.012, 0.004, 5), M.black);

	// ======================= numer, piloci, kabina =======================
	const regMat = registrationMaterial(REGISTRATION, environment, '#111');
	sideRegistration(root, loft, regMat, { zc: -2.25, y: 0.12, len: 0.75, h: 0.3 });
	const pilot = new Group();
	root.add(pilot);
	pilotFigure(pilot, add, M, [0, 0.93, -0.28], 0.9);
	pilotFigure(pilot, add, M, [0, 0.9, 0.62], 0.9); // instruktor z tyłu
	const cockpit = createCockpit(M, atmo, { loft, origin: [0, -0.25, 0.2], width: 0.62, panelScale: 0.62, sill: 0.5, bulkheadZ: 0.3, cage: false });
	root.add(cockpit.group);

	let gear = -1; // 0 – wypuszczone, 1 – schowane (−1 – jeszcze nieustawione)
	root.userData = {
		prop: prop.prop, blades: prop.blades, disc: prop.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, anchors: ANCHORS,
		animate(dt, rpm, controls, speed = 0) {
			prop.spin(dt, rpm);
			ailerons[0].deflect(controls.roll * 0.4);
			ailerons[1].deflect(-controls.roll * 0.4);
			for (const e of elevators) e.deflect(-controls.pitch * 0.45);
			rudder.deflect(controls.yaw * 0.35);
			// chowanie i wypuszczanie podwozia trwa ~5 s; na początku lotu od razu w położeniu docelowym
			const target = speed > GEAR_UP ? 1 : 0;
			gear = gear < 0 ? target : gear + Math.max(-dt * 0.2, Math.min(dt * 0.2, target - gear));
			const k = gear * gear * (3 - 2 * gear);
			for (const l of legs) { l.up(k); l.pivot.visible = k < 0.98; } // schowane – wnęki zamknięte pokrywami
		},
	};
	return finish(root);
}
