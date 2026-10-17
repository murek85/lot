// PZL-104 Wilga 35 – polski górnopłat STOL (krótki start i lądowanie): duża przeszklona kabina z wypukłymi
// drzwiami (widok w dół), skrzydło bez zastrzałów ze stałymi slotami na krawędzi natarcia, klapy i lotki,
// silnik gwiazdowy AI-14 w okrągłej osłonie z dwułopatowym śmigłem, wysokie podwozie na wahaczach z dużymi
// oponami, smukły ogon. Malowanie aeroklubowe: biel z czerwonym pasem, osłoną silnika i końcówkami.
// Wymiary jak w oryginale: rozpiętość 11,12 m, długość 8,1 m. Oś x – w prawo, y – w górę, z – do tyłu.
import { Group, CylinderGeometry, SphereGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import { vec3, float, max, mix, smoothstep } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, underwingRegistration, finish } from './parts.js';

const DEG = Math.PI / 180;
export const REGISTRATION = 'SP-WGA';

const WING = { tip: 5.56, chord: 1.4, le: -1.05, y: 1.5, dihedral: 1 * DEG };
const wingY = (x) => WING.y + Math.abs(x) * Math.tan(WING.dihedral);

const FUSELAGE = [
	{ z: -2.62, w: 0.47, top: 0.47, bot: -0.45, belt: 0.02, n: 2 },
	{ z: -2.56, w: 0.52, top: 0.52, bot: -0.5, belt: 0.02, n: 2 },
	{ z: -2.3, w: 0.55, top: 0.56, bot: -0.53, belt: 0, n: 2.05 },
	{ z: -1.95, w: 0.56, top: 0.6, bot: -0.55, belt: -0.02, n: 2.3 },
	{ z: -1.85, w: 0.57, top: 0.63, bot: -0.56, belt: -0.03, n: 2.6 },
	{ z: -1.6, w: 0.59, top: 0.74, bot: -0.57, belt: -0.05, n: 3.0 },
	{ z: -1.05, w: 0.62, top: 1.38, bot: -0.58, belt: -0.05, n: 3.4 },
	{ z: -0.5, w: 0.63, top: 1.44, bot: -0.58, belt: -0.05, n: 3.6 },
	{ z: 0.5, w: 0.62, top: 1.44, bot: -0.57, belt: -0.05, n: 3.6 },
	{ z: 1.0, w: 0.55, top: 1.32, bot: -0.5, belt: 0, n: 3.2 },
	{ z: 1.55, w: 0.36, top: 1.0, bot: -0.28, belt: 0.2, n: 2.6 },
	{ z: 2.4, w: 0.24, top: 0.78, bot: -0.02, belt: 0.3, n: 2.3 },
	{ z: 3.4, w: 0.17, top: 0.66, bot: 0.1, belt: 0.34, n: 2.1 },
	{ z: 4.5, w: 0.11, top: 0.58, bot: 0.22, belt: 0.38, n: 2 },
	{ z: 5.12, w: 0.04, top: 0.52, bot: 0.3, belt: 0.4, n: 2 },
];
// kabina: okna aż do wysokości kolan (wypukłe drzwi), z przodu parapet podnosi się do osłony silnika
const CABIN = { front: -1.58, roofFront: -1.05, back: 1.0, roofX: 0.45 };
const sillY = (z) => (z < -1.2 ? 0.2 + Math.min(1, (-1.2 - z) / 0.38) * 0.5 : 0.2);

export const ANCHORS = {
	navL: [-WING.tip - 0.04, wingY(WING.tip) + 0.05, WING.le + 0.25],
	navR: [WING.tip + 0.04, wingY(WING.tip) + 0.05, WING.le + 0.25],
	strobeL: [-WING.tip - 0.04, wingY(WING.tip) + 0.05, WING.le + 0.75],
	strobeR: [WING.tip + 0.04, wingY(WING.tip) + 0.05, WING.le + 0.75],
	tail: [0, 0.7, 5.22],
	beacon: [0, 2.16, 4.9],
	landingL: [-2.2, wingY(2.2), WING.le - 0.012],
	landingR: [2.2, wingY(2.2), WING.le - 0.012],
	exhaustL: [-0.36, -0.52, -1.92],
	exhaustR: [0.36, -0.52, -1.92],
	eye: [-0.3, 1.0, -0.4],
	cabinLight: [0, 1.25, -0.7],
};

const livery = {
	base: 0xf3f2ed,
	trim: 0xc8102e,
	trim2: 0xc8102e,
	// czerwony pas wzdłuż kadłuba, czerwona osłona silnika, linie blach
	fuselageDetail: (p, { seam, down }) => {
		const stripe = smoothstep(-0.16, -0.14, p.y.sub(p.z.max(1.0).sub(1.0).mul(0.16))).mul(down(0.04, 0.02, p.y.sub(p.z.max(1.0).sub(1.0).mul(0.16)))).mul(smoothstep(-1.9, -1.85, p.z));
		const cowl = down(-1.84, -1.88, p.z);
		let lines = float(0);
		for (const z of [-1.86, -2.3, 1.0, 2.4, 3.4]) lines = max(lines, seam(p.z.sub(z)));
		const red = max(stripe, cowl);
		return { tint: mix(vec3(1).mul(float(1).sub(lines.mul(0.4))), vec3(0.82, 0.06, 0.09), red), rough: float(0) };
	},
	wingDetail: (p, { seam }) => {
		const ax = p.x.abs();
		let lines = seam(p.z.sub(-0.75));
		for (let k = 0; k < 5; k++) lines = max(lines, seam(ax.sub(0.6 + k * 1.05)));
		return { tint: vec3(1).mul(float(1).sub(lines.mul(0.35))), rough: float(0) };
	},
};

export function createWilga(atmo) {
	const root = new Group();
	root.name = 'wilga';
	const { M, environment } = makeMaterials(atmo, livery);
	const { add, at } = adder(root);

	// ======================= kadłub i kabina =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -1.8 ? 0.06 : z < 1.1 ? 0.05 : 0.14),
		pillars: [-0.25, 0.45], innerY: 0.6, centerBar: true,
	});
	add(at(new SphereGeometry(0.05, 10, 8), 0, 0.41, 5.12), M.fuselage);

	// ======================= silnik =======================
	add(at(new TorusGeometry(0.44, 0.035, 8, 40), 0, 0.02, -2.62), M.metal);
	add(at(new CylinderGeometry(0.42, 0.42, 0.04, 28).rotateX(Math.PI / 2), 0, 0.02, -2.3), M.black);
	const cyl = [];
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2, d = [Math.sin(a), Math.cos(a)];
		cyl.push(rod([d[0] * 0.14, 0.02 + d[1] * 0.14, -2.45], [d[0] * 0.38, 0.02 + d[1] * 0.38, -2.45], 0.06, 0.05, 10));
		for (let k = 0; k < 5; k++) { const r0 = 0.2 + k * 0.035; cyl.push(rod([d[0] * r0, 0.02 + d[1] * r0, -2.45], [d[0] * (r0 + 0.01), 0.02 + d[1] * (r0 + 0.01), -2.45], 0.08, 0.08, 10)); }
	}
	add(mergeGeometries(cyl), M.darkMetal);
	add(rod([0.3, -0.42, -2.2], [0.36, -0.55, -1.9], 0.045, 0.05, 10, true), M.exhaust);
	add(rod([-0.3, -0.42, -2.2], [-0.36, -0.55, -1.9], 0.045, 0.05, 10, true), M.exhaust);
	const prop = propeller(root, add, M, atmo, { pos: [0, 0.02, -2.74], radius: 1.33, blades: 2, spinner: [0.17, 0.3], rootChord: 0.2, bladeMat: M.black, tipMat: M.trim2, tipColor: [0.5, 0.05, 0.05] });

	// ======================= skrzydło =======================
	const foil = airfoil(28, 0.15, 0.02, 0.4);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.72), surface = profileSection(foil, 0.74, 1);
	const W = { chord: WING.chord, leZ: WING.le, y: wingY };
	const parts = [airfoilPanel(full, -0.5, 0.5, { ...W, caps: false })];
	const tips = [], slats = [], ailerons = [];
	// sloty: wąski profil przed krawędzią natarcia i trochę pod nią
	const slatFoil = profileSection(airfoil(12, 0.09, 0.06, 0.5), 0, 1);
	for (const s of [-1, 1]) {
		parts.push(airfoilPanel(fixed, s * 0.5, s * 5.32, { ...W, steps: 6 }));
		parts.push(airfoilPanel(surface, s * 0.5, s * 3.0, { ...W, steps: 3 })); // klapa
		tips.push(airfoilPanel(full, s * 5.32, s * WING.tip, { ...W, steps: 4, chord: (x) => WING.chord * (1 - ((Math.abs(x) - 5.32) / 0.24) ** 3 * 0.3), thick: (x) => 1 - ((Math.abs(x) - 5.32) / 0.24) ** 2 * 0.55 }));
		slats.push(airfoilPanel(slatFoil, s * 0.9, s * 5.3, { chord: 0.24, leZ: WING.le - 0.07, y: (x) => wingY(x) - 0.035, steps: 4 }));
		const a = airfoilPanel(surface, s * 3.04, s * 5.3, { ...W, steps: 3 });
		const y0 = wingY(3.04) + 0.012 * WING.chord, y1 = wingY(5.3) + 0.012 * WING.chord, z = WING.le + 0.74 * WING.chord;
		ailerons.push(hinged(root, a, new Vector3(s * 3.04, y0, z), new Vector3(s * 5.3, y1, z), M.wing, s < 0));
	}
	add(mergeGeometries(parts), M.wing);
	add(mergeGeometries(tips), M.white);
	add(mergeGeometries(slats), M.wing);
	// wsporniki slotów
	add(mergeGeometries([-1, 1].flatMap((s) => [1.2, 2.6, 4.0, 5.1].map((x) => rod([s * x, wingY(x) - 0.03, WING.le - 0.05], [s * x, wingY(x) - 0.01, WING.le + 0.06], 0.012)))), M.darkMetal);
	const lamps = lampSet(root, add, ANCHORS);

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.1, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.58), tSurf = profileSection(tailFoil, 0.6, 1);
	const H = { chord: (x) => 0.95 - Math.abs(x) * 0.08, leZ: (x) => 4.3 + Math.abs(x) * 0.06, y: 0.55 };
	add(mergeGeometries([airfoilPanel(tFixed, -0.15, 0.15, { ...H, caps: false }), airfoilPanel(tFixed, -0.15, -1.85, { ...H, steps: 2 }), airfoilPanel(tFixed, 0.15, 1.85, { ...H, steps: 2 })]), M.fuselage);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.02, s * 1.85, { ...H, steps: 2 });
		elevators.push(hinged(root, g, new Vector3(s * 0.02, 0.55, H.leZ(0.02) + 0.6 * H.chord(0.02)), new Vector3(s * 1.85, 0.55, H.leZ(1.85) + 0.6 * H.chord(1.85)), M.fuselage, s < 0));
	}
	const F = { chord: (s) => 1.3 - s * 0.36, leZ: (s) => 3.85 + s * 0.45, y: 0 };
	const fin = airfoilPanel(tFixed, 0, 1.55, { ...F, steps: 3 });
	const finTop = airfoilPanel(tFull, 1.55, 1.6, { ...F, steps: 1 });
	for (const g of [fin, finTop]) { g.rotateZ(Math.PI / 2); g.translate(0, 0.52, 0); }
	add(mergeGeometries([fin, finTop]), M.trim2);
	const rud = airfoilPanel(tSurf, 0.04, 1.55, { ...F, steps: 3 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 0.52, 0);
	const rudder = hinged(root, rud, new Vector3(0, 0.56, F.leZ(0.04) + 0.6 * F.chord(0.04)), new Vector3(0, 2.07, F.leZ(1.55) + 0.6 * F.chord(1.55)), M.white);

	// ======================= podwozie: wysokie goleni z wahaczami, duże opony =======================
	const gear = [];
	for (const s of [-1, 1]) {
		const axle = [s * 1.06, -1.36, -1.6];
		gear.push(rod([s * 0.45, -0.52, -1.3], [s * 0.86, -1.08, -1.38], 0.045, 0.04, 10)); // goleń
		gear.push(rod([s * 0.86, -1.08, -1.38], [s * 0.97, -1.36, -1.6], 0.04, 0.04, 10)); // wahacz
		gear.push(rod([s * 0.45, -0.3, -1.05], [s * 0.84, -1.05, -1.33], 0.03, 0.025, 8)); // amortyzator
		gear.push(rod([s * 0.95, -1.36, -1.6], [s * 1.18, -1.36, -1.6], 0.025, 0.025, 8));
		add(at(tyre(0.3, 0.18, 0.21), ...axle), M.rubber);
		add(at(new CylinderGeometry(0.12, 0.12, 0.17, 16).deleteAttribute('uv').rotateZ(Math.PI / 2), ...axle), M.metal);
	}
	gear.push(rod([0, 0.26, 4.78], [0, -0.04, 4.98], 0.022), rod([0.04, -0.04, 4.98], [0.04, -0.14, 5.0], 0.01), rod([-0.04, -0.04, 4.98], [-0.04, -0.14, 5.0], 0.01));
	add(mergeGeometries(gear), M.darkMetal);
	add(at(new CylinderGeometry(0.1, 0.1, 0.06, 14).rotateZ(Math.PI / 2), 0, -0.14, 5.0), M.rubber);
	// rurka Pitota pod lewym skrzydłem i antena na grzbiecie
	add(mergeGeometries([rod([-4.2, wingY(4.2) - 0.06, -0.8], [-4.2, wingY(4.2) - 0.2, -1.1], 0.01), rod([-4.2, wingY(4.2) - 0.2, -1.1], [-4.2, wingY(4.2) - 0.2, -1.45], 0.009)]), M.chrome);
	add(rod([0, 1.1, 1.3], [0, 1.55, 1.75], 0.008, 0.004, 5), M.black);

	// ======================= znaki, pilot, kabina =======================
	const regMat = registrationMaterial(REGISTRATION, environment, '#9c0b22');
	sideRegistration(root, loft, regMat, { zc: 2.5, y: 0.52, len: 1.1, h: 0.2 });
	underwingRegistration(root, regMat, { pos: [-3.3, wingY(3.3) - 0.04, WING.le + WING.chord * 0.42], dihedral: WING.dihedral, w: 2.3, h: 0.7 });
	const pilot = pilotFigure(root, add, M, [-0.3, 0.97, -0.36]);
	const cockpit = createCockpit(M, atmo, { loft, origin: [0, -0.2, 0.02], pilotX: -0.3, panelScale: 0.9, sill: 0.2, bulkheadZ: 0.95, cage: false, secondSeat: true, panelX: -0.12 });
	root.add(cockpit.group);

	root.userData = {
		prop: prop.prop, blades: prop.blades, disc: prop.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, anchors: ANCHORS,
		animate(dt, rpm, controls) {
			prop.spin(dt, rpm);
			ailerons[0].deflect(controls.roll * 0.4);
			ailerons[1].deflect(-controls.roll * 0.4);
			for (const e of elevators) e.deflect(-controls.pitch * 0.45);
			rudder.deflect(controls.yaw * 0.35);
		},
	};
	return finish(root);
}
