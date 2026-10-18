// Bryły ptaków z parametrów gatunku (bez Three.js – testowane w Node): tułów z przekrojów, głowa, dziób, szyja
// (bocian), nogi (bocian), ogon (wachlarz) i skrzydła ze stawem nadgarstka – ramię i dłoń, u szybowników
// rozcapierzone lotki („palce”). Rozpiętość 1 (skalowana w shaderze), x – w prawo, y – w górę, z – do przodu.
// Atrybuty: pozycja, kolor (upierzenie), aWing – 0 tułów, 0…1 wzdłuż skrzydła (do animacji stawów).

const C = (r, g, b) => [r, g, b];

/**
 * Gatunki: tułów [długość, szerokość, wysokość], szyja, głowa (promień), dziób, nogi, ogon [długość, szerokość],
 * skrzydło: chord – cięciwy [nasada, nadgarstek, koniec], arm – położenie nadgarstka (ułamek półrozpiętości), sweep –
 * odgięcie końca do tyłu, wristFwd – nadgarstek do przodu (sylwetka „W” mewy), fingers – lotki, fingerLen.
 * anim: amp – wychylenie w barku (rad), wrist – w nadgarstku, dihedral – „V” w szybowaniu, bob – podskok tułowia.
 */
export const MODELS = {
	stork: {
		body: [0.42, 0.09, 0.1], neck: 0.17, head: 0.035, beak: [0.11, C(0.8, 0.15, 0.08)], legs: [0.24, C(0.8, 0.2, 0.1)], tail: [0.08, 0.1],
		wing: { chord: [0.2, 0.19, 0.1], arm: 0.46, sweep: 0.03, wristFwd: 0.0, fingers: 5, fingerLen: 0.07 },
		col: { back: C(0.86, 0.86, 0.84), belly: C(0.9, 0.9, 0.88), wing: C(0.88, 0.88, 0.86), trail: C(0.05, 0.05, 0.05), tip: C(0.04, 0.04, 0.04), head: C(0.9, 0.9, 0.88), tail: C(0.88, 0.88, 0.86) },
		anim: { amp: 0.5, wrist: 0.25, dihedral: 0.04, bob: 0.012 },
	},
	buzzard: {
		body: [0.36, 0.11, 0.11], neck: 0, head: 0.05, beak: [0.035, C(0.25, 0.22, 0.12)], tail: [0.17, 0.17],
		wing: { chord: [0.26, 0.27, 0.15], arm: 0.44, sweep: 0.02, wristFwd: 0.01, fingers: 5, fingerLen: 0.08 },
		col: { back: C(0.33, 0.22, 0.13), belly: C(0.7, 0.62, 0.5), wing: C(0.36, 0.25, 0.15), trail: C(0.25, 0.17, 0.1), tip: C(0.1, 0.07, 0.05), head: C(0.4, 0.28, 0.17), tail: C(0.5, 0.36, 0.22) },
		anim: { amp: 0.45, wrist: 0.3, dihedral: 0.13, bob: 0.018 },
	},
	gull: {
		body: [0.3, 0.07, 0.08], neck: 0, head: 0.045, beak: [0.055, C(0.85, 0.7, 0.15)], tail: [0.1, 0.1],
		wing: { chord: [0.15, 0.13, 0.025], arm: 0.42, sweep: 0.12, wristFwd: 0.05, fingers: 0, fingerLen: 0 },
		col: { back: C(0.6, 0.62, 0.66), belly: C(0.93, 0.93, 0.95), wing: C(0.62, 0.64, 0.68), trail: C(0.85, 0.86, 0.88), tip: C(0.05, 0.05, 0.06), head: C(0.94, 0.94, 0.95), tail: C(0.93, 0.93, 0.95) },
		anim: { amp: 0.55, wrist: 0.45, dihedral: 0.08, bob: 0.02 },
	},
	crow: {
		body: [0.4, 0.1, 0.1], neck: 0, head: 0.06, beak: [0.07, C(0.03, 0.03, 0.035)], tail: [0.16, 0.13],
		wing: { chord: [0.24, 0.24, 0.13], arm: 0.45, sweep: 0.02, wristFwd: 0.0, fingers: 5, fingerLen: 0.08 },
		col: { back: C(0.05, 0.05, 0.065), belly: C(0.05, 0.05, 0.06), wing: C(0.05, 0.05, 0.07), trail: C(0.04, 0.04, 0.05), tip: C(0.035, 0.035, 0.045), head: C(0.05, 0.05, 0.06), tail: C(0.04, 0.04, 0.05) },
		anim: { amp: 0.65, wrist: 0.35, dihedral: 0.03, bob: 0.03 },
	},
	starling: {
		body: [0.38, 0.11, 0.1], neck: 0, head: 0.06, beak: [0.06, C(0.75, 0.62, 0.15)], tail: [0.1, 0.08],
		wing: { chord: [0.22, 0.17, 0.03], arm: 0.4, sweep: 0.13, wristFwd: 0.01, fingers: 0, fingerLen: 0 },
		col: { back: C(0.07, 0.07, 0.08), belly: C(0.09, 0.08, 0.09), wing: C(0.08, 0.08, 0.09), trail: C(0.06, 0.06, 0.07), tip: C(0.05, 0.05, 0.06), head: C(0.07, 0.08, 0.08), tail: C(0.06, 0.06, 0.07) },
		anim: { amp: 0.8, wrist: 0.5, dihedral: 0.0, bob: 0.035 },
	},
};

export function buildBird(m) {
	const pos = [], col = [], wing = [], idx = [];
	const v = (x, y, z, c, w = 0) => { pos.push(x, y, z); col.push(...c); wing.push(w); return pos.length / 3 - 1; };
	const tri = (a, b, c) => idx.push(a, b, c);
	const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
	const [L, BW, BH] = m.body;
	const K = 8;
	// tułów: przekroje eliptyczne wzdłuż z (od ogona do piersi), grzbiet ciemniejszy niż brzuch
	const stations = [[-0.5, 0.35], [-0.25, 0.85], [0, 1], [0.25, 0.85], [0.45, 0.55]];
	const rings = stations.map(([t, r]) => {
		const z = t * L, ring = [];
		for (let k = 0; k < K; k++) {
			const a = (k / K) * Math.PI * 2, y = Math.sin(a) * (BH / 2) * r;
			ring.push(v(Math.cos(a) * (BW / 2) * r, y, z, y > 0 ? m.col.back : m.col.belly));
		}
		return ring;
	});
	for (let i = 1; i < rings.length; i++) for (let k = 0; k < K; k++) quad(rings[i - 1][k], rings[i - 1][(k + 1) % K], rings[i][(k + 1) % K], rings[i][k]);
	// tył tułowia zamknięty
	const rear = v(0, 0, -0.56 * L, m.col.back);
	for (let k = 0; k < K; k++) tri(rear, rings[0][(k + 1) % K], rings[0][k]);
	// szyja i głowa: przekroje od piersi do głowy (bocian – długa szyja), dziób – stożek
	const front = 0.45 * L, hr = m.head;
	const neckRings = [];
	const neckSteps = m.neck > 0 ? 3 : 1;
	for (let i = 1; i <= neckSteps; i++) {
		const t = i / neckSteps, z = front + m.neck * t, r = m.neck > 0 ? hr * 0.7 : hr;
		const ring = [];
		for (let k = 0; k < K; k++) { const a = (k / K) * Math.PI * 2; ring.push(v(Math.cos(a) * r, Math.sin(a) * r + (m.neck > 0 ? 0 : BH * 0.12), z, m.col.head)); }
		neckRings.push(ring);
	}
	let prev = rings[rings.length - 1];
	for (const ring of neckRings) { for (let k = 0; k < K; k++) quad(prev[k], prev[(k + 1) % K], ring[(k + 1) % K], ring[k]); prev = ring; }
	const headZ = front + m.neck + hr;
	const headY = m.neck > 0 ? 0 : BH * 0.12;
	const hring = [];
	for (let k = 0; k < K; k++) { const a = (k / K) * Math.PI * 2; hring.push(v(Math.cos(a) * hr, Math.sin(a) * hr + headY, headZ, m.col.head)); }
	for (let k = 0; k < K; k++) quad(prev[k], prev[(k + 1) % K], hring[(k + 1) % K], hring[k]);
	const [bl, bc] = m.beak;
	const bring = [];
	for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; bring.push(v(Math.cos(a) * hr * 0.45, Math.sin(a) * hr * 0.4 + headY, headZ + hr * 0.6, bc)); }
	for (let k = 0; k < K; k++) quad(hring[k], hring[(k + 1) % K], bring[Math.floor((((k + 1) % K) / K) * 4) % 4], bring[Math.floor((k / K) * 4)]);
	const tip = v(0, headY - hr * 0.1, headZ + hr * 0.6 + bl, bc);
	for (let k = 0; k < 4; k++) tri(bring[k], bring[(k + 1) % 4], tip);
	// nogi bociana: dwie cienkie listwy wystające za ogon
	if (m.legs) {
		const [ll, lc] = m.legs;
		for (const s of [-1, 1]) {
			const x = s * BW * 0.18, y = -BH * 0.35, z0 = -0.2 * L, z1 = -0.5 * L - ll;
			quad(v(x - 0.006, y, z0, lc), v(x + 0.006, y, z0, lc), v(x + 0.006, y - 0.004, z1, lc), v(x - 0.006, y - 0.004, z1, lc));
		}
	}
	// ogon: wachlarz z czterech pól za tułowiem
	const [tl, tw] = m.tail;
	const tc = v(0, BH * 0.08, -0.45 * L, m.col.tail);
	const fan = [];
	for (let k = 0; k <= 4; k++) { const t = k / 4 - 0.5; fan.push(v(t * tw, BH * 0.06, -0.5 * L - tl * (1 - Math.abs(t) * 0.3), m.col.tail)); }
	for (let k = 0; k < 4; k++) tri(tc, fan[k], fan[k + 1]);
	// skrzydła: nasada przy tułowiu, nadgarstek, koniec; z – krawędź natarcia, cięciwa do tyłu
	const W = m.wing, xr = BW * 0.42, xw = W.arm * 0.5, xt = 0.5;
	const zLead = [0.06 * L, 0.06 * L + W.wristFwd, 0.06 * L - W.sweep];
	for (const s of [-1, 1]) {
		const w = (x) => Math.min(1, Math.abs(x) / 0.5);
		const L0 = v(s * xr, 0.01, zLead[0], m.col.wing, w(xr)), T0 = v(s * xr, 0.01, zLead[0] - W.chord[0], m.col.trail, w(xr));
		const L1 = v(s * xw, 0.0, zLead[1], m.col.wing, w(xw)), T1 = v(s * xw, 0.0, zLead[1] - W.chord[1], m.col.trail, w(xw));
		quad(L0, L1, T1, T0);
		if (!W.fingers) {
			// dłoń zwężająca się w szpic (mewa, szpak)
			const Lt = v(s * xt, -0.005, zLead[2], m.col.tip, 1), Tt = v(s * xt * 0.97, -0.005, zLead[2] - W.chord[2], m.col.tip, 1);
			quad(L1, Lt, Tt, T1);
		} else {
			// dłoń do nasady lotek, potem rozcapierzone „palce” (szybowniki)
			const xf = xt - W.fingerLen;
			const zf = zLead[1] + (zLead[2] - zLead[1]) * ((xf - xw) / (xt - xw));
			const Lf = v(s * xf, -0.003, zf, m.col.tip, w(xf)), Tf = v(s * xf, -0.003, zf - W.chord[2] * 1.25, m.col.tip, w(xf));
			quad(L1, Lf, Tf, T1);
			const n = W.fingers, span = W.chord[2] * 1.25;
			for (let i = 0; i < n; i++) {
				// palce: od krawędzi natarcia do tyłu, rozchylone wachlarzowo, z przerwami
				// szerokie pióra (~80% przedziału), końce zwężone i rozchylone wachlarzowo do tyłu
				const a = zf - (span * i) / n, b = zf - (span * (i + 0.82)) / n;
				const len = W.fingerLen * (1.05 - Math.abs(i - 1.2) * 0.1);
				const mid = (a + b) / 2 - i * 0.012;
				const half = ((a - b) / 2) * 0.55;
				const r0 = v(s * xf, -0.003, a, m.col.tip, w(xf)), r1 = v(s * xf, -0.003, b, m.col.tip, w(xf));
				const t0 = v(s * (xf + len), -0.006, mid + half, m.col.tip, 1), t1 = v(s * (xf + len), -0.006, mid - half, m.col.tip, 1);
				quad(r0, t0, t1, r1);
			}
		}
	}
	return { pos, col, wing, idx, joints: { shoulder: xr, wrist: xw } };
}
