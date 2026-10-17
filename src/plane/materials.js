// Materiały samolotu. Lakier: PBR (słońce i niebo z lamp sceny) + odbicie otoczenia z fizycznej atmosfery – niebo
// nad horyzontem, poniżej ciemna ziemia oświetlona słońcem – z Fresnelem; do tego szczegóły w kolorze liczone z
// położenia w układzie samolotu (linie blach, matowy pas przeciwodblaskowy, okopcenie za wydechem, zabrudzenia).
// Szkło: przezroczyste, z odbiciem nieba. Wnętrze kabiny: bez odbić nieba, z prostym przesłanianiem (AO).
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, MeshBasicNodeMaterial, DoubleSide, Color } from 'three/webgpu';
import {
	Fn, vec2, vec3, float, select, normalWorld, positionWorld, positionLocal, cameraPosition, normalize, reflect, dot, max, min, pow, abs,
	mix, smoothstep, exp, fwidth, clamp, uniform, materialColor,
} from 'three/tsl';
import { valueNoise } from '../gfx/noise.js';

/**
 * Materiały samolotu. livery: { base – kolor lakieru, trim – kolor drugi (końcówki, ster), fuselageDetail(p, h) i
 * wingDetail(p, h) – szczegóły w kolorze (h: { seam, down }) }; bez livery – malowanie Dromadera.
 */
export function makeMaterials(atmo, livery = {}) {
	const V = normalize(cameraPosition.sub(positionWorld));
	const fresnel = (f0, N = normalWorld) => float(f0).add(float(1 - f0).mul(pow(float(1).sub(max(0, dot(V, N))), 5)));
	/** Otoczenie w kierunku R: niebo nad horyzontem, ziemia (albedo ~0,12, słońce + niebo) pod nim. */
	const environment = (R) => {
		const sun = atmo.u.lightDir;
		const sky = atmo.skyRadiance(normalize(vec3(R.x, max(R.y, 0.015), R.z)));
		const ground = atmo.sunLight(positionWorld.y).mul(max(0, sun.y)).add(atmo.skyIrradiance()).mul(0.12 / Math.PI).mul(vec3(0.85, 1, 0.7));
		return mix(ground, sky, smoothstep(-0.04, 0.03, R.y));
	};
	const envRefl = (f0, gain) => environment(reflect(V.negate(), normalWorld)).mul(fresnel(f0)).mul(gain);

	// nieregularna linia w odległości d od krawędzi blachy (szerokość 5 mm, rozmyta wielkością piksela)
	const seam = (d) => {
		const w = max(fwidth(d), 0.002).mul(1.2);
		return float(1).sub(smoothstep(0.0025, w.add(0.0025), abs(d)));
	};

	/**
	 * Lakier. detail(p) – opcjonalna funkcja TSL zwracająca { tint (vec3 mnożnik), rough (float 0..1 dodatek) } dla
	 * położenia p w układzie samolotu.
	 */
	const paint = (color, { rough = 0.4, refl = 0.12, clearcoat = 0.3, detail = null } = {}) => {
		const m = new MeshPhysicalNodeMaterial({ color, roughness: rough, metalness: 0.02, clearcoat, clearcoatRoughness: 0.18 });
		const p = positionLocal;
		const d = detail ? detail(p) : null;
		// drobne zróżnicowanie odcienia i połysku – lakier nie jest idealnie jednolity
		const grain = valueNoise(p.xz.mul(1.7).add(p.y.mul(2.3)));
		const tint = d ? d.tint : vec3(1);
		m.colorNode = materialColor.mul(tint).mul(mix(float(0.94), float(1.04), grain));
		m.roughnessNode = clamp(float(rough).add(grain.sub(0.5).mul(0.08)).add(d ? d.rough : 0), 0.05, 1);
		const gloss = d ? float(1).sub(d.rough) : float(1);
		m.emissiveNode = envRefl(0.04, refl).mul(gloss).mul(min(tint, vec3(1)));
		return m;
	};

	// linie blach na kadłubie i okopcenie za rurami wydechowymi
	const fuselageDetail = (p) => {
		let lines = float(0);
		for (const z of [-4.36, -3.12, -2.62, -1.95, 0.48, 1.25, 2.1, 3.0, 3.85]) lines = max(lines, seam(p.z.sub(z)));
		lines = max(lines, seam(p.y.sub(0.84)).mul(smoothstep(-3.0, -2.95, p.z)).mul(down(-1.75, -1.8, p.z))); // pokrywa zbiornika
		lines = max(lines, seam(abs(p.x).sub(0.34)).mul(step01(p.y, 0.8)).mul(smoothstep(-1.12, -1.1, p.z)).mul(down(0.5, 0.45, p.z)));
		const ax = abs(p.x);
		const sy = p.y.add(0.42).div(0.22);
		const soot = exp(sy.mul(sy).negate()).mul(smoothstep(-3.05, -2.75, p.z)).mul(exp(p.z.add(2.75).div(2.8).negate()))
			.mul(smoothstep(0.25, 0.55, ax)).mul(mix(float(0.55), float(1), valueNoise(p.zy.mul(vec2(1.6, 7)))));
		const belly = down(-0.45, -0.68, p.y).mul(0.35).mul(valueNoise(p.xz.mul(3)));
		// matowy czarny pas przeciwodblaskowy przed szybą
		const antiGlare = smoothstep(0.83, 0.86, p.y).mul(smoothstep(-2.62, -2.58, p.z)).mul(down(-1.6, -1.64, p.z)).mul(down(0.42, 0.38, ax));
		const tint = mix(vec3(1).mul(float(1).sub(lines.mul(0.45))).mul(float(1).sub(soot.mul(0.75))).mul(float(1).sub(belly)), vec3(0.025), antiGlare);
		return { tint, rough: max(soot.mul(0.45), antiGlare.mul(0.55)).add(belly.mul(0.2)) };
	};
	// skrzydło: żebra co ~1,15 m, dźwigar, czarny pas do chodzenia przy kadłubie
	const wingDetail = (p) => {
		const ax = abs(p.x);
		let lines = seam(p.z.add(1.05)).mul(smoothstep(0.7, 0.75, ax));
		for (let k = 0; k < 7; k++) lines = max(lines, seam(ax.sub(1.0 + k * 1.15)));
		const walk = smoothstep(0.72, 0.76, ax).mul(down(1.5, 1.46, ax)).mul(smoothstep(-0.3, -0.25, p.y)).mul(smoothstep(-1.45, -1.4, p.z)).mul(down(0.45, 0.4, p.z));
		const tint = mix(vec3(1).mul(float(1).sub(lines.mul(0.4))), vec3(0.03), walk);
		return { tint, rough: walk.mul(0.6) };
	};

	const yellow = livery.base ?? 0xf5a800;
	const helpers = { seam, down, valueNoise };
	const M = {
		fuselage: paint(yellow, { detail: livery.fuselageDetail ? (p) => livery.fuselageDetail(p, helpers) : fuselageDetail }),
		wing: paint(yellow, { detail: livery.wingDetail ? (p) => livery.wingDetail(p, helpers) : wingDetail }),
		yellow: paint(yellow),
		white: paint(livery.trim ?? 0xeceae2),
		trim2: paint(livery.trim2 ?? 0xb3121b),
		helmet: paint(0xeceae2),
		red: paint(0xb3121b),
		frame: paint(yellow, { refl: 0.12 }),
		metal: new MeshStandardNodeMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.9 }),
		darkMetal: new MeshStandardNodeMaterial({ color: 0x2d3033, roughness: 0.5, metalness: 0.7 }),
		black: new MeshStandardNodeMaterial({ color: 0x0e0f10, roughness: 0.6, metalness: 0.1 }),
		rubber: new MeshStandardNodeMaterial({ color: 0x0a0a0a, roughness: 0.92, metalness: 0 }),
		chrome: new MeshStandardNodeMaterial({ color: 0xd8dadc, roughness: 0.12, metalness: 1 }),
		exhaust: new MeshStandardNodeMaterial({ color: 0x4a3326, roughness: 0.8, metalness: 0.5 }),
	};
	M.chrome.emissiveNode = envRefl(0.6, 0.6);
	M.metal.emissiveNode = envRefl(0.5, 0.25);

	// szyby: lekko zielonkawe, przezroczyste; odbicie nieba silne pod kątem
	const glass = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
	const Ng = select(dot(normalWorld, V).lessThan(0), normalWorld.negate(), normalWorld); // normalna od strony patrzącego (szyba widziana z wnętrza)
	const Fg = fresnel(0.045, Ng);
	glass.colorNode = environment(reflect(V.negate(), Ng)).mul(Fg).add(vec3(0.0015, 0.002, 0.0018));
	glass.opacityNode = Fg.mul(0.85).add(0.07);
	M.glass = glass;

	// wnętrze: szarozielona farba, czarne tablice, tapicerka; zaciemnienie w dół i w głąb kabiny
	const interiorAO = Fn(() => {
		const p = positionLocal;
		return mix(float(0.5), float(1), smoothstep(-0.1, 1.25, p.y)).mul(mix(float(0.75), float(1), smoothstep(-1.6, -0.9, p.z)));
	})();
	const inner = (color, rough, metal = 0, ao = true) => {
		const m = new MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
		if (ao) m.aoNode = interiorAO;
		return m;
	};
	Object.assign(M, {
		cabin: inner(0x6d7a71, 0.75),
		cabinShell: Object.assign(inner(0x65726a, 0.8), { side: DoubleSide }),
		panel: inner(0x18191b, 0.55, 0.2, false),
		seat: inner(0x26303a, 0.9),
		strap: inner(0x2a4f8a, 0.8),
		cage: inner(0x6b756c, 0.5, 0.4),
		knobRed: inner(0xa01010, 0.35),
		knobBlue: inner(0x1a3aa0, 0.35),
		knobBlack: inner(0x101010, 0.3),
		knobYellow: inner(0xe0b000, 0.4),
	});
	M.panel.aoNode = float(0.75);
	return { M, environment, fresnel, paint, helpers };
}

/** Malejący smoothstep (a > b): 1 poniżej b, 0 powyżej a. Odwrócone krawędzie w smoothstep są niezdefiniowane. */
function down(a, b, x) {
	return smoothstep(b, a, x).oneMinus();
}

/** 1 powyżej y0 (gładko) – pomocnicze. */
function step01(y, y0) {
	return smoothstep(y0 - 0.01, y0 + 0.01, y);
}

export const tmpColor = new Color();
export { uniform };
