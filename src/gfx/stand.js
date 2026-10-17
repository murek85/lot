// Drzewostany borów wspólne dla tekstury koron w terenie i drzew 3D: siatka oddziałów (520 × 760 m, lekko obrócona)
// z duktami na granicach, wydzielenia dzielone prostymi liniami, wiek drzewostanu, zręby i domieszka liściastych.
// Ta sama logika po obu stronach – drzewa 3D stoją dokładnie tam, gdzie z daleka widać korony.
import { float, vec2, floor, fract, min, mix, step, smoothstep } from 'three/tsl';
import { hash12, valueNoise } from './noise.js';

const CS = [520, 760];

export function forestStand(xz) {
	const ang = 0.08;
	const r = vec2(xz.x.mul(Math.cos(ang)).sub(xz.y.mul(Math.sin(ang))), xz.x.mul(Math.sin(ang)).add(xz.y.mul(Math.cos(ang))));
	const comp = r.div(vec2(CS[0], CS[1]));
	const cid = floor(comp);
	const local = fract(comp); // 0..1 w oddziale
	const toEdge = min(min(local.x, float(1).sub(local.x)).mul(CS[0]), min(local.y, float(1).sub(local.y)).mul(CS[1]));
	// wydzielenia: oddział dzielony prostymi liniami na 1–4 części
	const sx = step(0.5, hash12(cid.add(5.1))), sy = step(0.35, hash12(cid.add(8.3)));
	const cutX = mix(float(0.35), float(0.65), hash12(cid.add(2.2)));
	const cutY = mix(float(0.3), float(0.7), hash12(cid.add(4.4)));
	const part = vec2(step(cutX, local.x).mul(sx), step(cutY, local.y).mul(sy));
	const sid = cid.mul(4.0).add(part);
	const age = hash12(sid.add(0.5));
	const clear = step(0.955, age);
	const young = step(0.78, age).mul(float(1).sub(clear));
	const leafy = step(0.86, hash12(sid.add(19.7)));
	return { cid, local, toEdge, sid, age, clear, young, leafy };
}

/** Udział lasu 0..1 z mapy gęstości, z poszarpanym (szumem) brzegiem. */
export function forestCover(forestTex, uvR, xz) {
	const dens = forestTex.sample(uvR).level(0).r;
	const edgeNoise = valueNoise(xz.div(23)).mul(0.6).add(valueNoise(xz.div(6.5)).mul(0.4)).sub(0.5).mul(0.42);
	return smoothstep(0.42, 0.58, dens.add(edgeNoise));
}

