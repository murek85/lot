// Efekt miniatury (tilt-shift): ostry pas wokół samolotu, rozmycie rosnące ku górze i dołowi kadru – krajobraz
// wygląda jak makieta. Rozmycie dyskiem (13 próbek po spirali złotego kąta), siła zależna od wysokości lotu.
import { Fn, uv, vec2, vec4, float, uniform, abs, max, clamp, cos, sin, screenSize, convertToTexture } from 'three/tsl';

export function tiltShift(input) {
	const tex = convertToTexture(input);
	const U = {
		focus: uniform(0.62), // środek ostrego pasa (0 – góra ekranu, 1 – dół)
		band: uniform(0.1), // połowa szerokości ostrego pasa
		strength: uniform(1), // 0 – wyłączony
		maxRadius: uniform(7), // piksele
	};
	const node = Fn(() => {
		const st = uv();
		const dist = max(0, abs(st.y.sub(U.focus)).sub(U.band));
		const r = clamp(dist.mul(U.strength).mul(28), 0, U.maxRadius);
		const texel = vec2(1).div(screenSize);
		const sum = tex.sample(st).toVar();
		const N = 12;
		for (let k = 1; k <= N; k++) {
			const a = k * 2.399963;
			const rr = r.mul(Math.sqrt(k / N));
			sum.addAssign(tex.sample(st.add(vec2(cos(float(a)), sin(float(a))).mul(rr).mul(texel))));
		}
		return vec4(sum.rgb.div(N + 1), 1);
	})();
	return { node, uniforms: U };
}

