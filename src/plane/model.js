// Model PZL M-18 Dromader z geometrii liczonej w kodzie (bez plików). Kadłub z przekrojów superelips: osłona
// silnika gwiazdowego z widocznymi cylindrami i klapkami chłodzenia, garb zbiornika na środki, przeszklona kabina
// z ramami, zwężający się ogon. Dolnopłat o profilu NACA 4415 z wzniosem zewnętrznych części, zbieżnymi końcówkami,
// klapami i ruchomymi lotkami; usterzenie z zastrzałami, ruchomy ster wysokości i kierunku. Podwozie z oponami,
// belka oprysku z dyszami, wiatraczek pompy, nożyce do przewodów i linka od kabiny do statecznika, antena, rurka
// Pitota, znaki rejestracyjne. W środku – kabina (cockpit.js). Wymiary jak w oryginale: rozpiętość 17,7 m,
// długość 9,5 m. Oś x – w prawo, y – w górę, z – do tyłu (nos w −z).
import { Group, Mesh, CylinderGeometry, SphereGeometry, BoxGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, underwingRegistration, finish } from './parts.js';

export { airfoil };

const DEG = Math.PI / 180;
export const REGISTRATION = 'SP-DRB';

// --- wymiary ---
const WING = { root: 1.0, kink: 5.5, tip: 8.85, chord: 2.3, tipChord: 1.8, le: -1.59, y: -0.45, dihedral: 5 * DEG };
const wingChord = (x) => { const a = Math.abs(x); return a < WING.kink ? WING.chord : WING.chord - ((a - WING.kink) / (WING.tip - WING.kink)) * (WING.chord - WING.tipChord); };
const wingLe = (x) => WING.le + (WING.chord - wingChord(x)); // krawędź spływu prosta, natarcie zbieżne
const wingY = (x) => WING.y + Math.max(0, Math.abs(x) - WING.root) * Math.tan(WING.dihedral);
const wingThick = (x) => 1 - Math.max(0, Math.abs(x) - WING.root) / (WING.tip - WING.root) * 0.25;

// przekroje kadłuba: z, pół szerokości, góra, dół, wysokość najszerszego miejsca, wykładnik superelipsy
const FUSELAGE = [
	{ z: -4.42, w: 0.64, top: 0.66, bot: -0.64, belt: 0.01, n: 2 },
	{ z: -4.36, w: 0.70, top: 0.72, bot: -0.70, belt: 0.01, n: 2 },
	{ z: -4.1, w: 0.74, top: 0.76, bot: -0.74, belt: 0.01, n: 2 },
	{ z: -3.3, w: 0.75, top: 0.78, bot: -0.75, belt: 0, n: 2.1 },
	{ z: -3.13, w: 0.775, top: 0.805, bot: -0.775, belt: 0, n: 2.2 },
	{ z: -3.05, w: 0.75, top: 0.82, bot: -0.76, belt: -0.02, n: 2.5 },
	{ z: -2.5, w: 0.71, top: 0.93, bot: -0.76, belt: -0.05, n: 3.2 },
	{ z: -1.9, w: 0.69, top: 0.98, bot: -0.74, belt: -0.05, n: 3.6 },
	{ z: -1.64, w: 0.68, top: 0.995, bot: -0.73, belt: -0.05, n: 3.6 },
	{ z: -1.12, w: 0.67, top: 1.64, bot: -0.71, belt: -0.05, n: 3.2 },
	{ z: -0.6, w: 0.66, top: 1.68, bot: -0.7, belt: -0.05, n: 3.2 },
	{ z: 0.0, w: 0.64, top: 1.66, bot: -0.68, belt: -0.05, n: 3.2 },
	{ z: 0.45, w: 0.58, top: 1.45, bot: -0.64, belt: -0.05, n: 3.2 },
	{ z: 1.0, w: 0.48, top: 1.08, bot: -0.58, belt: -0.03, n: 3 },
	{ z: 1.8, w: 0.38, top: 0.9, bot: -0.46, belt: 0, n: 2.8 },
	{ z: 2.8, w: 0.28, top: 0.78, bot: -0.28, belt: 0.1, n: 2.6 },
	{ z: 3.8, w: 0.19, top: 0.68, bot: -0.06, belt: 0.25, n: 2.4 },
	{ z: 4.6, w: 0.12, top: 0.62, bot: 0.12, belt: 0.36, n: 2.2 },
	{ z: 4.98, w: 0.04, top: 0.57, bot: 0.3, belt: 0.43, n: 2 },
];
// granice przeszklenia
const CABIN = { front: -1.62, roofFront: -1.13, back: 0.4, roofX: 0.36 };
const sillY = (z) => (z < -1.35 ? 0.82 + Math.min(1, (-1.35 - z) / 0.27) * 0.2 : 0.82);
/** Punkty kotwiczenia świateł i kamery (układ samolotu). */
export const ANCHORS = {
	navL: [-WING.tip - 0.04, wingY(WING.tip) + 0.06, wingLe(WING.tip) + 0.3],
	navR: [WING.tip + 0.04, wingY(WING.tip) + 0.06, wingLe(WING.tip) + 0.3],
	strobeL: [-WING.tip - 0.04, wingY(WING.tip) + 0.06, wingLe(WING.tip) + 0.75],
	strobeR: [WING.tip + 0.04, wingY(WING.tip) + 0.06, wingLe(WING.tip) + 0.75],
	tail: [0, 0.92, 5.34],
	beacon: [0, 2.63, 4.78],
	landingL: [-2.7, wingY(2.7) + 0.01, WING.le - 0.012],
	landingR: [2.7, wingY(2.7) + 0.01, WING.le - 0.012],
	exhaustL: [-0.66, -0.4, -2.72],
	exhaustR: [0.66, -0.4, -2.72],
	eye: [0, 1.2, -0.42],
	cabinLight: [0, 1.28, -0.9],
};

export function createDromader(atmo) {
	const root = new Group();
	root.name = 'dromader';
	const { M, environment, fresnel } = makeMaterials(atmo);

	const { add, at } = adder(root);

	// ======================= kadłub =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -3.0 ? 0.06 : z < 0.6 ? 0.05 : 0.14),
		pillars: [-0.55, 0.0],
	});
	add(at(new SphereGeometry(0.06, 10, 8), 0, 0.43, 4.98), M.fuselage); // ogon zamknięty

	// ======================= silnik =======================
	// wlot osłony, cylindry gwiazdy (9) z żebrami, karter, ciemne wnętrze
	add(at(new TorusGeometry(0.655, 0.04, 8, 48), 0, 0.01, -4.42), M.metal);
	const engine = [];
	const back = new CylinderGeometry(0.62, 0.62, 0.05, 32); back.rotateX(Math.PI / 2); engine.push(at(back, 0, 0.01, -4.05));
	add(mergeGeometries(engine), M.black);
	const cyl = [];
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2;
		const dir = [Math.sin(a), Math.cos(a)];
		const g = rod([dir[0] * 0.22, 0.01 + dir[1] * 0.22, -4.2], [dir[0] * 0.55, 0.01 + dir[1] * 0.55, -4.2], 0.085, 0.07, 12);
		cyl.push(g);
		for (let k = 0; k < 6; k++) {
			const r0 = 0.3 + k * 0.045;
			cyl.push(rod([dir[0] * r0, 0.01 + dir[1] * r0, -4.2], [dir[0] * (r0 + 0.012), 0.01 + dir[1] * (r0 + 0.012), -4.2], 0.11, 0.11, 12));
		}
		// popychacze
		cyl.push(rod([dir[0] * 0.2, 0.01 + dir[1] * 0.2, -4.28], [dir[0] * 0.5, 0.01 + dir[1] * 0.5, -4.3], 0.012));
	}
	const crank = new SphereGeometry(0.24, 18, 12); crank.scale(1, 1, 0.6);
	cyl.push(at(crank, 0, 0.01, -4.22));
	add(mergeGeometries(cyl), M.darkMetal);
	// klapki chłodzenia za osłoną
	const flapsG = [];
	for (let i = 0; i < 18; i++) {
		const a = (i / 18) * Math.PI * 2;
		const b = new BoxGeometry(0.29, 0.008, 0.16);
		b.rotateX(-0.12);
		b.translate(0, 0.79, 0);
		b.rotateZ(a);
		b.translate(0, 0, -3.08);
		flapsG.push(b);
	}
	add(mergeGeometries(flapsG.map((g) => (g.deleteAttribute('uv'), g))), M.yellow);
	// wydechy i wlot chłodnicy oleju
	add(mergeGeometries([
		rod([-0.6, -0.36, -3.05], [-0.68, -0.42, -2.66], 0.065, 0.075, 10, true),
		rod([0.6, -0.36, -3.05], [0.68, -0.42, -2.66], 0.065, 0.075, 10, true),
	]), M.exhaust);
	add(at(new BoxGeometry(0.42, 0.18, 0.6).deleteAttribute('uv'), 0, -0.76, -3.55), M.fuselage);
	add(at(new BoxGeometry(0.36, 0.02, 0.02).deleteAttribute('uv'), 0, -0.76, -3.86), M.black);

	// zbiornik: pokrywa wlewu, nożyce do przewodów przed szybą, linka do statecznika, antena
	const lid = new CylinderGeometry(0.22, 0.24, 0.05, 24);
	add(at(lid, 0, 0.955, -2.25), M.yellow);
	add(at(new CylinderGeometry(0.03, 0.03, 0.08, 8), 0.15, 1.0, -2.25), M.metal);
	const cutter = new BoxGeometry(0.012, 1.05, 0.06).deleteAttribute('uv');
	cutter.rotateX(0.8);
	add(at(cutter, 0, 1.355, -1.575), M.metal);
	add(rod([0, 1.69, -0.35], [0, 2.6, 4.45], 0.006, 0.006, 5), M.darkMetal);
	add(rod([0.2, 1.66, -0.1], [0.24, 2.22, 0.3], 0.008, 0.004, 5), M.black);
	add(rod([0, -0.7, -0.4], [0, -1.0, -0.15], 0.012, 0.006, 5), M.black);

	// ======================= skrzydła =======================
	const foil = airfoil(28, 0.15, 0.04, 0.4);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.745), surface = profileSection(foil, 0.765, 1);
	const W = { chord: wingChord, leZ: wingLe, y: wingY, thick: wingThick };
	const wingParts = [airfoilPanel(full, -WING.root, WING.root, { ...W, caps: false })];
	const tips = [];
	const ailerons = [];
	for (const s of [-1, 1]) {
		wingParts.push(airfoilPanel(fixed, s * WING.root, s * 8.45, { ...W, steps: 14 }));
		wingParts.push(airfoilPanel(surface, s * 1.06, s * 4.55, { ...W, steps: 4 })); // klapa
		// końcówka zaokrąglona: cięciwa i grubość maleją na ostatnich centymetrach
		tips.push(airfoilPanel(full, s * 8.45, s * WING.tip, { ...W, steps: 5, chord: (x) => wingChord(x) * (1 - ((Math.abs(x) - 8.45) / 0.4) ** 3 * 0.35), thick: (x) => wingThick(x) * (1 - ((Math.abs(x) - 8.45) / 0.4) ** 2 * 0.6) }));
		// lotka na zawiasie
		const a = airfoilPanel(surface, s * 4.6, s * 8.42, { ...W, steps: 6 });
		const h0 = new Vector3(s * 4.6, wingY(4.6) + 0.012 * wingChord(4.6), wingLe(4.6) + 0.765 * wingChord(4.6));
		const h1 = new Vector3(s * 8.42, wingY(8.42) + 0.012 * wingChord(8.42), wingLe(8.42) + 0.765 * wingChord(8.42));
		ailerons.push(hinged(root, a, h0, h1, M.yellow, s < 0));
	}
	add(mergeGeometries(wingParts), M.wing);
	add(mergeGeometries(tips), M.white);
	const lamps = lampSet(root, add, ANCHORS);
	// rurka Pitota pod lewym skrzydłem
	add(mergeGeometries([rod([-6.2, wingY(6.2) - 0.08, -0.9], [-6.2, wingY(6.2) - 0.25, -1.3], 0.012), rod([-6.2, wingY(6.2) - 0.25, -1.3], [-6.2, wingY(6.2) - 0.25, -1.75], 0.01)]), M.chrome);

	// belka oprysku z dyszami pod krawędzią spływu i wiatraczek pompy pod kadłubem
	const boomZ = WING.le + WING.chord + 0.08;
	const boom = [rod([-7.9, -0.62, boomZ], [7.9, -0.62, boomZ], 0.032, 0.032, 8)];
	for (let x = -7.7; x <= 7.71; x += 0.36) {
		if (Math.abs(x) < 0.75) continue;
		boom.push(rod([x, -0.62, boomZ], [x, -0.7, boomZ + 0.02], 0.011, 0.009, 5));
	}
	for (const x of [-4.2, -1.6, 1.6, 4.2]) boom.push(rod([x, -0.62, boomZ], [x, wingY(x) - 0.05, boomZ - 0.25], 0.012, 0.012, 5));
	add(mergeGeometries(boom), M.metal);
	add(at(new CylinderGeometry(0.12, 0.14, 0.4, 14).rotateX(Math.PI / 2), 0, -0.86, -1.95), M.darkMetal);
	const pump = new Group();
	pump.position.set(0, -0.86, -2.17);
	root.add(pump);
	for (let i = 0; i < 2; i++) {
		const b = new Mesh(new BoxGeometry(0.42, 0.06, 0.012), M.black);
		b.rotation.z = (i * Math.PI) / 2;
		pump.add(b);
	}

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.11, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.6), tSurf = profileSection(tailFoil, 0.62, 1);
	const H = { chord: (x) => 1.38 - Math.abs(x) * 0.08, leZ: (x) => 3.95 + Math.abs(x) * 0.08, y: 0.3 };
	add(mergeGeometries([
		airfoilPanel(tFixed, -0.2, 0.2, { ...H, caps: false }),
		airfoilPanel(tFixed, -0.2, -3.2, { ...H, steps: 3 }),
		airfoilPanel(tFixed, 0.2, 3.2, { ...H, steps: 3 }),
	]), M.yellow);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.02, s * 3.2, { ...H, steps: 3 });
		const p0 = new Vector3(s * 0.02, 0.3, H.leZ(0.02) + 0.62 * H.chord(0.02)), p1 = new Vector3(s * 3.2, 0.3, H.leZ(3.2) + 0.62 * H.chord(3.2));
		elevators.push(hinged(root, g, p0, p1, M.yellow, s < 0));
	}
	// zastrzały statecznika
	add(mergeGeometries([-1, 1].map((s) => rod([s * 1.35, 0.27, 4.42], [s * 0.15, -0.02, 3.95], 0.022, 0.022, 6))), M.yellow);
	// statecznik pionowy (profil wyciągnięty wzdłuż „rozpiętości” = wysokości, potem obrócony)
	const F = { chord: (s) => 1.78 - s * 0.38, leZ: (s) => 3.52 + s * 0.42, y: 0 };
	const finFixed = airfoilPanel(tFixed, 0, 2.0, { ...F, steps: 3 });
	const finTop = airfoilPanel(tFull, 2.0, 2.08, { ...F, steps: 1 });
	for (const g of [finFixed, finTop]) { g.rotateZ(Math.PI / 2); g.translate(0, 0.55, 0); }
	add(mergeGeometries([finFixed, finTop]), M.yellow);
	const rud = airfoilPanel(tSurf, 0.06, 2.0, { ...F, steps: 3 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 0.55, 0);
	const rudder = hinged(root, rud, new Vector3(0, 0.55 + 0.06, F.leZ(0.06) + 0.62 * F.chord(0.06)), new Vector3(0, 2.55, F.leZ(2.0) + 0.62 * F.chord(2.0)), M.white);

	// ======================= podwozie =======================
	const gear = [];
	for (const s of [-1, 1]) {
		gear.push(rod([s * 1.35, wingY(1.35) - 0.05, -1.25], [s * 1.62, -1.12, -1.42], 0.07, 0.06, 10));
		gear.push(rod([s * 1.62, -1.12, -1.42], [s * 1.62, -1.33, -1.42], 0.05, 0.05, 10));
		gear.push(rod([s * 1.62, -1.33, -1.42], [s * 1.86, -1.33, -1.42], 0.03, 0.03, 8));
		gear.push(rod([s * 0.65, -0.62, -1.3], [s * 1.5, -1.0, -1.38], 0.03, 0.03, 8));
		add(at(tyre(0.42, 0.3, 0.26), s * 1.77, -1.33, -1.42), M.rubber);
		const hub = new CylinderGeometry(0.19, 0.19, 0.2, 20).deleteAttribute('uv');
		hub.rotateZ(Math.PI / 2);
		add(at(hub, s * 1.77, -1.33, -1.42), M.metal);
	}
	add(mergeGeometries(gear), M.darkMetal);
	// kółko ogonowe z widelcem
	add(mergeGeometries([rod([0, 0.18, 4.55], [0, -0.12, 4.75], 0.03), rod([0.05, -0.12, 4.75], [0.05, -0.28, 4.8], 0.012), rod([-0.05, -0.12, 4.75], [-0.05, -0.28, 4.8], 0.012)]), M.darkMetal);
	add(at(new CylinderGeometry(0.13, 0.13, 0.08, 16).rotateZ(Math.PI / 2), 0, -0.28, 4.8), M.rubber);

	// ======================= znaki rejestracyjne =======================
	const regMat = registrationMaterial(REGISTRATION, environment);
	sideRegistration(root, loft, regMat, { zc: 2.05, y: 0.1 });
	underwingRegistration(root, regMat, { pos: [-5.3, wingY(-5.3) - 0.074, wingLe(-5.3) + wingChord(-5.3) * 0.42], dihedral: WING.dihedral, w: 3.2, h: 0.95 });

	// ======================= śmigło =======================
	// trzy łopaty o skręconym profilu z żółtymi końcówkami, kołpak; przy obrotach – półprzezroczysta tarcza
	const propel = propeller(root, add, M, atmo, { pos: [0, 0.01, -4.62], radius: 1.5, blades: 3, spinner: [0.33, 0.48] });

	// ======================= pilot (widoczny z zewnątrz) =======================
	const pilot = pilotFigure(root, add, M, [0, 1.17, -0.38]);

	// ======================= kabina =======================
	const cockpit = createCockpit(M, atmo, { loft, spray: true });
	root.add(cockpit.group);

	root.userData = {
		prop: propel.prop, blades: propel.blades, disc: propel.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, pump, anchors: ANCHORS,
		/** Animacja: obroty śmigła (rpm), wychylenia sterów (−1..1), wiatraczek pompy (prędkość m/s). */
		animate(dt, rpm, controls, speed) {
			propel.spin(dt, rpm);
			pump.rotation.z += speed * 0.9 * dt;
			ailerons[0].deflect(controls.roll * 0.35);
			ailerons[1].deflect(-controls.roll * 0.35);
			for (const e of elevators) e.deflect(-controls.pitch * 0.4);
			rudder.deflect(controls.yaw * 0.3);
		},
	};
	return finish(root);
}

