// Pociągi na ekranie: wagony jako instancje (położenie, kierunek, pochylenie, dwie barwy malowania w atrybutach),
// obrót i krzywizna Ziemi w shaderze. Ściany oznaczone w bryle: (1,1,1) – barwa główna, (1,1,0) – druga, (0,0,1) –
// okna (nocą świecą ciepło w osobowych). Reflektory czoła i czerwone światła końca składu – poświaty.
import {
	Mesh, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, MeshBasicNodeMaterial, Sprite, SpriteNodeMaterial,
	AdditiveBlending, Vector2, DoubleSide,
} from 'three/webgpu';
import {
	Fn, vec2, vec3, float, attribute, instancedBufferAttribute, varying, uniform, max, dot, normalize, mix, uv, exp, clamp,
	length, cameraPosition, step, abs, fract,
} from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { onGround, cityLight, cityUniforms } from '../gfx/ground.js';
import { CARS } from './trains.js';

const A = [1, 1, 1], B = [1, 1, 0], WIN = [0, 0, 1], DARK = [0.06, 0.06, 0.065], ROOF = [0.28, 0.29, 0.3], BOGIE = [0.05, 0.05, 0.05];

/** Bryła wagonu: x – w prawo, z – do przodu, y – od główki szyny w górę; długość L. */
function carGeometry(kind) {
	const b = new GeoBuilder();
	const L = CARS[kind].len, h = L / 2;
	const box = (w, y0, y1, z0, z1, col) => b.beam(0, z0, 0, z1, w, y0, y1, col);
	const bogies = (w, inset, bl = 2.6) => { box(w, 0.15, 1.0, -h + inset, -h + inset + bl, BOGIE); box(w, 0.15, 1.0, h - inset - bl, h - inset, BOGIE); };
	if (kind === 'emuHead' || kind === 'emuMid' || kind === 'coach') {
		const head = kind === 'emuHead';
		bogies(2.5, 2);
		box(2.9, 1.05, 2.05, -h, h - (head ? 2.2 : 0), A); // pas dolny
		box(2.92, 2.05, 2.85, -h + 1.2, h - (head ? 3.4 : 1.2), WIN); // pas okien
		box(2.9, 2.85, 3.85, -h, h - (head ? 2.2 : 0), A);
		if (kind !== 'coach') box(2.94, 1.25, 1.55, -h, h - (head ? 2.2 : 0), B); // pas ozdobny
		else box(2.94, 1.25, 1.45, -h, h, B);
		box(2.5, 3.85, 4.15, -h + 1, h - (head ? 3 : 1), ROOF);
		if (head) {
			// kabina: niższa, ścięta do przodu, szyba czołowa
			box(2.9, 1.05, 2.3, h - 2.2, h, B);
			box(2.8, 2.3, 3.3, h - 2.2, h - 0.8, WIN);
			box(2.86, 3.3, 3.75, h - 2.2, h - 1.2, A);
		}
	} else if (kind === 'loco') {
		bogies(2.6, 1.5, 3.4);
		box(3.0, 1.0, 1.6, -h, h, B);
		box(3.0, 1.6, 3.9, -h + 2.2, h - 2.2, A);
		for (const s of [-1, 1]) {
			box(3.0, 1.6, 2.5, s > 0 ? h - 2.2 : -h, s > 0 ? h : -h + 2.2, A);
			box(2.9, 2.5, 3.5, s > 0 ? h - 2.2 : -h, s > 0 ? h : -h + 2.2, WIN);
			box(3.0, 3.5, 3.9, s > 0 ? h - 2.2 : -h, s > 0 ? h : -h + 2.2, A);
		}
		box(2.2, 3.9, 4.25, -h + 3, h - 3, ROOF);
		box(1.4, 4.25, 4.9, -2.5, -1.5, DARK); box(1.4, 4.25, 4.9, 1.5, 2.5, DARK); // pantografy (uproszczone)
	} else if (kind === 'hopper') {
		bogies(2.4, 1.2, 2);
		box(3.0, 1.0, 3.3, -h, h, A);
		box(2.7, 3.0, 3.45, -h + 0.4, h - 0.4, [0.035, 0.035, 0.04]); // węgiel
		box(3.05, 1.0, 1.25, -h, h, B);
	} else if (kind === 'tank') {
		bogies(2.4, 1.2, 2);
		box(2.6, 1.0, 1.4, -h, h, B);
		box(2.2, 1.4, 3.7, -h + 0.6, h - 0.6, A); // walec przybliżony dwoma prostopadłościanami
		box(2.8, 1.8, 3.3, -h + 0.6, h - 0.6, A);
	} else if (kind === 'narrowLoco') {
		box(1.9, 0.2, 0.8, -h, h, BOGIE);
		box(2.0, 0.8, 2.3, -h, h - 2.5, A);
		box(2.1, 0.8, 1.7, h - 2.5, h, A);
		box(2.0, 2.3, 2.9, -h + 0.2, -h + 2.6, WIN);
		box(2.1, 2.9, 3.1, -h, -h + 2.8, B);
	} else {
		box(1.9, 0.2, 0.8, -h, h, BOGIE);
		box(2.2, 0.8, 1.6, -h, h, A);
		box(2.22, 1.6, 2.3, -h + 0.5, h - 0.5, WIN);
		box(2.2, 2.3, 2.6, -h, h, A);
		box(2.0, 2.6, 2.8, -h + 0.3, h - 0.3, B);
	}
	return b;
}

function makeKind(kind, cap, atmo, clouds, plane, camXZ, U) {
	const b = carGeometry(kind);
	const g = new InstancedBufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
	g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
	g.setAttribute('aColor', new BufferAttribute(new Float32Array(b.col), 3));
	g.setIndex(b.idx);
	const attrs = {
		pos: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		dir: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // hx, hz, pochylenie
		colA: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		colB: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		lit: new InstancedBufferAttribute(new Float32Array(cap), 1), // okna nocą: 1 osobowy, 0 towarowy
	};
	for (const a of Object.values(attrs)) a.setUsage(35048);
	g.instanceCount = 0;
	const iPos = instancedBufferAttribute(attrs.pos), iDir = instancedBufferAttribute(attrs.dir);
	const iA = instancedBufferAttribute(attrs.colA), iB = instancedBufferAttribute(attrs.colB), iLit = instancedBufferAttribute(attrs.lit);
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const vWorld = varying(vec3(0), 'vTrWorld'), vN = varying(vec3(0), 'vTrNormal'), vCol = varying(vec3(0), 'vTrCol'), vWin = varying(float(0), 'vTrWin'), vLocal = varying(vec3(0), 'vTrLocal');
	m.positionNode = Fn(() => {
		const p = attribute('position', 'vec3'), n = attribute('normal', 'vec3');
		const f = iDir.xy, r = vec2(f.y.negate(), f.x), pitch = iDir.z;
		// pochylenie: wysokość zmienia się wzdłuż wagonu (wzniesienia, przyczółki mostów)
		const w = vec3(r.x.mul(p.x).add(f.x.mul(p.z)), p.y.add(p.z.mul(pitch)), r.y.mul(p.x).add(f.y.mul(p.z)));
		vN.assign(vec3(r.x.mul(n.x).add(f.x.mul(n.z)), n.y, r.y.mul(n.x).add(f.y.mul(n.z))));
		const world = iPos.add(w);
		vWorld.assign(world);
		vLocal.assign(p);
		const c = attribute('aColor', 'vec3');
		const isA = step(2.9, c.x.add(c.y).add(c.z)), isB = step(1.9, c.x.add(c.y)).mul(step(c.z, 0.1)), isW = step(c.x.add(c.y), 0.1).mul(step(0.9, c.z));
		vWin.assign(isW.mul(iLit));
		vCol.assign(mix(mix(mix(c, iA, isA), iB, isB), vec3(0.05, 0.06, 0.07), isW));
		return onGround(world, camXZ);
	})();
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		const shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		const sky = atmo.skyIrradiance().mul(N.y.mul(0.5).add(0.5));
		const lit = vCol.div(Math.PI).mul(sunE.mul(max(0, dot(N, sun))).mul(shadow).add(sky).add(plane.lights.landingLight(vWorld, N)).add(cityLight(vWorld)));
		// okna osobowych nocą: ciepłe światło wnętrza (jak okna domów – z adaptacją oka)
		const CU = cityUniforms();
		const glow = CU ? CU.street.mul(CU.winGlow) : float(0);
		// pojedyncze okna co 1,7 m wzdłuż boku wagonu (z ramami); szyby czołowe – w całości
		const fz = fract(vLocal.z.div(1.7));
		const pane = step(0.18, fz).mul(step(fz, 0.86)).mul(step(2.2, vLocal.y)).mul(step(vLocal.y, 2.75));
		const lamp = mix(float(1), pane, step(1.3, abs(vLocal.x)));
		return lit.add(vec3(1.0, 0.78, 0.48).mul(vWin).mul(lamp).mul(glow).mul(0.35));
	})();
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	return { mesh, g, attrs };
}

function makeLights(cap, camXZ, pixelAngle) {
	const pos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	const col = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	pos.setUsage(35048); col.setUsage(35048);
	const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
	const world = onGround(instancedBufferAttribute(pos), camXZ);
	m.positionNode = world;
	const s = max(float(1.6), length(cameraPosition.sub(world)).mul(pixelAngle).mul(7)).min(45);
	m.scaleNode = vec2(s, s);
	const q = uv().sub(0.5).mul(2);
	const r2 = dot(q, q);
	const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
	const CU = cityUniforms();
	m.colorNode = instancedBufferAttribute(col).mul(f).mul(CU ? CU.street.mul(max(CU.glow, 0.25)) : float(1)).mul(8);
	const sprite = new Sprite(m);
	sprite.count = 0;
	sprite.frustumCulled = false;
	sprite.renderOrder = 15;
	return { sprite, pos, col };
}

export function createTrainView(sim, atmo, clouds, plane, pixelAngle, cap = 400) {
	const camXZ = uniform(new Vector2());
	const kinds = new Map(Object.keys(CARS).map((k) => [k, makeKind(k, cap, atmo, clouds, plane, camXZ)]));
	const lights = makeLights(64, camXZ, pixelAngle);
	const objects = [...[...kinds.values()].map((k) => k.mesh), lights.sprite];
	return {
		objects,
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			const n = new Map([...kinds.keys()].map((k) => [k, 0]));
			let L = 0;
			const lp = lights.pos.array, lc = lights.col.array;
			for (const tr of sim.trains) {
				const passenger = tr.type !== 'freight';
				for (const c of tr.cars) {
					const k = kinds.get(c.kind), i = n.get(c.kind);
					if (i >= cap) continue;
					n.set(c.kind, i + 1);
					// wagon odwrócony (czoło zespołu na końcu składu) – bryła obrócona o 180°
					const s = c.reversed ? -1 : 1;
					k.attrs.pos.array.set([c.x, c.y, c.z], i * 3);
					k.attrs.dir.array.set([c.hx * s, c.hz * s, c.pitch * s], i * 3);
					k.attrs.colA.array.set(c.colA, i * 3);
					k.attrs.colB.array.set(c.colB, i * 3);
					k.attrs.lit.array[i] = passenger ? 1 : 0;
				}
				// światła: trzy reflektory na czole, dwa czerwone na końcu
				if (L + 5 <= 64 && tr.cars.length) {
					const f = tr.cars[0], e = tr.cars[tr.cars.length - 1];
					const put = (c, along, side, y, col) => {
						lp.set([c.x + c.hx * along - c.hz * side, c.y + y, c.z + c.hz * along + c.hx * side], L * 3);
						lc.set(col, L * 3);
						L++;
					};
					const hf = f.len / 2 + 0.1, he = -(e.len / 2 + 0.1), W = [1, 0.93, 0.8], R = [0.9, 0.03, 0.02];
					put(f, hf, 0.9, 1.3, W); put(f, hf, -0.9, 1.3, W); put(f, hf, 0, 3.5, W);
					put(e, he, 0.9, 1.3, R); put(e, he, -0.9, 1.3, R);
				}
			}
			for (const [kind, k] of kinds) {
				const c = n.get(kind);
				k.g.instanceCount = c;
				k.mesh.visible = c > 0;
				for (const a of Object.values(k.attrs)) a.needsUpdate = true;
			}
			lights.sprite.count = L;
			lights.sprite.visible = L > 0;
			lights.pos.needsUpdate = true;
			lights.col.needsUpdate = true;
		},
	};
}
