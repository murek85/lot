// Piesi na ekranie: figurka (nogi, tułów, ręce, głowa, parasol) z instancjami – położenie, kierunek, faza kroku,
// wzrost i barwy ubrania w atrybutach; krok (wymach nóg i rąk) w shaderze. Parasol tylko w deszczu.
import { Mesh, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, MeshBasicNodeMaterial, Vector2, DoubleSide } from 'three/webgpu';
import {
	Fn, vec2, vec3, float, attribute, instancedBufferAttribute, varying, uniform, max, dot, normalize, sin, cos, select, length,
	cameraPosition, floor, mod,
} from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { onGround, cityLight } from '../gfx/ground.js';

// części: 0 tułów, 1 lewa noga, 2 prawa noga, 3 lewa ręka, 4 prawa ręka, 5 głowa, 6 parasol
function personGeometry() {
	const b = new GeoBuilder();
	const part = [];
	const box = (p, x, w, y0, y1, d) => {
		const before = b.count;
		b.beam(x, -d / 2, x, d / 2, w, y0, y1, [0, 0, 0]);
		for (let i = before; i < b.count; i++) part.push(p);
	};
	box(1, -0.09, 0.14, 0.02, 0.86, 0.16);
	box(2, 0.09, 0.14, 0.02, 0.86, 0.16);
	box(0, 0, 0.42, 0.84, 1.46, 0.24);
	box(3, -0.27, 0.1, 0.88, 1.42, 0.12);
	box(4, 0.27, 0.1, 0.88, 1.42, 0.12);
	box(5, 0, 0.2, 1.48, 1.74, 0.22);
	box(6, 0.3, 0.03, 1.4, 2.0, 0.03); // rączka parasola
	box(6, 0.3, 1.0, 2.0, 2.08, 1.0); // czasza
	return { b, part };
}

const pack = (c) => Math.round(c[0] * 255) * 65536 + Math.round(c[1] * 255) * 256 + Math.round(c[2] * 255);

export function createPeopleView(sim, atmo, clouds, plane, pixelAngle, cap = 1600) {
	const camXZ = uniform(new Vector2());
	const rainU = uniform(0);
	const { b, part } = personGeometry();
	const g = new InstancedBufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
	g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
	g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
	g.setIndex(b.idx);
	// atrybuty instancji upakowane (WebGPU pozwala na 8 buforów wierzchołków, a bryła ma już 3): kierunek jako kąt,
	// barwy koszuli, spodni i parasola jako liczby 24-bitowe (R·65536 + G·256 + B, po 8 bitów)
	const A = {
		pos: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		anim: new InstancedBufferAttribute(new Float32Array(cap * 4), 4), // faza kroku, wzrost, parasol (0/1), kurs (rad)
		look: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // koszula, spodnie, parasol
	};
	for (const a of Object.values(A)) a.setUsage(35048);
	g.instanceCount = 0;
	const I = Object.fromEntries(Object.entries(A).map(([k, a]) => [k, instancedBufferAttribute(a)]));
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const vWorld = varying(vec3(0), 'vPplWorld'), vN = varying(vec3(0), 'vPplN'), vCol = varying(vec3(0), 'vPplCol');
	m.positionNode = Fn(() => {
		const p = attribute('position', 'vec3'), n = attribute('normal', 'vec3'), pt = attribute('aPart', 'float');
		const phase = I.anim.x, hScale = I.anim.y, umb = I.anim.z;
		const unpack = (v) => vec3(floor(v.div(65536)), floor(mod(v, 65536).div(256)), mod(v, 256)).div(255);
		// wymach: nogi wokół biodra (0,86 m), ręce wokół barku (1,42 m), przeciwnie do nóg po tej samej stronie
		const isLeg = pt.greaterThan(0.5).and(pt.lessThan(2.5)), isArm = pt.greaterThan(2.5).and(pt.lessThan(4.5));
		const side = select(pt.lessThan(1.5).or(pt.greaterThan(2.5).and(pt.lessThan(3.5))), float(1), float(-1));
		const ang = sin(phase).mul(side).mul(select(isLeg, float(0.45), select(isArm, float(-0.35), float(0))));
		const pivot = select(isLeg, float(0.86), float(1.42));
		const dy = p.y.sub(pivot), c = cos(ang), s = sin(ang);
		const yR = pivot.add(dy.mul(c)).sub(p.z.mul(s)), zR = dy.mul(s).add(p.z.mul(c));
		// parasol tylko w deszczu (i u tych, którzy go mają) – inaczej zwinięty do zera
		const show = select(pt.greaterThan(5.5), umb.mul(rainU), float(1));
		// z daleka nieco większy (inaczej znika w wygładzaniu)
		const dist = length(cameraPosition.sub(I.pos));
		const k = max(hScale, dist.mul(pixelAngle).mul(5));
		const local = vec3(p.x, yR, zR).mul(k).mul(show);
		const f = vec2(cos(I.anim.w), sin(I.anim.w)), r = vec2(f.y.negate(), f.x);
		const w = vec3(r.x.mul(local.x).add(f.x.mul(local.z)), local.y, r.y.mul(local.x).add(f.y.mul(local.z)));
		vN.assign(vec3(r.x.mul(n.x).add(f.x.mul(n.z)), n.y, r.y.mul(n.x).add(f.y.mul(n.z))));
		const world = I.pos.add(w);
		vWorld.assign(world);
		const skin = vec3(0.72, 0.52, 0.4);
		vCol.assign(select(pt.lessThan(0.5).or(isArm), unpack(I.look.x), select(isLeg, unpack(I.look.y), select(pt.lessThan(5.5), skin, unpack(I.look.z)))));
		return onGround(world, camXZ);
	})();
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		const sky = atmo.skyIrradiance().mul(N.y.mul(0.5).add(0.5));
		return vCol.div(Math.PI).mul(sunE.mul(max(0, dot(N, sun))).mul(clouds.groundShadow(vWorld)).add(sky).add(cityLight(vWorld)).add(plane.lights.landingLight(vWorld, N)));
	})();
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	return {
		objects: [mesh],
		update(camera, rain) {
			camXZ.value.set(camera.position.x, camera.position.z);
			rainU.value = rain ? 1 : 0;
			let n = 0;
			for (const a of sim.agents) {
				if (n >= cap) break;
				A.pos.array.set([a.x, a.y, a.z], n * 3);
				A.anim.array.set([a.phase % (Math.PI * 2), a.height / 1.75, a.hasUmbrella ? 1 : 0, Math.atan2(a.hz, a.hx)], n * 4);
				A.look.array.set([pack(a.shirt), pack(a.pants), pack(a.umbrella)], n * 3);
				n++;
			}
			g.instanceCount = n;
			mesh.visible = n > 0;
			for (const at of Object.values(A)) at.needsUpdate = true;
		},
	};
}
