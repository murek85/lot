// Ptaki na ekranie: jedna bryła (tułów i dwa skrzydła ze stawem i lotkami) z instancjami – położenie, kierunek lotu,
// rozpiętość, faza machania i szybowanie w atrybutach, machanie skrzydeł w shaderze. Z daleka bryła rośnie do kilku
// pikseli (stado szpaków widać z samolotu jako ruchomą chmurę punktów).
import { Mesh, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, MeshBasicNodeMaterial, Vector2, DoubleSide } from 'three/webgpu';
import {
	Fn, vec3, float, attribute, instancedBufferAttribute, varying, uniform, max, dot, normalize, mix, sin, length, cross, cameraPosition,
} from 'three/tsl';
import { onGround } from '../gfx/ground.js';
import { SPECIES } from './birds.js';

/**
 * Bryła ptaka o rozpiętości 1 (x – w prawo, z – do przodu, y – w górę). Atrybut aWing: 0 tułów, 0…1 wzdłuż skrzydła
 * (do machania i barwy końców).
 */
function birdGeometry() {
	const pos = [], wing = [], idx = [];
	const v = (x, y, z, w) => { pos.push(x, y, z); wing.push(w); return pos.length / 3 - 1; };
	// tułów: romb wydłużony (głowa z przodu, ogon z tyłu)
	const head = v(0, 0, 0.32, 0), tail = v(0, 0, -0.3, 0), l = v(-0.05, 0, 0.02, 0), r = v(0.05, 0, 0.02, 0), top = v(0, 0.035, 0.02, 0);
	idx.push(head, l, tail, head, tail, r, head, top, l, head, r, top);
	// skrzydła: nasada (przy tułowiu), staw (połowa), koniec – dwie części z różnym wychyleniem
	for (const s of [-1, 1]) {
		const r0 = v(0.05 * s, 0, 0.13, 0), r1 = v(0.05 * s, 0, -0.1, 0);
		const m0 = v(0.27 * s, 0, 0.11, 0.5), m1 = v(0.27 * s, 0, -0.13, 0.5);
		const t0 = v(0.5 * s, 0, 0.02, 1), t1 = v(0.45 * s, 0, -0.12, 1);
		idx.push(r0, m0, r1, r1, m0, m1, m0, t0, m1, m1, t0, t1);
	}
	return { pos, wing, idx };
}

export function createBirdView(sim, atmo, clouds, plane, pixelAngle, cap = 1500) {
	const camXZ = uniform(new Vector2());
	const geo = birdGeometry();
	const g = new InstancedBufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(geo.pos), 3));
	g.setAttribute('aWing', new BufferAttribute(new Float32Array(geo.wing), 1));
	g.setIndex(geo.idx);
	const A = {
		pos: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		vel: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		anim: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // rozpiętość, faza, szybowanie
		body: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		tip: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
	};
	for (const a of Object.values(A)) a.setUsage(35048);
	g.instanceCount = 0;
	const iPos = instancedBufferAttribute(A.pos), iVel = instancedBufferAttribute(A.vel), iAnim = instancedBufferAttribute(A.anim);
	const iBody = instancedBufferAttribute(A.body), iTip = instancedBufferAttribute(A.tip);
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const vWorld = varying(vec3(0), 'vBirdWorld'), vN = varying(vec3(0), 'vBirdN'), vCol = varying(vec3(0), 'vBirdCol');
	m.positionNode = Fn(() => {
		const p = attribute('position', 'vec3'), w = attribute('aWing', 'float');
		const span = iAnim.x, phase = iAnim.y, glide = iAnim.z;
		// z daleka co najmniej ~12 pikseli rozpiętości (mniejsze giną w wygładzaniu TRAA i rozmyciu miniatury)
		const dist = length(cameraPosition.sub(iPos));
		const s = max(span, dist.mul(pixelAngle).mul(12));
		// machanie: skrzydło wygina się w stawie (koniec wychyla się mocniej), szybowanie – lekkie „V”
		const flap = sin(phase).mul(float(1).sub(glide));
		const lift = w.mul(w.add(0.6)).mul(flap.mul(0.42).add(glide.mul(0.07)));
		const local = vec3(p.x, p.y.add(lift), p.z).mul(s);
		// układ ptaka: przód – kierunek lotu, prawo – poziomo, góra – prostopadle
		const f = normalize(iVel.add(vec3(0, 1e-4, 1e-4)));
		const r = normalize(cross(f, vec3(0, 1, 0)).add(vec3(1e-4, 0, 0)));
		const u = cross(r, f);
		const world = iPos.add(r.mul(local.x)).add(u.mul(local.y)).add(f.mul(local.z));
		vWorld.assign(world);
		vN.assign(u);
		vCol.assign(mix(iBody, iTip, w.mul(w)));
		return onGround(world, camXZ);
	})();
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		// cienkie skrzydła – światło z obu stron (prześwitujące pióra)
		const ndl = max(dot(N, sun), dot(N.negate(), sun).mul(0.6)).max(0);
		const sky = atmo.skyIrradiance();
		return vCol.div(Math.PI).mul(sunE.mul(ndl).mul(clouds.groundShadow(vWorld)).add(sky.mul(0.8)));
	})();
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	return {
		objects: [mesh],
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			let n = 0;
			for (const gr of sim.groups) for (const b of gr.birds) {
				if (n >= cap) break;
				const S = SPECIES[b.species];
				A.pos.array.set([b.x, b.y, b.z], n * 3);
				A.vel.array.set([b.vx, b.vy, b.vz], n * 3);
				A.anim.array.set([b.span, b.phase, b.glide], n * 3);
				A.body.array.set(S.col[0], n * 3);
				A.tip.array.set(S.col[1], n * 3);
				n++;
			}
			g.instanceCount = n;
			mesh.visible = n > 0;
			for (const a of Object.values(A)) a.needsUpdate = true;
		},
	};
}
