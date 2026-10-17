// Extra 330LX – samolot akrobacyjny: smukły kadłub z kroplową owiewką (bez ram dachu), dolnopłat o profilu
// symetrycznym, zbieżny, z lotkami na prawie całej rozpiętości, duże usterzenie, silnik bokser w spłaszczonej
// osłonie z trójłopatowym śmigłem, sprężynowe goleni ze stalowego pręta i owiewki kół. Malowanie: biel z
// czerwono-granatowym pasem i promieniami słońca na skrzydłach. Rozpiętość 7,5 m, długość 7,0 m.
import { Group, CylinderGeometry, SphereGeometry, CircleGeometry, Vector3 } from 'three/webgpu';
import { vec3, float, max, min, mix, smoothstep, atan, fract, step } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, underwingRegistration, finish } from './parts.js';

export const REGISTRATION = 'SP-AKR';

const WING = { tip: 3.75, root: 1.95, tipChord: 1.05, le: -1.0, y: -0.12 };
const wingChord = (x) => WING.root - (Math.abs(x) / WING.tip) * (WING.root - WING.tipChord);
const wingLe = (x) => WING.le + Math.abs(x) * 0.12;

const FUSELAGE = [
	{ z: -2.5, w: 0.34, top: 0.34, bot: -0.3, belt: 0.02, n: 2.2 },
	{ z: -2.42, w: 0.4, top: 0.4, bot: -0.36, belt: 0.02, n: 2.4 },
	{ z: -2.0, w: 0.47, top: 0.44, bot: -0.43, belt: 0, n: 2.8 },
	{ z: -1.4, w: 0.5, top: 0.47, bot: -0.46, belt: 0, n: 3.0 },
	{ z: -1.0, w: 0.5, top: 0.5, bot: -0.45, belt: 0, n: 3.0 },
	{ z: -0.6, w: 0.49, top: 0.92, bot: -0.44, belt: 0, n: 2.5 },
	{ z: -0.1, w: 0.48, top: 1.06, bot: -0.42, belt: 0, n: 2.4 },
	{ z: 0.6, w: 0.45, top: 1.04, bot: -0.38, belt: 0.02, n: 2.4 },
	{ z: 1.25, w: 0.37, top: 0.8, bot: -0.3, belt: 0.05, n: 2.3 },
	{ z: 2.0, w: 0.28, top: 0.62, bot: -0.2, belt: 0.1, n: 2.2 },
	{ z: 3.2, w: 0.18, top: 0.5, bot: -0.06, belt: 0.16, n: 2.1 },
	{ z: 4.2, w: 0.12, top: 0.43, bot: 0.05, belt: 0.2, n: 2 },
	{ z: 4.6, w: 0.05, top: 0.38, bot: 0.14, belt: 0.24, n: 2 },
];
// owiewka kroplowa: szkło od szyny (0,46 m) w górę, bez dachu
const CABIN = { front: -0.98, roofFront: 1.2, back: 1.2, roofX: 0 };
const sillY = () => 0.46;

export const ANCHORS = {
	navL: [-WING.tip - 0.04, WING.y + 0.02, wingLe(WING.tip) + 0.2],
	navR: [WING.tip + 0.04, WING.y + 0.02, wingLe(WING.tip) + 0.2],
	strobeL: [-WING.tip - 0.04, WING.y + 0.02, wingLe(WING.tip) + 0.6],
	strobeR: [WING.tip + 0.04, WING.y + 0.02, wingLe(WING.tip) + 0.6],
	tail: [0, 0.42, 4.57],
	beacon: [0, 1.5, 3.98],
	landingL: [-1.3, WING.y, wingLe(1.3) - 0.012],
	landingR: [1.3, WING.y, wingLe(1.3) - 0.012],
	exhaustL: [-0.2, -0.47, -1.55],
	exhaustR: [0.2, -0.47, -1.55],
	eye: [0, 0.86, -0.2],
	cabinLight: [0, 0.95, -0.5],
};

const RED = vec3(0.86, 0.08, 0.1), BLUE = vec3(0.1, 0.16, 0.42);
const livery = {
	base: 0xf4f4f2,
	trim: 0xd21f26,
	trim2: 0x1b2a6b,
	// ukośny czerwony pas z granatowym obrzeżem od osłony silnika po ogon, czerwona osłona silnika
	fuselageDetail: (p, { seam, down }) => {
		const d = p.y.add(p.z.mul(0.13));
		const red = smoothstep(-0.3, -0.28, d).mul(down(-0.06, -0.08, d)).mul(smoothstep(-2.0, -1.95, p.z));
		const blue = smoothstep(-0.06, -0.04, d).mul(down(0.02, 0.0, d)).mul(smoothstep(-2.0, -1.95, p.z));
		const cowl = down(-1.94, -1.98, p.z);
		let lines = float(0);
		for (const z of [-1.96, -1.0, 2.0, 3.2]) lines = max(lines, seam(p.z.sub(z)));
		const base = vec3(1).mul(float(1).sub(lines.mul(0.35)));
		return { tint: mix(mix(base, BLUE, blue), RED, max(red, cowl)), rough: float(0) };
	},
	// promienie słońca rozchodzące się od nasady skrzydła (od krawędzi spływu)
	wingDetail: (p, { seam }) => {
		const ax = p.x.abs();
		const ang = atan(p.z.sub(0.9).negate(), ax);
		const ray = step(0.5, fract(ang.mul(3.2))).mul(smoothstep(0.55, 0.62, ax));
		let lines = seam(ax.sub(1.9));
		lines = max(lines, seam(ax.sub(0.6)));
		return { tint: mix(vec3(1).mul(float(1).sub(lines.mul(0.3))), RED, ray.mul(min(1, ax.mul(0.6)))), rough: float(0) };
	},
};

export function createExtra(atmo) {
	const root = new Group();
	root.name = 'extra';
	const { M, environment } = makeMaterials(atmo, livery);
	const { add, at } = adder(root);

	// ======================= kadłub i owiewka =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -1.9 ? 0.06 : z < 1.3 ? 0.05 : 0.14),
		pillars: [-0.55], innerY: 0.4, frameR: 0.018,
	});
	add(at(new SphereGeometry(0.05, 10, 8), 0, 0.26, 4.6), M.fuselage);
	// wloty powietrza w osłonie i wydechy pod spodem
	for (const s of [-1, 1]) {
		add(at(new CircleGeometry(0.075, 20).rotateY(Math.PI), s * 0.2, -0.06, -2.47), M.black);
		add(rod([s * 0.16, -0.4, -1.75], [s * 0.2, -0.48, -1.5], 0.03, 0.035, 8, true), M.exhaust);
	}
	const prop = propeller(root, add, M, atmo, { pos: [0, 0.02, -2.58], radius: 0.95, blades: 3, spinner: [0.2, 0.38], rootChord: 0.17, bladeMat: M.black, tipMat: M.white, tipColor: [0.5, 0.5, 0.5], spinnerMat: M.trim2 });

	// ======================= skrzydło =======================
	const foil = airfoil(26, 0.15, 0, 0.4);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.72), surface = profileSection(foil, 0.74, 1);
	const W = { chord: wingChord, leZ: wingLe, y: WING.y };
	const parts = [airfoilPanel(full, -0.6, 0.6, { ...W, caps: false })];
	const tips = [], ailerons = [];
	for (const s of [-1, 1]) {
		parts.push(airfoilPanel(fixed, s * 0.6, s * 3.58, { ...W, steps: 5 }));
		tips.push(airfoilPanel(full, s * 3.58, s * WING.tip, { ...W, steps: 3, thick: (x) => 1 - ((Math.abs(x) - 3.58) / 0.17) ** 2 * 0.5 }));
		const a = airfoilPanel(surface, s * 0.62, s * 3.56, { ...W, steps: 4 });
		const h = (x) => new Vector3(s * x, WING.y, wingLe(x) + 0.74 * wingChord(x));
		ailerons.push(hinged(root, a, h(0.62), h(3.56), M.wing, s < 0));
	}
	add(mergeGeometries(parts), M.wing);
	add(mergeGeometries(tips), M.white);
	const lamps = lampSet(root, add, ANCHORS);

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.11, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.53), tSurf = profileSection(tailFoil, 0.55, 1);
	const H = { chord: (x) => 1.0 - Math.abs(x) * 0.2, leZ: (x) => 3.55 + Math.abs(x) * 0.15, y: 0.22 };
	add(mergeGeometries([airfoilPanel(tFixed, -0.12, 0.12, { ...H, caps: false }), airfoilPanel(tFixed, -0.12, -1.55, { ...H, steps: 2 }), airfoilPanel(tFixed, 0.12, 1.55, { ...H, steps: 2 })]), M.fuselage);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.02, s * 1.55, { ...H, steps: 2 });
		elevators.push(hinged(root, g, new Vector3(s * 0.02, 0.22, H.leZ(0.02) + 0.55 * H.chord(0.02)), new Vector3(s * 1.55, 0.22, H.leZ(1.55) + 0.55 * H.chord(1.55)), M.white, s < 0));
	}
	const F = { chord: (s) => 1.15 - s * 0.4, leZ: (s) => 3.4 + s * 0.35, y: 0 };
	const fin = airfoilPanel(tFixed, 0, 1.15, { ...F, steps: 2 });
	const finTop = airfoilPanel(tFull, 1.15, 1.2, { ...F, steps: 1 });
	for (const g of [fin, finTop]) { g.rotateZ(Math.PI / 2); g.translate(0, 0.3, 0); }
	add(mergeGeometries([fin, finTop]), M.fuselage);
	const rud = airfoilPanel(tSurf, 0.04, 1.15, { ...F, steps: 2 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 0.3, 0);
	const rudder = hinged(root, rud, new Vector3(0, 0.34, F.leZ(0.04) + 0.55 * F.chord(0.04)), new Vector3(0, 1.45, F.leZ(1.15) + 0.55 * F.chord(1.15)), M.white);

	// ======================= podwozie: sprężynowe goleni, owiewki kół =======================
	const gear = [];
	for (const s of [-1, 1]) {
		const axle = [s * 0.95, -1.05, -1.02];
		gear.push(rod([s * 0.26, -0.42, -0.95], [s * 0.6, -0.78, -0.99], 0.035, 0.03, 8), rod([s * 0.6, -0.78, -0.99], [s * 0.88, -1.03, -1.02], 0.03, 0.03, 8));
		add(at(tyre(0.24, 0.14, 0.14), ...axle), M.rubber);
		const spat = new SphereGeometry(1, 20, 12);
		spat.scale(0.11, 0.2, 0.42);
		add(at(spat, s * 0.98, -0.99, -0.95), M.white);
	}
	gear.push(rod([0, 0.1, 4.2], [0, -0.06, 4.36], 0.018), rod([0, -0.06, 4.36], [0, -0.12, 4.4], 0.008));
	add(mergeGeometries(gear), M.darkMetal);
	add(at(new CylinderGeometry(0.07, 0.07, 0.04, 12).rotateZ(Math.PI / 2), 0, -0.12, 4.4), M.rubber);

	// ======================= znaki, pilot, kabina =======================
	const regMat = registrationMaterial(REGISTRATION, environment, '#1b2a6b');
	sideRegistration(root, loft, regMat, { zc: 2.55, y: 0.2, len: 1.0, h: 0.2 });
	underwingRegistration(root, regMat, { pos: [-2.1, WING.y - 0.104, wingLe(2.1) + wingChord(2.1) * 0.4], w: 1.6, h: 0.5 });
	const pilot = pilotFigure(root, add, M, [0, 0.84, -0.14], 0.9);
	const cockpit = createCockpit(M, atmo, { loft, origin: [0, -0.34, 0.22], width: 0.55, panelScale: 0.6, sill: 0.46, bulkheadZ: 0.5, cage: false });
	root.add(cockpit.group);

	root.userData = {
		prop: prop.prop, blades: prop.blades, disc: prop.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, anchors: ANCHORS,
		animate(dt, rpm, controls) {
			prop.spin(dt, rpm);
			ailerons[0].deflect(controls.roll * 0.45);
			ailerons[1].deflect(-controls.roll * 0.45);
			for (const e of elevators) e.deflect(-controls.pitch * 0.5);
			rudder.deflect(controls.yaw * 0.4);
		},
	};
	return finish(root);
}
