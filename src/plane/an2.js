// PZL Mielec An-2 „Antek” – wielki dwupłat z Mielca: wysoki, kanciasty kadłub z przeszkloną kabiną pilotów i
// okrągłymi oknami kabiny pasażerskiej, górne skrzydło na grzbiecie (sloty i lotki), dolne przy podłodze, połączone
// słupkami w kształcie „I” i stalowymi cięgnami; silnik gwiazdowy ASz-62IR w okrągłej osłonie z żaluzjami,
// czterołopatowe śmigło, wysokie podwozie z amortyzatorami, duże usterzenie z zastrzałami stateczników.
// Malowanie aeroklubowe: biel, czerwona osłona silnika, pas pod oknami i statecznik pionowy.
// Rozpiętość 18,18 m (dolne skrzydło 14,24 m), długość 12,4 m. Oś x – w prawo, y – w górę, z – do tyłu.
import { Group, CylinderGeometry, SphereGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import { vec2, vec3, float, max, mix, smoothstep, fract, floor, length } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, underwingRegistration, finish } from './parts.js';

const DEG = Math.PI / 180;
export const REGISTRATION = 'SP-ANT';

// górne skrzydło: na grzbiecie nad kabiną, wysunięte przed dolne (przesunięcie skrzydeł)
const UP = { tip: 9.09, chord: 2.45, le: -1.75, y: 1.84, dihedral: 2.5 * DEG };
const LO = { root: 0.7, tip: 7.12, chord: 2.0, le: -1.05, y: -0.58, dihedral: 3.5 * DEG };
const upY = (x) => UP.y + Math.abs(x) * Math.tan(UP.dihedral);
const loY = (x) => LO.y + Math.max(0, Math.abs(x) - LO.root) * Math.tan(LO.dihedral);
const STRUT = 5.1; // słupki międzyskrzydłowe

const FUSELAGE = [
	{ z: -3.5, w: 0.68, top: 0.74, bot: -0.62, belt: 0.06, n: 2 },
	{ z: -3.42, w: 0.74, top: 0.8, bot: -0.68, belt: 0.06, n: 2 },
	{ z: -2.9, w: 0.77, top: 0.83, bot: -0.72, belt: 0.06, n: 2.1 },
	{ z: -2.45, w: 0.79, top: 0.86, bot: -0.75, belt: 0.04, n: 2.5 },
	{ z: -2.1, w: 0.81, top: 1.05, bot: -0.78, belt: 0.02, n: 3.0 },
	{ z: -1.6, w: 0.84, top: 1.52, bot: -0.8, belt: 0, n: 3.4 },
	{ z: -0.9, w: 0.85, top: 1.62, bot: -0.8, belt: 0, n: 3.6 },
	{ z: 0.2, w: 0.85, top: 1.58, bot: -0.8, belt: 0, n: 3.6 },
	{ z: 3.0, w: 0.8, top: 1.48, bot: -0.62, belt: 0.1, n: 3.4 },
	{ z: 5.0, w: 0.6, top: 1.32, bot: -0.12, belt: 0.5, n: 3.0 },
	{ z: 7.0, w: 0.34, top: 1.16, bot: 0.4, belt: 0.8, n: 2.6 },
	{ z: 8.55, w: 0.12, top: 1.06, bot: 0.74, belt: 0.9, n: 2.2 },
	{ z: 8.9, w: 0.04, top: 1.0, bot: 0.86, belt: 0.93, n: 2 },
];
// kabina pilotów: szyby od parapetu (0,45 m) w górę, z przodu parapet podnosi się do osłony silnika
const CABIN = { front: -2.05, roofFront: -1.6, back: -0.8, roofX: 0.52 };
const sillY = (z) => (z < -1.75 ? 0.45 + Math.min(1, (-1.75 - z) / 0.3) * 0.3 : 0.45);

export const ANCHORS = {
	navL: [-UP.tip - 0.04, upY(UP.tip) + 0.05, UP.le + 0.35],
	navR: [UP.tip + 0.04, upY(UP.tip) + 0.05, UP.le + 0.35],
	strobeL: [-UP.tip - 0.04, upY(UP.tip) + 0.05, UP.le + 1.2],
	strobeR: [UP.tip + 0.04, upY(UP.tip) + 0.05, UP.le + 1.2],
	tail: [0, 0.95, 8.95],
	beacon: [0, 1.66, 2.6],
	landingL: [-3.0, loY(3.0), LO.le - 0.012],
	landingR: [3.0, loY(3.0), LO.le - 0.012],
	exhaustL: [-0.5, -0.82, -2.35],
	exhaustR: [0.5, -0.82, -2.35],
	eye: [-0.38, 1.1, -1.2],
	cabinLight: [0, 1.35, -1.3],
};

const RED = vec3(0.78, 0.05, 0.08);
const livery = {
	base: 0xf1f0ea,
	trim: 0xc8102e,
	trim2: 0xc8102e,
	// czerwona osłona silnika, pas pod oknami, okrągłe okna kabiny pasażerskiej, linie blach
	fuselageDetail: (p, { seam, down }) => {
		const ax = p.x.abs();
		const line = p.y.sub(p.z.max(0).mul(0.05));
		const stripe = smoothstep(0.2, 0.22, line).mul(down(0.36, 0.34, line)).mul(smoothstep(-2.4, -2.35, p.z)).mul(down(8.2, 8.0, p.z));
		const cowl = down(-2.4, -2.44, p.z);
		// okna: cztery co 0,75 m od z = 0,2 (za nimi drzwi), środek 0,78 m nad osią kadłuba
		const cz = p.z.sub(0.2).div(0.75);
		const cell = fract(cz).sub(0.5).mul(0.75);
		const inRow = smoothstep(-0.6, -0.4, floor(cz)).mul(down(3.6, 3.4, floor(cz)));
		const r = length(vec2(cell, p.y.sub(0.78)));
		const win = down(0.17, 0.15, r).mul(inRow).mul(smoothstep(0.55, 0.6, ax));
		const rim = down(0.19, 0.17, r).mul(smoothstep(0.15, 0.17, r)).mul(inRow).mul(smoothstep(0.55, 0.6, ax));
		let lines = float(0);
		for (const z of [-2.42, -2.1, 0.2, 1.6, 3.0, 5.0, 7.0]) lines = max(lines, seam(p.z.sub(z)));
		const base = vec3(1).mul(float(1).sub(lines.mul(0.4)));
		const paint = mix(base, RED, max(stripe, cowl));
		return { tint: mix(mix(paint, vec3(0.55), rim), vec3(0.02, 0.025, 0.03), win), rough: win.mul(-0.3) };
	},
	// płócienne pokrycie skrzydeł: żebra co ~0,3 m, dźwigar
	wingDetail: (p, { seam }) => {
		const ax = p.x.abs();
		const rib = fract(ax.div(0.32)).sub(0.5).abs();
		const ribs = smoothstep(0.42, 0.5, rib).mul(0.18);
		return { tint: vec3(1).mul(float(1).sub(max(ribs, seam(ax.sub(0.62)).mul(0.4)))), rough: float(0) };
	},
};

export function createAn2(atmo) {
	const root = new Group();
	root.name = 'an2';
	const { M, environment, paint } = makeMaterials(atmo, livery);
	const { add, at } = adder(root);
	const yellow = paint(0xf2c200);

	// ======================= kadłub i kabina =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -2.0 ? 0.08 : z < -0.6 ? 0.06 : 0.2),
		pillars: [-1.75, -1.25], innerY: 0.9, centerBar: true, frameR: 0.024,
	});
	add(at(new SphereGeometry(0.06, 10, 8), 0, 0.93, 8.9), M.fuselage);
	// drzwi kabiny pasażerskiej (lewa burta) – ramka z rury przy poszyciu
	{
		const st0 = loft.stationAt(3.2), st1 = loft.stationAt(4.15);
		const px = (st, y) => -loft.point(st, loft.thetaForY(st, y))[0] - 0.006;
		const pts = [[px(st0, -0.3), -0.3, 3.2], [px(st0, 1.15), 1.15, 3.2], [px(st1, 1.1), 1.1, 4.15], [px(st1, -0.15), -0.15, 4.15], [px(st0, -0.3), -0.3, 3.2]];
		const door = [];
		for (let i = 1; i < pts.length; i++) door.push(rod(pts[i - 1], pts[i], 0.012, 0.012, 5));
		add(mergeGeometries(door), M.darkMetal);
	}

	// ======================= silnik: osłona z żaluzjami =======================
	add(at(new TorusGeometry(0.71, 0.05, 8, 44), 0, 0.06, -3.5), M.trim2);
	add(at(new CylinderGeometry(0.69, 0.69, 0.04, 32).rotateX(Math.PI / 2), 0, 0.06, -3.44), M.black);
	const louvres = [];
	for (let i = 0; i < 18; i++) {
		const a = (i / 18) * Math.PI * 2, d = [Math.sin(a), Math.cos(a)];
		louvres.push(rod([d[0] * 0.24, 0.06 + d[1] * 0.24, -3.47], [d[0] * 0.66, 0.06 + d[1] * 0.66, -3.47], 0.035, 0.035, 4));
	}
	add(mergeGeometries(louvres), M.metal);
	add(at(new CylinderGeometry(0.24, 0.24, 0.1, 20).rotateX(Math.PI / 2), 0, 0.06, -3.5), M.darkMetal);
	// wlot gaźnika na grzbiecie osłony, rura wydechowa pod prawą burtą
	add(rod([0, 0.78, -2.95], [0, 0.8, -2.5], 0.09, 0.1, 12), M.fuselage);
	add(at(new SphereGeometry(0.09, 12, 8).scale(1, 1, 0.3), 0, 0.78, -2.95), M.black);
	add(rod([0.42, -0.62, -2.9], [0.52, -0.84, -2.2], 0.07, 0.075, 10, true), M.exhaust);
	add(rod([-0.42, -0.62, -2.9], [-0.5, -0.82, -2.35], 0.05, 0.055, 10, true), M.exhaust);
	const prop = propeller(root, add, M, atmo, { pos: [0, 0.06, -3.68], radius: 1.75, blades: 4, spinner: [0.26, 0.32], rootChord: 0.32, bladeMat: M.darkMetal, tipMat: yellow, tipColor: [0.5, 0.4, 0.02], spinnerMat: M.metal });

	// ======================= skrzydła =======================
	const foil = airfoil(28, 0.14, 0.03, 0.35);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.72), surface = profileSection(foil, 0.74, 1);
	const U = { chord: UP.chord, leZ: UP.le, y: upY };
	const L = { chord: LO.chord, leZ: LO.le, y: loY };
	const tipChord = (c, x0, len) => (x) => c * (1 - ((Math.abs(x) - x0) / len) ** 3 * 0.35);
	const tipThick = (x0, len) => (x) => 1 - ((Math.abs(x) - x0) / len) ** 2 * 0.55;
	const parts = [airfoilPanel(full, -0.62, 0.62, { ...U, caps: false })];
	const tips = [], slats = [], ailerons = [];
	const slatFoil = profileSection(airfoil(12, 0.09, 0.06, 0.5), 0, 1);
	for (const s of [-1, 1]) {
		// górne: klapa wewnątrz, lotka na zewnątrz, sloty przed krawędzią natarcia
		parts.push(airfoilPanel(fixed, s * 0.62, s * 8.85, { ...U, steps: 8 }));
		parts.push(airfoilPanel(surface, s * 0.62, s * 4.9, { ...U, steps: 4 }));
		tips.push(airfoilPanel(full, s * 8.85, s * UP.tip, { ...U, steps: 4, chord: tipChord(UP.chord, 8.85, 0.24), thick: tipThick(8.85, 0.24) }));
		slats.push(airfoilPanel(slatFoil, s * 4.95, s * 8.8, { chord: 0.36, leZ: UP.le - 0.1, y: (x) => upY(x) - 0.05, steps: 4 }));
		const a = airfoilPanel(surface, s * 4.95, s * 8.8, { ...U, steps: 4 });
		const h = (x) => new Vector3(s * x, upY(x) + 0.012 * UP.chord, UP.le + 0.74 * UP.chord);
		ailerons.push(hinged(root, a, h(4.95), h(8.8), M.wing, s < 0));
		// dolne: od burty, klapy na całej rozpiętości (nieruchome)
		parts.push(airfoilPanel(fixed, s * LO.root, s * 6.9, { ...L, steps: 6 }));
		parts.push(airfoilPanel(surface, s * LO.root, s * 6.9, { ...L, steps: 6 }));
		tips.push(airfoilPanel(full, s * 6.9, s * LO.tip, { ...L, steps: 4, chord: tipChord(LO.chord, 6.9, 0.22), thick: tipThick(6.9, 0.22) }));
	}
	add(mergeGeometries(parts), M.wing);
	add(mergeGeometries(tips), M.white);
	add(mergeGeometries(slats), M.wing);
	const lamps = lampSet(root, add, ANCHORS);

	// słupki „I”, cięgna (krzyżowe w obu płaszczyznach), wsporniki górnego płata nad kabiną
	const struts = [], wires = [];
	for (const s of [-1, 1]) {
		const x = s * STRUT;
		const lf = [x, loY(STRUT) + 0.06, LO.le + 0.45], lr = [x, loY(STRUT) + 0.04, LO.le + 1.45];
		const uf = [x, upY(STRUT) - 0.04, UP.le + 0.55], ur = [x, upY(STRUT) - 0.05, UP.le + 1.75];
		struts.push(rod(lf, uf, 0.055, 0.05, 10), rod(lr, ur, 0.055, 0.05, 10));
		struts.push(rod([x, (lf[1] + uf[1]) / 2, (lf[2] + uf[2]) / 2], [x, (lr[1] + ur[1]) / 2, (lr[2] + ur[2]) / 2], 0.03, 0.03, 6));
		for (const dz of [0.6, 1.5]) {
			wires.push(rod([s * 0.95, loY(0.95) + 0.05, LO.le + dz], [x, upY(STRUT) - 0.05, UP.le + dz + 0.1], 0.008, 0.008, 4)); // nośne
			wires.push(rod([s * 0.7, upY(0.7) - 0.06, UP.le + dz + 0.1], [x, loY(STRUT) + 0.05, LO.le + dz], 0.008, 0.008, 4)); // lądowania
		}
		struts.push(rod([s * 0.45, 1.55, -1.45], [s * 0.6, upY(0.6) - 0.08, UP.le + 0.5], 0.035), rod([s * 0.45, 1.5, -0.2], [s * 0.6, upY(0.6) - 0.08, UP.le + 1.8], 0.035));
	}
	add(mergeGeometries(struts), M.fuselage);
	add(mergeGeometries(wires), M.chrome);

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.1, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.58), tSurf = profileSection(tailFoil, 0.6, 1);
	const HY = 0.98;
	const H = { chord: (x) => 1.75 - Math.abs(x) * 0.12, leZ: (x) => 6.85 + Math.abs(x) * 0.12, y: HY };
	add(mergeGeometries([airfoilPanel(tFixed, -0.3, 0.3, { ...H, caps: false }), airfoilPanel(tFixed, -0.3, -3.6, { ...H, steps: 3 }), airfoilPanel(tFixed, 0.3, 3.6, { ...H, steps: 3 })]), M.fuselage);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.04, s * 3.6, { ...H, steps: 3 });
		elevators.push(hinged(root, g, new Vector3(s * 0.04, HY, H.leZ(0.04) + 0.6 * H.chord(0.04)), new Vector3(s * 3.6, HY, H.leZ(3.6) + 0.6 * H.chord(3.6)), M.fuselage, s < 0));
	}
	// zastrzały statecznika poziomego
	add(mergeGeometries([-1, 1].map((s) => rod([s * 0.28, 0.5, 7.25], [s * 1.6, HY - 0.06, H.leZ(1.6) + 0.5], 0.03, 0.025, 6))), M.darkMetal);
	const F = { chord: (s) => 2.45 - s * 0.47, leZ: (s) => 6.35 + s * 0.52, y: 0 };
	const fin = airfoilPanel(tFixed, 0, 2.2, { ...F, steps: 4 });
	const finTop = airfoilPanel(tFull, 2.2, 2.32, { ...F, steps: 2, thick: (s) => 1 - ((s - 2.2) / 0.12) * 0.5 });
	for (const g of [fin, finTop]) { g.rotateZ(Math.PI / 2); g.translate(0, 1.0, 0); }
	add(mergeGeometries([fin, finTop]), M.trim2);
	const rud = airfoilPanel(tSurf, 0.06, 2.2, { ...F, steps: 4 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 1.0, 0);
	const rudder = hinged(root, rud, new Vector3(0, 1.06, F.leZ(0.06) + 0.6 * F.chord(0.06)), new Vector3(0, 3.2, F.leZ(2.2) + 0.6 * F.chord(2.2)), M.trim2);

	// ======================= podwozie: amortyzatory z dolnego skrzydła, duże opony =======================
	const gear = [];
	for (const s of [-1, 1]) {
		const axle = [s * 1.75, -1.42, -0.55];
		gear.push(rod([s * 1.72, loY(1.72) - 0.05, -0.52], [s * 1.72, -1.05, -0.55], 0.075, 0.075, 12)); // amortyzator
		gear.push(rod([s * 1.72, -1.05, -0.55], [s * 1.72, -1.42, -0.55], 0.05, 0.05, 10)); // tłoczysko
		gear.push(rod([s * 0.5, -0.76, -1.0], [s * 1.68, -1.36, -0.58], 0.04, 0.035, 8)); // wahacz
		gear.push(rod([s * 0.5, -0.76, -0.05], [s * 1.68, -1.36, -0.52], 0.04, 0.035, 8));
		gear.push(rod([s * 1.55, -1.42, -0.55], [s * 1.98, -1.42, -0.55], 0.03, 0.03, 8)); // oś
		add(at(tyre(0.43, 0.24, 0.3), ...axle), M.rubber);
		add(at(new CylinderGeometry(0.2, 0.2, 0.24, 18).deleteAttribute('uv').rotateZ(Math.PI / 2), ...axle), M.metal);
	}
	gear.push(rod([0, 0.6, 7.95], [0, 0.12, 8.2], 0.04), rod([0.06, 0.12, 8.2], [0.06, 0.0, 8.25], 0.015), rod([-0.06, 0.12, 8.2], [-0.06, 0.0, 8.25], 0.015));
	add(mergeGeometries(gear), M.darkMetal);
	add(at(tyre(0.19, 0.08, 0.1), 0, 0.0, 8.25), M.rubber);
	// rurka Pitota na lewym słupku, antena nad kabiną
	add(rod([-STRUT, 1.2, UP.le + 0.45], [-STRUT, 1.2, UP.le - 0.2], 0.012), M.chrome);
	add(rod([0, 1.6, 0.5], [0, 2.05, 1.6], 0.01, 0.005, 5), M.black);

	// ======================= znaki, pilot, kabina =======================
	const regMat = registrationMaterial(REGISTRATION, environment, '#111');
	sideRegistration(root, loft, regMat, { zc: 5.6, y: 0.68, len: 1.7, h: 0.34 });
	underwingRegistration(root, regMat, { pos: [-4.0, loY(4.0) + foil.at(0.45)[1] * LO.chord - 0.004, LO.le + LO.chord * 0.45], dihedral: LO.dihedral, w: 2.8, h: 0.85 });
	const pilot = pilotFigure(root, add, M, [-0.38, 1.08, -1.15]);
	const cockpit = createCockpit(M, atmo, { loft, origin: [0, -0.2, -0.78], pilotX: -0.38, width: 1.25, panelScale: 0.9, sill: 0.45, bulkheadZ: 0.25, cage: false, secondSeat: true, panelX: -0.15 });
	root.add(cockpit.group);

	root.userData = {
		prop: prop.prop, blades: prop.blades, disc: prop.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, anchors: ANCHORS,
		animate(dt, rpm, controls) {
			prop.spin(dt, rpm);
			ailerons[0].deflect(controls.roll * 0.35);
			ailerons[1].deflect(-controls.roll * 0.35);
			for (const e of elevators) e.deflect(-controls.pitch * 0.4);
			rudder.deflect(controls.yaw * 0.35);
		},
	};
	return finish(root);
}
