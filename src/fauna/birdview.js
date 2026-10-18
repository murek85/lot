// Ptaki na ekranie: osobna bryła każdego gatunku (src/fauna/birdmodels.js) z instancjami – położenie, kurs,
// pochylenie, przechył, faza machania, szybowanie i rozpiętość w atrybutach. W shaderze: skrzydło zgina się
// w barku i w nadgarstku (szybkie uderzenie w dół, wolniejszy powrót z ugiętą dłonią), tułów podskakuje w rytmie
// machania, w szybowaniu skrzydła w „V”. Bryła tylko z bliska (rozpiętość ≥ ~4 piksele) – dalej ptak jest punktem
// (src/fauna/birddots.js). Wektory ruchu liczone z przesunięcia ptaka i poprzedniej kamery – wygładzanie TRAA
// nie rozmazuje skrzydeł (wbudowany wektor bierze poprzednie położenie z surowej bryły, bez instancji).
import { Mesh, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, MeshBasicNodeMaterial, Vector2, Matrix4, DoubleSide } from 'three/webgpu';
import {
	Fn, vec2, vec3, float, attribute, instancedBufferAttribute, varying, uniform, max, dot, normalize, sin, cos, length, cross,
	select, abs, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, vec4, mrt,
} from 'three/tsl';
import { onGround } from '../gfx/ground.js';
import { MODELS, buildBird } from './birdmodels.js';

/** Obrót punktu (x, y) wokół osi (px, 0) o kąt a (dodatni – w górę). */
const rotAbout = (q, px, a) => {
	const d = vec2(q.x.sub(px), q.y), c = cos(a), s = sin(a);
	return vec2(d.x.mul(c).sub(d.y.mul(s)).add(px), d.x.mul(s).add(d.y.mul(c)));
};
/** Obrót wektora (x, y) o kąt a. */
const rot = (v, a) => vec2(v.x.mul(cos(a)).sub(v.y.mul(sin(a))), v.x.mul(sin(a)).add(v.y.mul(cos(a))));

function makeSpecies(id, cap, atmo, clouds, camXZ, pixelAngle, prevVP) {
	const M = MODELS[id];
	const b = buildBird(M);
	const g = new InstancedBufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
	g.setAttribute('aColor', new BufferAttribute(new Float32Array(b.col), 3));
	g.setAttribute('aWing', new BufferAttribute(new Float32Array(b.wing), 1));
	g.setIndex(b.idx);
	g.computeVertexNormals();
	const A = {
		pos: new InstancedBufferAttribute(new Float32Array(cap * 3), 3),
		rot: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // kurs, pochylenie, przechył (rad)
		anim: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // faza machania, szybowanie 0..1, rozpiętość (m)
		delta: new InstancedBufferAttribute(new Float32Array(cap * 3), 3), // przesunięcie od poprzedniej klatki (m)
	};
	for (const a of Object.values(A)) a.setUsage(35048);
	g.instanceCount = 0;
	const iPos = instancedBufferAttribute(A.pos), iRot = instancedBufferAttribute(A.rot), iAnim = instancedBufferAttribute(A.anim), iDelta = instancedBufferAttribute(A.delta);
	const U = { amp: uniform(M.anim.amp), wrist: uniform(M.anim.wrist), dihedral: uniform(M.anim.dihedral), bob: uniform(M.anim.bob) };
	const xs = b.joints.shoulder, xw = b.joints.wrist;
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const vWorld = varying(vec3(0), `vBird_${id}_World`), vN = varying(vec3(0), `vBird_${id}_N`), vCol = varying(vec3(0), `vBird_${id}_Col`), vVel = varying(vec2(0), `vBird_${id}_Vel`);
	m.positionNode = Fn(() => {
		const p = attribute('position', 'vec3'), n = attribute('normal', 'vec3');
		const phase = iAnim.x, glide = iAnim.y, span = iAnim.z;
		const flap = float(1).sub(glide);
		// uderzenie skrzydeł: fala skośna (w dół szybciej niż w górę), nadgarstek opóźniony – dłoń ugięta przy powrocie
		const wave = sin(phase.add(sin(phase).mul(0.35)));
		const sh = wave.mul(U.amp).mul(flap).add(glide.mul(U.dihedral));
		const wr = sin(phase.sub(0.8)).mul(U.wrist).mul(flap).sub(glide.mul(U.dihedral).mul(0.4));
		// lewe skrzydło – w układzie prawego (lustro), potem z powrotem
		const side = select(p.x.lessThan(0), float(-1), float(1));
		const ax = abs(p.x);
		let q = vec2(ax, p.y);
		q = select(ax.greaterThan(xw), rotAbout(q, xw, wr), q);
		q = select(ax.greaterThan(xs), rotAbout(q, xs, sh), q);
		let qn = vec2(n.x.mul(side), n.y);
		qn = select(ax.greaterThan(xw), rot(qn, wr), qn);
		qn = select(ax.greaterThan(xs), rot(qn, sh), qn);
		// tułów podskakuje przeciwnie do skrzydeł
		const bob = wave.mul(U.bob).mul(flap).negate();
		// rozpiętość na ekranie (piksele): poniżej ~4 bryła znika (zostaje punkt), naturalna wielkość
		const dist = length(cameraPosition.sub(iPos));
		const px = span.div(max(dist.mul(pixelAngle), 1e-6));
		const s = select(px.lessThan(4), float(0), span);
		const local = vec3(q.x.mul(side), q.y.add(bob), p.z).mul(s);
		const ln = vec3(qn.x.mul(side), qn.y, n.z);
		// układ ptaka: przód z kursu i pochylenia, prawo – poziomo, potem przechył wokół osi lotu (+ – prawe skrzydło w dół)
		const yaw = iRot.x, pitch = iRot.y, bank = iRot.z;
		const f = vec3(sin(yaw).mul(cos(pitch)), sin(pitch), cos(yaw).negate().mul(cos(pitch)));
		const r0 = normalize(cross(f, vec3(0, 1, 0)).add(vec3(1e-4, 0, 0)));
		const u0 = cross(r0, f);
		const cb = cos(bank), sb = sin(bank);
		const r = r0.mul(cb).sub(u0.mul(sb)), u = u0.mul(cb).add(r0.mul(sb));
		const world = iPos.add(r.mul(local.x)).add(u.mul(local.y)).add(f.mul(local.z));
		vWorld.assign(world);
		vN.assign(r.mul(ln.x).add(u.mul(ln.y)).add(f.mul(ln.z)));
		vCol.assign(attribute('aColor', 'vec3'));
		// wektor ruchu: położenie teraz i klatkę wcześniej (o przesunięcie ptaka, poprzednią kamerą), w NDC
		const gw = onGround(world, camXZ);
		const cur = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(gw, 1));
		const prev = prevVP.mul(vec4(gw.sub(iDelta), 1));
		vVel.assign(cur.xy.div(cur.w).sub(prev.xy.div(prev.w)));
		return gw;
	})();
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		// pióra prześwitują – światło z obu stron (skrzydło od spodu jaśnieje pod słońce)
		const ndl = max(dot(N, sun), dot(N.negate(), sun).mul(0.55)).max(0);
		const sky = atmo.skyIrradiance().mul(abs(N.y).mul(0.3).add(0.7));
		return vCol.div(Math.PI).mul(sunE.mul(ndl).mul(clouds.groundShadow(vWorld)).add(sky));
	})();
	m.mrtNode = mrt({ velocity: vVel });
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	return { mesh, g, A };
}

export function createBirdView(sim, atmo, clouds, plane, pixelAngle, cap = 600) {
	const camXZ = uniform(new Vector2());
	// rzut kamery z poprzedniej klatki (aktualizacja przed ruchem kamery w tej klatce)
	const prevVP = uniform(new Matrix4());
	const kinds = new Map(Object.keys(MODELS).map((id) => [id, makeSpecies(id, cap, atmo, clouds, camXZ, pixelAngle, prevVP)]));
	return {
		objects: [...kinds.values()].map((k) => k.mesh),
		update(camera) {
			camXZ.value.set(camera.position.x, camera.position.z);
			prevVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
			const n = new Map([...kinds.keys()].map((k) => [k, 0]));
			for (const gr of sim.groups) {
				const k = kinds.get(gr.id);
				if (!k) continue;
				for (const b of gr.birds) {
					const i = n.get(gr.id);
					if (i >= cap) break;
					n.set(gr.id, i + 1);
					k.A.pos.array.set([b.x, b.y, b.z], i * 3);
					k.A.rot.array.set([b.yaw ?? 0, b.pitch ?? 0, b.bank ?? 0], i * 3);
					k.A.anim.array.set([b.phase % (Math.PI * 2), b.glideK ?? b.glide, b.span], i * 3);
					// przesunięcie od poprzedniej klatki (pierwsza klatka, przeskok – zero)
					const dx = b.x - (b.lx ?? b.x), dy = b.y - (b.ly ?? b.y), dz = b.z - (b.lz ?? b.z);
					const ok = dx * dx + dy * dy + dz * dz < 400;
					k.A.delta.array.set(ok ? [dx, dy, dz] : [0, 0, 0], i * 3);
					b.lx = b.x; b.ly = b.y; b.lz = b.z;
				}
			}
			for (const [id, k] of kinds) {
				const c = n.get(id);
				k.g.instanceCount = c;
				k.mesh.visible = c > 0;
				for (const a of Object.values(k.A)) a.needsUpdate = true;
			}
		},
	};
}
