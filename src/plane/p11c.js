// PZL P.11c – polski myśliwiec z lat 30.: skrzydło „mewie” Puławskiego (przy kadłubie zwężone i pocienione,
// wznoszące się stromo, dalej prawie płaskie), podparte zastrzałami w kształcie „V”; silnik gwiazdowy Bristol
// Mercury w pierścieniu Townenda z widocznymi cylindrami, dwułopatowe drewniane śmigło, otwarta kabina z małym
// wiatrochronem i garbem za zagłówkiem, stałe podwozie, płoza ogonowa. Malowanie: khaki z góry, jasnoszary
// błękit od spodu, szachownice na skrzydłach i sterze kierunku, biały numer na kadłubie.
// Rozpiętość 10,72 m, długość 7,55 m. Oś x – w prawo, y – w górę, z – do tyłu.
import { Group, CylinderGeometry, SphereGeometry, LatheGeometry, MeshStandardNodeMaterial, DoubleSide, Vector2, Vector3 } from 'three/webgpu';
import { vec3, float, max, mix, smoothstep, fract, normalLocal } from 'three/tsl';
import { airfoil, profileSection, airfoilPanel, mergeGeometries, rod } from './geo.js';
import { makeMaterials } from './materials.js';
import { createCockpit } from './cockpit.js';
import { adder, buildFuselage, hinged, propeller, lamps as lampSet, tyre, pilotFigure, registrationMaterial, sideRegistration, checkerboard, finish } from './parts.js';

export const REGISTRATION = '8.63';

// skrzydło: część wewnętrzna od burty (x 0,38) do załamania (x 1,25) – stromo w górę, zewnętrzna prawie płaska
const WING = { root: 0.38, kink: 1.25, tip: 5.36, rootY: 0.42, kinkY: 0.82, te: 0.55 };
const wingY = (x) => {
	const a = Math.abs(x);
	return a < WING.kink ? WING.rootY + ((a - WING.root) / (WING.kink - WING.root)) * (WING.kinkY - WING.rootY) : WING.kinkY + (a - WING.kink) * 0.0175;
};
const wingChord = (x) => {
	const a = Math.abs(x);
	if (a < WING.kink) return 1.35 + ((a - WING.root) / (WING.kink - WING.root)) * 0.45;
	const c = 1.8 - ((Math.min(a, 5.0) - WING.kink) / (5.0 - WING.kink)) * 0.5;
	return a > 5.0 ? c * (1 - ((a - 5.0) / 0.36) ** 2 * 0.6) : c;
};
const wingTe = (x) => WING.te - Math.max(0, Math.abs(x) - WING.kink) * 0.02;
const wingLe = (x) => wingTe(x) - wingChord(x);
const wingThick = (x) => { const a = Math.abs(x); return a < WING.kink ? 0.5 + ((a - WING.root) / (WING.kink - WING.root)) * 0.5 : a > 5.0 ? 1 - ((a - 5.0) / 0.36) ** 2 * 0.5 : 1; };

const FUSELAGE = [
	{ z: -1.95, w: 0.44, top: 0.46, bot: -0.5, belt: -0.02, n: 2 },
	{ z: -1.6, w: 0.48, top: 0.52, bot: -0.56, belt: -0.03, n: 2.2 },
	{ z: -0.9, w: 0.5, top: 0.57, bot: -0.6, belt: -0.03, n: 2.5 },
	{ z: -0.45, w: 0.5, top: 0.6, bot: -0.6, belt: -0.03, n: 2.6 },
	{ z: -0.15, w: 0.5, top: 0.84, bot: -0.6, belt: -0.03, n: 2.6 },
	{ z: 0.75, w: 0.47, top: 0.84, bot: -0.55, belt: -0.02, n: 2.6 },
	{ z: 0.95, w: 0.45, top: 0.8, bot: -0.52, belt: 0, n: 2.5 },
	{ z: 1.8, w: 0.36, top: 0.62, bot: -0.38, belt: 0.02, n: 2.3 },
	{ z: 3.2, w: 0.22, top: 0.47, bot: -0.14, belt: 0.1, n: 2.1 },
	{ z: 4.6, w: 0.1, top: 0.4, bot: 0.06, belt: 0.2, n: 2 },
	{ z: 5.2, w: 0.03, top: 0.36, bot: 0.18, belt: 0.25, n: 2 },
];
// otwarta kabina: wiatrochron od −0,45 do −0,15, dalej do 0,78 otwór (bez szyby i poszycia) nad krawędzią 0,56 m
const CABIN = { front: -0.45, roofFront: 0.78, back: 0.78, roofX: 0 };
const OPEN_FROM = -0.15;
const sillY = () => 0.56;

export const ANCHORS = {
	navL: [-WING.tip - 0.03, wingY(WING.tip) + 0.02, wingLe(5.2) + 0.25],
	navR: [WING.tip + 0.03, wingY(WING.tip) + 0.02, wingLe(5.2) + 0.25],
	strobeL: [-WING.tip + 0.05, wingY(WING.tip) + 0.02, wingLe(5.2) + 0.7],
	strobeR: [WING.tip - 0.05, wingY(WING.tip) + 0.02, wingLe(5.2) + 0.7],
	tail: [0, 0.36, 5.24],
	beacon: [0, 0.66, 1.6],
	landingL: [-2.0, wingY(2.0), wingLe(2.0) - 0.012],
	landingR: [2.0, wingY(2.0), wingLe(2.0) - 0.012],
	exhaustL: [-0.26, -0.62, -1.3],
	exhaustR: [0.26, -0.62, -1.3],
	eye: [0, 1.0, 0.45],
	cabinLight: [0, 0.75, 0.0],
};

// barwy w przestrzeni liniowej (lakier bazowy biały – odcień daje mnożnik)
const OLIVE = vec3(0.105, 0.1, 0.04), BELLY = vec3(0.38, 0.44, 0.47);
const livery = {
	base: 0xffffff,
	trim: 0x5c5a38,
	trim2: 0x5c5a38,
	// khaki z góry, jasnoszary błękit od spodu, linie blach; farba matowa
	fuselageDetail: (p, { seam, down }) => {
		const under = down(-0.2, -0.3, p.y.sub(p.z.max(1.0).sub(1.0).mul(0.08)));
		let lines = float(0);
		for (const z of [-1.6, -0.9, 0.95, 1.8, 3.2, 4.6]) lines = max(lines, seam(p.z.sub(z)));
		return { tint: mix(OLIVE, BELLY, under).mul(float(1).sub(lines.mul(0.3))), rough: float(0.3) };
	},
	// góra khaki, spód błękitny; szachownice na obu stronach, żebra pod blachą
	wingDetail: (p, { seam }) => {
		const ax = p.x.abs();
		const top = smoothstep(-0.25, 0.25, normalLocal.y);
		const c = checkerboard(ax.sub(4.0).div(0.4), p.z.add(0.43).div(0.4));
		const rib = smoothstep(0.44, 0.5, fract(ax.div(0.4)).sub(0.5).abs()).mul(0.12);
		const lines = max(rib, seam(ax.sub(WING.kink)).mul(0.4));
		const paint = mix(BELLY, OLIVE, top).mul(float(1).sub(lines));
		return { tint: mix(paint, c.color, c.inside), rough: float(0.3) };
	},
};

export function createP11c(atmo) {
	const root = new Group();
	root.name = 'p11c';
	const { M, environment, paint } = makeMaterials(atmo, livery);
	const { add, at } = adder(root);
	const olive = paint(0x5c5a38, { rough: 0.7, refl: 0.06 });
	const wood = new MeshStandardNodeMaterial({ color: 0x5e3b1c, roughness: 0.45, metalness: 0 });
	M.frame = olive; // rama wiatrochronu w kolorze kadłuba (lakier bazowy jest biały)

	// ======================= kadłub i otwarta kabina =======================
	const { loft } = buildFuselage(add, root, M, {
		stations: FUSELAGE, cabin: { ...CABIN, sillY },
		step: (z) => (z < -0.5 ? 0.08 : z < 1.0 ? 0.05 : 0.16),
		pillars: [OPEN_FROM], openFrom: OPEN_FROM, innerY: 0.3, frameR: 0.02,
	});
	add(at(new SphereGeometry(0.035, 10, 8), 0, 0.28, 5.2), M.fuselage);
	// skórzana obwódka otworu kabiny
	{
		const rim = [];
		for (const s of [-1, 1]) {
			for (let z = OPEN_FROM; z < CABIN.back; z += 0.1) {
				const st0 = loft.stationAt(z), st1 = loft.stationAt(Math.min(CABIN.back, z + 0.1));
				const x0 = loft.point(st0, loft.thetaForY(st0, 0.56))[0], x1 = loft.point(st1, loft.thetaForY(st1, 0.56))[0];
				rim.push(rod([s * x0, 0.565, z], [s * x1, 0.565, Math.min(CABIN.back, z + 0.1)], 0.028, 0.028, 6));
			}
		}
		add(mergeGeometries(rim), new MeshStandardNodeMaterial({ color: 0x2b1a10, roughness: 0.7 }));
	}

	// ======================= silnik: pierścień Townenda, cylindry =======================
	const ringMat = paint(0x5c5a38, { rough: 0.6, refl: 0.08 });
	ringMat.side = DoubleSide;
	const ring = new LatheGeometry([[0.62, -1.98], [0.6, -2.28], [0.63, -2.4], [0.68, -2.37], [0.71, -2.2], [0.7, -1.98]].map(([r, z]) => new Vector2(r, z)), 40);
	ring.deleteAttribute('uv');
	ring.rotateX(Math.PI / 2);
	add(ring, ringMat);
	const cyl = [];
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2, d = [Math.sin(a), Math.cos(a)];
		cyl.push(rod([d[0] * 0.2, d[1] * 0.2, -2.2], [d[0] * 0.56, d[1] * 0.56, -2.2], 0.085, 0.07, 10));
		for (let k = 0; k < 7; k++) { const r0 = 0.27 + k * 0.035; cyl.push(rod([d[0] * r0, d[1] * r0, -2.2], [d[0] * (r0 + 0.012), d[1] * (r0 + 0.012), -2.2], 0.11, 0.11, 10)); }
		cyl.push(rod([d[0] * 0.5, d[1] * 0.5, -2.2], [d[0] * 0.4, d[1] * 0.4, -1.95], 0.025, 0.025, 6)); // rury wydechowe do kolektora
	}
	add(mergeGeometries(cyl), M.darkMetal);
	add(at(new CylinderGeometry(0.26, 0.3, 0.3, 24).deleteAttribute('uv').rotateX(Math.PI / 2), 0, 0, -2.25), M.metal);
	add(at(new CylinderGeometry(0.5, 0.5, 0.04, 30).rotateX(Math.PI / 2), 0, 0, -1.97), M.black);
	for (const s of [-1, 1]) add(rod([s * 0.2, -0.5, -1.85], [s * 0.26, -0.62, -1.3], 0.05, 0.055, 10, true), M.exhaust);
	const prop = propeller(root, add, M, atmo, { pos: [0, 0, -2.5], radius: 1.42, blades: 2, spinner: [0.13, 0.22], rootChord: 0.26, bladeMat: wood, tipMat: wood, tipColor: [0.18, 0.11, 0.05], spinnerMat: M.metal });

	// ======================= skrzydło mewie =======================
	const foil = airfoil(26, 0.13, 0.03, 0.35);
	const full = profileSection(foil, 0, 1), fixed = profileSection(foil, 0, 0.72), surface = profileSection(foil, 0.74, 1);
	const W = { chord: wingChord, leZ: wingLe, y: wingY, thick: wingThick };
	const parts = [], ailerons = [];
	for (const s of [-1, 1]) {
		parts.push(airfoilPanel(full, s * WING.root, s * WING.kink, { ...W, steps: 4, caps: false }));
		parts.push(airfoilPanel(fixed, s * WING.kink, s * 5.0, { ...W, steps: 6 }));
		parts.push(airfoilPanel(surface, s * WING.kink, s * 2.85, { ...W, steps: 3 }));
		parts.push(airfoilPanel(full, s * 5.0, s * WING.tip, { ...W, steps: 4 }));
		const a = airfoilPanel(surface, s * 2.9, s * 4.98, { ...W, steps: 3 });
		const h = (x) => new Vector3(s * x, wingY(x) + 0.012 * wingChord(x), wingLe(x) + 0.74 * wingChord(x));
		ailerons.push(hinged(root, a, h(2.9), h(4.98), olive, s < 0));
	}
	add(mergeGeometries(parts), M.wing);
	const lamps = lampSet(root, add, ANCHORS);
	// zastrzały „V” od dołu kadłuba do skrzydła
	const struts = [];
	for (const s of [-1, 1]) {
		const wy = wingY(2.4) - 0.07;
		struts.push(rod([s * 0.46, -0.32, -0.7], [s * 2.4, wy, wingLe(2.4) + 0.35], 0.04, 0.035, 8), rod([s * 0.46, -0.32, 0.15], [s * 2.4, wy, wingLe(2.4) + 1.15], 0.04, 0.035, 8));
	}
	add(mergeGeometries(struts), olive);

	// ======================= usterzenie =======================
	const tailFoil = airfoil(20, 0.1, 0, 0.4);
	const tFull = profileSection(tailFoil, 0, 1), tFixed = profileSection(tailFoil, 0, 0.53), tSurf = profileSection(tailFoil, 0.55, 1);
	const HY = 0.3;
	const H = { chord: (x) => 0.95 - Math.abs(x) * 0.12, leZ: (x) => 4.05 + Math.abs(x) * 0.08, y: HY };
	add(mergeGeometries([airfoilPanel(tFixed, -0.12, 0.12, { ...H, caps: false }), airfoilPanel(tFixed, -0.12, -1.6, { ...H, steps: 2 }), airfoilPanel(tFixed, 0.12, 1.6, { ...H, steps: 2 })]), olive);
	const elevators = [];
	for (const s of [-1, 1]) {
		const g = airfoilPanel(tSurf, s * 0.02, s * 1.6, { ...H, steps: 2 });
		elevators.push(hinged(root, g, new Vector3(s * 0.02, HY, H.leZ(0.02) + 0.55 * H.chord(0.02)), new Vector3(s * 1.6, HY, H.leZ(1.6) + 0.55 * H.chord(1.6)), olive, s < 0));
	}
	add(mergeGeometries([-1, 1].map((s) => rod([s * 0.12, 0.02, 4.3], [s * 0.9, HY - 0.03, H.leZ(0.9) + 0.4], 0.018))), M.darkMetal);
	const F = { chord: (s) => 1.15 - s * 0.3, leZ: (s) => 3.95 + s * 0.4, y: 0 };
	const fin = airfoilPanel(tFixed, 0, 1.15, { ...F, steps: 3 });
	const finTop = airfoilPanel(tFull, 1.15, 1.2, { ...F, steps: 1 });
	for (const g of [fin, finTop]) { g.rotateZ(Math.PI / 2); g.translate(0, 0.36, 0); }
	add(mergeGeometries([fin, finTop]), olive);
	// ster kierunku z szachownicą – w układzie zawiasu: x wzdłuż osi zawiasu, z w tył od niej
	const rudderMat = paint(0xffffff, {
		rough: 0.7, refl: 0.06,
		detail: (p) => {
			const c = checkerboard(p.z.sub(0.24).div(0.2), p.x.sub(0.55).div(0.2));
			return { tint: mix(OLIVE, c.color, c.inside), rough: float(0) };
		},
	});
	const rud = airfoilPanel(tSurf, 0.02, 1.15, { ...F, steps: 3 });
	rud.rotateZ(Math.PI / 2); rud.translate(0, 0.36, 0);
	const rudder = hinged(root, rud, new Vector3(0, 0.38, F.leZ(0.02) + 0.55 * F.chord(0.02)), new Vector3(0, 1.51, F.leZ(1.15) + 0.55 * F.chord(1.15)), rudderMat);

	// ======================= podwozie stałe, płoza ogonowa =======================
	const gear = [];
	for (const s of [-1, 1]) {
		const axle = [s * 0.95, -1.45, -0.95];
		gear.push(rod([s * 0.44, -0.3, -0.85], [s * 0.86, -1.1, -0.93], 0.06, 0.05, 10)); // amortyzator
		gear.push(rod([s * 0.86, -1.1, -0.93], [s * 0.9, -1.45, -0.95], 0.035, 0.035, 8));
		gear.push(rod([s * 0.2, -0.58, -1.25], [s * 0.88, -1.42, -0.97], 0.03, 0.028, 8), rod([s * 0.2, -0.6, -0.45], [s * 0.88, -1.42, -0.93], 0.03, 0.028, 8));
		add(at(tyre(0.35, 0.2, 0.17), ...axle), M.rubber);
		add(at(new CylinderGeometry(0.2, 0.2, 0.15, 18).deleteAttribute('uv').rotateZ(Math.PI / 2), ...axle), olive);
	}
	gear.push(rod([0, 0.1, 4.7], [0, -0.12, 5.0], 0.025, 0.015, 6));
	add(mergeGeometries(gear), M.darkMetal);
	// celownik przed wiatrochronem, karabiny w kadłubie (lufy w osłonach po bokach)
	add(rod([0, 0.62, -0.75], [0, 0.66, -0.35], 0.022), M.black);
	for (const s of [-1, 1]) add(rod([s * 0.42, 0.18, -1.85], [s * 0.45, 0.18, -1.35], 0.02, 0.025, 6), M.black);

	// ======================= znaki, pilot, kabina =======================
	const regMat = registrationMaterial(REGISTRATION, environment, '#ececec');
	sideRegistration(root, loft, regMat, { zc: 2.4, y: 0.1, len: 0.8, h: 0.28 });
	const pilot = pilotFigure(root, add, M, [0, 0.98, 0.5], 0.9);
	const cockpit = createCockpit(M, atmo, { loft, origin: [0, -0.28, 0.87], width: 0.6, panelScale: 0.5, sill: 0.56, bulkheadZ: -0.11, cage: false });
	root.add(cockpit.group);

	root.userData = {
		prop: prop.prop, blades: prop.blades, disc: prop.disc, lamps, cockpit, pilot, ailerons, elevators, rudder, anchors: ANCHORS,
		animate(dt, rpm, controls) {
			prop.spin(dt, rpm);
			ailerons[0].deflect(controls.roll * 0.4);
			ailerons[1].deflect(-controls.roll * 0.4);
			for (const e of elevators) e.deflect(-controls.pitch * 0.5);
			rudder.deflect(controls.yaw * 0.4);
		},
	};
	return finish(root);
}
