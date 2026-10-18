// Pojazdy na ekranie: bryły (osobówka, dostawczak, ciężarówka, autobus) jako instancje – położenie, kierunek i kolor
// każdego pojazdu z symulacji (src/traffic/sim.js) w atrybutach instancji, obrót i krzywizna Ziemi w shaderze.
// Nocą reflektory (białe, przód) i światła tylne (czerwone) jako poświaty – jeden sprite z instancjami.
import {
	Mesh, InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, MeshBasicNodeMaterial, Sprite, SpriteNodeMaterial,
	AdditiveBlending, Vector2, DoubleSide,
} from 'three/webgpu';
import {
	Fn, vec2, vec3, float, attribute, instancedBufferAttribute, varying, uniform, max, dot, normalize, mix, uv, exp, clamp,
	length, cameraPosition,
} from 'three/tsl';
import { GeoBuilder } from '../gfx/lit.js';
import { onGround, cityLight, cityUniforms } from '../gfx/ground.js';
import { VEHICLES } from './sim.js';

const GLASS = [0.05, 0.06, 0.07], TYRE = [0.03, 0.03, 0.03], WHITE = [1, 1, 1];

/** Bryły pojazdów w układzie lokalnym: x – w prawo, z – do przodu (+z), y – w górę; kolor 1,1,1 = lakier. */
function vehicleGeometry(id) {
	const b = new GeoBuilder();
	const box = (x0, x1, y0, y1, z0, z1, col) => {
		// prostopadłościan wzdłuż osi z (beam z GeoBuildera: odcinek w x–z, szerokość, wysokości)
		b.beam((x0 + x1) / 2, z0, (x0 + x1) / 2, z1, x1 - x0, y0, y1, col);
	};
	if (id === 'car') {
		box(-0.88, 0.88, 0.3, 0.95, -2.2, 2.2, WHITE);
		box(-0.78, 0.78, 0.95, 1.42, -1.1, 0.9, GLASS);
		box(-0.74, 0.74, 1.36, 1.45, -1.0, 0.75, WHITE);
		box(-0.9, 0.9, 0.05, 0.35, -1.6, -1.0, TYRE); box(-0.9, 0.9, 0.05, 0.35, 1.0, 1.6, TYRE);
	} else if (id === 'van') {
		box(-1.0, 1.0, 0.35, 2.25, -2.7, 1.6, WHITE);
		box(-0.95, 0.95, 0.35, 1.2, 1.6, 2.7, WHITE);
		box(-0.92, 0.92, 1.2, 1.95, 1.5, 2.2, GLASS);
		box(-1.02, 1.02, 0.05, 0.4, -2.0, -1.4, TYRE); box(-1.02, 1.02, 0.05, 0.4, 1.5, 2.1, TYRE);
	} else if (id === 'truck') {
		box(-1.25, 1.25, 0.9, 3.9, -6.5, 3.6, WHITE); // naczepa / skrzynia
		box(-1.2, 1.2, 0.5, 3.1, 4.0, 6.5, [0.75, 0.75, 0.74]); // kabina
		box(-1.1, 1.1, 2.0, 2.8, 6.45, 6.5, GLASS);
		box(-1.27, 1.27, 0.05, 0.9, -6.2, -3.6, TYRE); box(-1.27, 1.27, 0.05, 0.9, 3.8, 5.6, TYRE);
	} else {
		box(-1.27, 1.27, 0.35, 3.0, -6.0, 6.0, WHITE);
		box(-1.29, 1.29, 1.3, 2.4, -5.6, 5.9, GLASS);
		box(-1.28, 1.28, 0.05, 0.5, -4.3, -3.2, TYRE); box(-1.28, 1.28, 0.05, 0.5, 3.4, 4.5, TYRE);
	}
	return b;
}

/** Jeden rodzaj pojazdu: siatka z instancjami (do max sztuk); atrybuty instancji aktualizowane co klatkę. */
function makeKind(id, cap, atmo, clouds, plane, camXZ) {
	const b = vehicleGeometry(id);
	const g = new InstancedBufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
	g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
	g.setAttribute('aColor', new BufferAttribute(new Float32Array(b.col), 3));
	g.setIndex(b.idx);
	const pos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	const dir = new InstancedBufferAttribute(new Float32Array(cap * 2), 2);
	const col = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	for (const a of [pos, dir, col]) a.setUsage(35048); // DynamicDrawUsage
	g.instanceCount = 0;

	// dwustronny jak materiał prostych brył (GeoBuilder nie pilnuje kolejności wierzchołków ścian)
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	// atrybuty instancji przez instancedBufferAttribute (attribute() czytałby je co wierzchołek)
	const iPos = instancedBufferAttribute(pos), iDir = instancedBufferAttribute(dir), iCol = instancedBufferAttribute(col);
	const vWorld = varying(vec3(0), 'vCarWorld'), vN = varying(vec3(0), 'vCarNormal'), vCol = varying(vec3(0), 'vCarCol');
	m.positionNode = Fn(() => {
		const p = attribute('position', 'vec3'), n = attribute('normal', 'vec3');
		// obrót: lokalne +z → kierunek jazdy (hx, hz), lokalne +x → prawa strona (−hz, hx)
		const f = iDir, r = vec2(f.y.negate(), f.x);
		const w = vec3(r.x.mul(p.x).add(f.x.mul(p.z)), p.y, r.y.mul(p.x).add(f.y.mul(p.z)));
		vN.assign(vec3(r.x.mul(n.x).add(f.x.mul(n.z)), n.y, r.y.mul(n.x).add(f.y.mul(n.z))));
		const world = iPos.add(w);
		vWorld.assign(world);
		const c = attribute('aColor', 'vec3');
		// kolor 1,1,1 w bryle = lakier pojazdu
		vCol.assign(mix(c, iCol, float(1).sub(clamp(length(c.sub(vec3(1))).mul(10), 0, 1))));
		return onGround(world, camXZ);
	})();
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		const shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		const sky = atmo.skyIrradiance().mul(N.y.mul(0.5).add(0.5));
		return vCol.div(Math.PI).mul(sunE.mul(max(0, dot(N, sun))).mul(shadow).add(sky).add(plane.lights.landingLight(vWorld, N)).add(cityLight(vWorld)));
	})();
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	return { mesh, g, pos, dir, col };
}

/** Poświaty świateł pojazdów (reflektory i tylne) – pozycje i kolory co klatkę. */
function makeLights(cap, camXZ, pixelAngle) {
	const pos = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	const col = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
	pos.setUsage(35048); col.setUsage(35048);
	const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
	const center = instancedBufferAttribute(pos), color = instancedBufferAttribute(col);
	const world = onGround(center, camXZ);
	m.positionNode = world;
	const dist = length(cameraPosition.sub(world));
	const s = max(float(1.4), dist.mul(pixelAngle).mul(6.5)).min(40);
	m.scaleNode = vec2(s, s);
	const q = uv().sub(0.5).mul(2);
	const r2 = dot(q, q);
	const f = exp(r2.mul(-10)).add(float(0.05).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
	const CU = cityUniforms();
	m.colorNode = color.mul(f).mul(CU ? CU.street.mul(max(CU.glow, 0.25)) : float(1)).mul(7);
	const sprite = new Sprite(m);
	sprite.count = 0;
	sprite.frustumCulled = false;
	sprite.renderOrder = 15;
	return { sprite, pos, col };
}

export function createTrafficView(sim, atmo, clouds, plane, pixelAngle, cap = 3000) {
	const camXZ = uniform(new Vector2());
	const kinds = VEHICLES.map((v) => makeKind(v.id, cap, atmo, clouds, plane, camXZ));
	const lights = makeLights(cap * 4, camXZ, pixelAngle);
	const objects = [...kinds.map((k) => k.mesh), lights.sprite];
	return {
		objects,
		lights,
		/** night – 0..1 (światła), camera – do krzywizny. */
		update(camera, night) {
			camXZ.value.set(camera.position.x, camera.position.z);
			const n = kinds.map(() => 0);
			let L = 0;
			const lp = lights.pos.array, lc = lights.col.array;
			for (const a of sim.agents) {
				const k = kinds[a.type], i = n[a.type]++;
				k.pos.array.set([a.x, a.y, a.z], i * 3);
				k.dir.array.set([a.hx, a.hz], i * 2);
				k.col.array.set(a.color, i * 3);
				if (night > 0.01 && L + 4 <= cap * 4) {
					// reflektory na przodzie, tylne na tyle; ±0,6 szerokości w bok
					const rx = -a.hz, rz = a.hx, h = a.len / 2, sw = a.width * 0.32, y = a.y + 0.75;
					for (const [along, side, c] of [[h, sw, [1, 0.92, 0.75]], [h, -sw, [1, 0.92, 0.75]], [-h, sw, [0.9, 0.04, 0.02]], [-h, -sw, [0.9, 0.04, 0.02]]]) {
						lp.set([a.x + a.hx * along + rx * side, y, a.z + a.hz * along + rz * side], L * 3);
						lc.set(along > 0 ? c : c.map((v) => v * 0.55), L * 3);
						L++;
					}
				}
			}
			kinds.forEach((k, t) => {
				k.g.instanceCount = n[t];
				for (const at of [k.pos, k.dir, k.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n[t] * at.itemSize); }
				k.mesh.visible = n[t] > 0;
			});
			lights.sprite.count = L;
			lights.sprite.visible = L > 0;
			for (const at of [lights.pos, lights.col]) { at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, L * 3); }
		},
	};
}
