// Ruch w powietrzu wokół gracza: liniowce wysoko (ze smugami kondensacyjnymi), podejścia i odloty z pasów lotnisk
// w pobliżu, awionetki i śmigłowce nisko, szybowce krążące latem w kominach, balony o świcie i zmierzchu przy ciszy.
// Logika – AirSim (bez Three.js, testowana w Node); widok – instancje brył (src/gen/aircraftgeo.js), smugi i światła
// pozycyjne w nakładce po wygładzaniu (widać je na tle nieba).
import { Vector2, Sprite, SpriteNodeMaterial, InstancedBufferAttribute, NormalBlending, CustomBlending, OneFactor, ZeroFactor, AddEquation } from 'three/webgpu';
import {
	Fn, vec2, vec3, vec4, float, uniform, instancedBufferAttribute, varying, uv, dot, max, exp, length, clamp, smoothstep, fract, step, time,
	cameraPosition, cameraViewMatrix, screenUV, getViewPosition, If, Discard, select,
} from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { makeKind } from './render.js';
import { onGround } from '../gfx/ground.js';
import { valueNoise } from '../gfx/noise.js';
import { aircraftModel } from '../gen/aircraftgeo.js';

const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };
const PAINTS = [[0.05, 0.12, 0.35], [0.55, 0.06, 0.05], [0.1, 0.35, 0.6], [0.06, 0.06, 0.07], [0.7, 0.45, 0.05], [0.12, 0.4, 0.2], [0.85, 0.85, 0.85]];
const BALLOON = [[0.8, 0.1, 0.05], [0.9, 0.6, 0.05], [0.1, 0.3, 0.75], [0.1, 0.55, 0.2], [0.75, 0.2, 0.6]];
export const AIR_KINDS = ['airliner', 'light', 'heli', 'glider', 'balloon'];
const GLIDE = Math.tan((3 * Math.PI) / 180);

/** Ile maszyn danego rodzaju teraz: env { day, hour, sunY, wind (m/s), cover, precip, storm }. */
export function airTargets(env) {
	const day = env.sunY > 0.02, summer = env.day >= 105 && env.day <= 270, bad = env.storm || env.precip;
	return {
		airliner: env.storm ? 2 : 6,
		light: day && !bad ? 2 : 0,
		heli: bad ? 0 : 1,
		glider: day && summer && !bad && env.hour > 10 && env.hour < 18 && env.cover < 0.7 ? 3 : 0,
		balloon: summer && !bad && env.wind < 5 && env.sunY > -0.02 && (env.hour < 9 || env.hour > 17) ? 3 : 0,
	};
}

export class AirSim {
	/** opts: { groundAt, seed }. */
	constructor(opts) {
		this.groundAt = opts.groundAt;
		this.random = rng(opts.seed ?? 1234);
		this.agents = [];
		this.targets = { airliner: 0, light: 0, heli: 0, glider: 0, balloon: 0 };
		this.runways = []; // końce pasów w pobliżu: { x, z, ux, uz (kierunek lądowania), len }
		this.wind = { x: 0, z: 0 };
		this.t = 0;
	}

	spawn(kind, c) {
		const r = this.random, a = r() * Math.PI * 2, h = r() * Math.PI * 2;
		const R = kind === 'airliner' ? 25000 : kind === 'balloon' ? 3000 : 6000;
		const d = R * (0.3 + 0.7 * r()), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d, g = this.groundAt(x, z);
		const A = { kind, x, z, hx: Math.sin(h), hz: -Math.cos(h), color: PAINTS[Math.floor(r() * PAINTS.length)], seed: r(), mode: 'cruise' };
		if (kind === 'airliner') {
			// część liniowców to podejścia i odloty z pobliskiego pasa
			const rw = this.runways.length && r() < 0.5 ? this.runways[Math.floor(r() * this.runways.length)] : null;
			if (rw && Math.hypot(rw.x - c.x, rw.z - c.z) < 30000) {
				const gr = this.groundAt(rw.x, rw.z);
				if (r() < 0.5) Object.assign(A, { mode: 'approach', rw, x: rw.x - rw.ux * 16000, z: rw.z - rw.uz * 16000, y: gr + 16000 * GLIDE, hx: rw.ux, hz: rw.uz, v: 75 });
				else Object.assign(A, { mode: 'depart', rw, x: rw.x, z: rw.z, y: gr + 0.5, hx: rw.ux, hz: rw.uz, v: 0 });
				A.color = PAINTS[Math.floor(r() * (PAINTS.length - 1))];
			} else Object.assign(A, { y: 9000 + r() * 2800, v: 220 + r() * 30, contrail: 0.3 + r() * 0.7 });
		} else if (kind === 'light') Object.assign(A, { y: g + 500 + r() * 900, v: 50 + r() * 15 });
		else if (kind === 'heli') Object.assign(A, { y: g + 250 + r() * 350, v: 45 + r() * 15 });
		else if (kind === 'glider') Object.assign(A, { y: g + 800 + r() * 800, v: 26, cx: x, cz: z, cr: 90 + r() * 60, ca: r() * 6.28, cw: r() < 0.5 ? 1 : -1 });
		else Object.assign(A, { y: g + 150 + r() * 500, v: 0, color: BALLOON[Math.floor(r() * BALLOON.length)] });
		this.agents.push(A);
	}

	/** Krok: c – środek (samolot gracza / kamera). */
	step(dt, c) {
		this.t += dt;
		const count = Object.fromEntries(AIR_KINDS.map((k) => [k, 0]));
		for (const a of this.agents) count[a.kind]++;
		for (const k of AIR_KINDS) if (count[k] < this.targets[k] && this.random() < dt * 0.5) this.spawn(k, c);
		const keep = [];
		for (const a of this.agents) {
			if (a.kind === 'glider') {
				// krążenie w kominie, komin z wolna dryfuje z wiatrem
				a.ca += (a.cw * a.v / a.cr) * dt;
				a.cx += this.wind.x * dt; a.cz += this.wind.z * dt;
				const nx = a.cx + Math.cos(a.ca) * a.cr, nz = a.cz + Math.sin(a.ca) * a.cr;
				const l = Math.hypot(nx - a.x, nz - a.z) || 1;
				a.hx = (nx - a.x) / l; a.hz = (nz - a.z) / l;
				a.x = nx; a.z = nz; a.y += 0.6 * dt;
			} else if (a.kind === 'balloon') {
				a.x += this.wind.x * dt; a.z += this.wind.z * dt;
				a.y += Math.sin(this.t * 0.05 + a.seed * 9) * 0.4 * dt;
			} else if (a.mode === 'approach') {
				// ścieżka schodzenia 3° do progu, przyziemienie, dobieg i zjazd z pasa (znika)
				const d = (a.rw.x - a.x) * a.rw.ux + (a.rw.z - a.z) * a.rw.uz, gr = this.groundAt(a.x, a.z);
				if (d > 0) { a.y = Math.max(gr + 0.5, this.groundAt(a.rw.x, a.rw.z) + d * GLIDE); a.v = 70 + Math.min(1, d / 8000) * 20; }
				else { a.y = gr + 0.5; a.v = Math.max(8, a.v - 2.5 * dt); if (-d > a.rw.len * 0.8) a.gone = true; }
				a.x += a.hx * a.v * dt; a.z += a.hz * a.v * dt;
			} else if (a.mode === 'depart') {
				// rozbieg (przyspieszenie ~2,2 m/s²), oderwanie przy 75 m/s, wznoszenie ~8°
				a.v = Math.min(140, a.v + (a.v < 75 ? 2.2 : 1) * dt);
				a.x += a.hx * a.v * dt; a.z += a.hz * a.v * dt;
				const gr = this.groundAt(a.x, a.z);
				a.y = a.v < 75 ? gr + 0.5 : a.y + a.v * 0.14 * dt;
				if (a.y > gr + 3500) a.gone = true;
			} else {
				a.x += a.hx * a.v * dt; a.z += a.hz * a.v * dt;
				if (a.kind !== 'airliner') { const gr = this.groundAt(a.x, a.z); if (a.y < gr + 150) a.y = gr + 150; }
			}
			const R = a.kind === 'airliner' ? 45000 : 12000;
			if (!a.gone && (a.x - c.x) ** 2 + (a.z - c.z) ** 2 < R * R) keep.push(a);
		}
		this.agents = keep;
	}
}

/** Bryła rodzaju do instancji (balon – czasza z obrotu, kosz). */
function kindGeometry(kind) {
	const b = new GeoBuilder();
	if (kind === 'balloon') {
		const W = [1, 1, 1], S = [0.9, 0.88, 0.82];
		const prof = [[0.1, 4, W], [0.35, 6, S], [0.8, 10, W], [1, 15, S], [0.95, 19, W], [0.7, 22.5, S], [0.3, 24.3, W], [0, 24.8, W]];
		b.lathe(0, 0, 8.5, 8.5, 0, prof, 16);
		b.beam(0, -0.7, 0, 0.7, 1.4, 0, 1.1, [0.35, 0.22, 0.1]);
		return b;
	}
	aircraftModel(kind, (x0, x1, y0, y1, z0, z1, col) => b.beam((x0 + x1) / 2, z0, (x0 + x1) / 2, z1, x1 - x0, y0, y1, col));
	return b;
}

/** Widok: bryły (scena) + smugi i światła (nakładka – build woła main przy tworzeniu obrazu końcowego). */
export function createAirView(sim, atmo, clouds, plane, pixelAngle, cap = 24) {
	const camXZ = uniform(new Vector2());
	const kinds = Object.fromEntries(AIR_KINDS.map((k) => [k, makeKind(k, cap, atmo, clouds, plane, camXZ, kindGeometry(k))]));
	const TRAIL = 60, LIGHTS = 5;
	const trail = { pos: new InstancedBufferAttribute(new Float32Array(cap * TRAIL * 4), 4) }; // x, y, z, promień; alfa w w? – osobno
	const trailA = new InstancedBufferAttribute(new Float32Array(cap * TRAIL), 1);
	const lp = new InstancedBufferAttribute(new Float32Array(cap * LIGHTS * 3), 3), lc = new InstancedBufferAttribute(new Float32Array(cap * LIGHTS * 4), 4);
	for (const at of [trail.pos, trailA, lp, lc]) at.setUsage(35048);
	const night = uniform(0);
	let trailSprite = null, lightSprite = null;
	return {
		objects: Object.values(kinds).map((k) => k.mesh),
		night,
		/** Smugi i światła w nakładce (głębia sceny – zasłanianie). */
		build(depthNode, projInv, scene) {
			const occl = (vViewZ) => {
				const d = depthNode.sample(screenUV).r;
				If(d.greaterThan(0).and(vViewZ.lessThan(getViewPosition(screenUV, d, projInv).z)), () => { Discard(); });
			};
			// smugi kondensacyjne: kłęby wzdłuż toru za liniowcem, rosną i rzedną z odległością
			{
				const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: NormalBlending });
				const P = instancedBufferAttribute(trail.pos), A = instancedBufferAttribute(trailA);
				const world = onGround(P.xyz, camXZ);
				m.positionNode = world;
				// z daleka smuga cieńsza od piksela – kłąb najmniej ~2,5 piksela, krycie zmniejszone w tej proporcji
				const tdist = length(cameraPosition.sub(world)), size = max(P.w.mul(2), tdist.mul(pixelAngle).mul(2.5));
				m.scaleNode = vec2(size, size);
				const vViewZ = varying(cameraViewMatrix.mul(vec4(world, 1)).z, 'vTrlViewZ');
				const air = atmo.aerial(cameraPosition.y, world.sub(cameraPosition));
				const vIns = varying(air.inscatter, 'vTrlIns'), vT = varying(air.transmittance, 'vTrlT');
				const vLight = varying(atmo.sunLight(world.y).mul(0.55).add(atmo.skyIrradiance()).div(Math.PI).mul(0.95), 'vTrlLight');
				const vA = varying(A.mul(clamp(P.w.mul(2).div(size).mul(1.6), 0.18, 1)), 'vTrlA');
				m.colorNode = Fn(() => {
					occl(vViewZ);
					const q = uv().sub(0.5).mul(2);
					// smuga wysoko nad chmurami: za nimi tylko tyle, ile przepuszczą (przepuszczalność chmur w tym pikselu)
					const a = clamp(float(1).sub(dot(q, q)), 0, 1).mul(valueNoise(uv().mul(3).add(vA.mul(40))).mul(0.6).add(0.5)).mul(vA)
						.mul(clouds.output.sample(screenUV).level(0).a.min(1));
					If(a.lessThan(0.003), () => { Discard(); });
					return vec4(vLight.mul(vT).add(vIns), a);
				})();
				trailSprite = new Sprite(m);
				trailSprite.count = 0;
				trailSprite.frustumCulled = false;
				scene.add(trailSprite);
			}
			// światła pozycyjne: czerwone (lewe skrzydło), zielone (prawe), białe (ogon), stroboskopy i migacz
			{
				const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
				Object.assign(m, { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor });
				const P = instancedBufferAttribute(lp), C = instancedBufferAttribute(lc);
				const world = onGround(P, camXZ);
				m.positionNode = world;
				const dist = length(cameraPosition.sub(world));
				const s = max(float(0.6), dist.mul(pixelAngle).mul(3)).min(200);
				m.scaleNode = vec2(s, s);
				const vViewZ = varying(cameraViewMatrix.mul(vec4(world, 1)).z, 'vNavViewZ');
				// C.w: 0 – stałe, 1 – stroboskop (krótki błysk co ~1,2 s), 2 – migacz czerwony (co ~1 s)
				const ph = fract(time.mul(0.83).add(P.x.mul(0.013)));
				const blink = select(C.w.lessThan(0.5), float(1), select(C.w.lessThan(1.5), step(ph, 0.06).mul(3), step(ph, 0.25).mul(1.5)));
				const vCol = varying(C.xyz.mul(blink).mul(max(night, 0.25)).mul(exp(dist.mul(-1 / 30000))), 'vNavCol');
				m.colorNode = Fn(() => {
					occl(vViewZ);
					const q = uv().sub(0.5).mul(2), r2 = dot(q, q);
					return vec4(vCol.mul(exp(r2.mul(-10))).mul(6), 0);
				})();
				lightSprite = new Sprite(m);
				lightSprite.count = 0;
				lightSprite.frustumCulled = false;
				scene.add(lightSprite);
			}
		},
		/** camera; contrails 0..1 (pogoda: smugi przy pogodnym, mroźnym niebie wysoko); wind { x, z }. */
		update(camera, contrails, wind) {
			camXZ.value.set(camera.position.x, camera.position.z);
			const n = Object.fromEntries(AIR_KINDS.map((k) => [k, 0]));
			const TP = trail.pos.array, TA = trailA.array, LP = lp.array, LC = lc.array;
			let nt = 0, nl = 0;
			for (const a of sim.agents) {
				const k = kinds[a.kind], i = n[a.kind];
				if (i >= cap) continue;
				n[a.kind]++;
				k.pos.array.set([a.x, a.y, a.z], i * 3);
				k.dir.array.set([a.hx, a.hz], i * 2);
				k.col.array.set(a.color, i * 3);
				// smuga: tylko liniowce w przelocie (wysoko); długość z wilgotności (los maszyny) i pogody
				if (a.contrail && contrails > 0 && nt + TRAIL <= cap * TRAIL) {
					const L = 6000 * a.contrail * contrails;
					for (let j = 0; j < TRAIL; j++) {
						const d = 30 + (j / TRAIL) * L, age = d / a.v;
						TP.set([a.x - a.hx * d + wind.x * age, a.y + 2 - age * 0.05, a.z - a.hz * d + wind.z * age, 3 + d * 0.004], nt * 4);
						TA[nt] = 0.75 * Math.pow(1 - j / TRAIL, 1.3) * Math.min(1, d / 120);
						nt++;
					}
				}
				if (a.kind === 'balloon' || nl + LIGHTS > cap * LIGHTS) continue;
				const span = a.kind === 'airliner' ? 17 : a.kind === 'glider' ? 8.5 : a.kind === 'heli' ? 1.2 : 5.5, back = a.kind === 'airliner' ? 18 : 4;
				const rx = -a.hz, rz = a.hx, y = a.y + (a.kind === 'airliner' ? 3.3 : 2);
				const L5 = [[-span, 0, [1, 0.05, 0.03], 0], [span, 0, [0.1, 1, 0.3], 0], [0, -back, [1, 1, 1], 0], [-span, 0.3, [1, 1, 1], 1], [0, 0, [1, 0.1, 0.05], 2]];
				if (a.kind === 'glider') continue; // szybowce bez świateł
				for (const [s, f, col, mode] of L5) {
					LP.set([a.x + rx * s + a.hx * f, y + (mode === 2 ? 2.5 : 0), a.z + rz * s + a.hz * f], nl * 3);
					LC.set([...col, mode], nl * 4);
					nl++;
				}
			}
			for (const [t, k] of Object.entries(kinds)) {
				k.g.instanceCount = n[t];
				for (const at of [k.pos, k.dir, k.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n[t] * at.itemSize); }
				k.mesh.visible = n[t] > 0;
			}
			if (trailSprite) { trailSprite.count = nt; trailSprite.visible = nt > 0; trail.pos.needsUpdate = trailA.needsUpdate = true; }
			if (lightSprite) { lightSprite.count = nl; lightSprite.visible = nl > 0; lp.needsUpdate = lc.needsUpdate = true; }
		},
	};
}
