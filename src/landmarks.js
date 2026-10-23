// Punkty orientacyjne w otwartym świecie (geometria z wątku kafli – src/gen/landmarkgeo.js): wieże, kominy, wieże
// szybowe i ciśnień, maszty materiałem prostych brył (src/gfx/lit.js); gondole z wirnikami elektrowni wiatrowych
// ustawiane pod wiatr i obracane w shaderze (prędkość z siły wiatru, przy ciszy stoją); jeden wspólny zestaw świateł
// przeszkodowych dla wszystkich kafli (kominy z obrysów budynków, wiatraki, maszty) – migające nocą.
import { Mesh, BufferGeometry, BufferAttribute, MeshBasicNodeMaterial, Vector2, DoubleSide, Sprite, InstancedBufferAttribute, DynamicDrawUsage } from 'three/webgpu';
import { Fn, vec3, attribute, varying, positionLocal, uniform, max, dot, normalize, select, cos, sin, fract } from 'three/tsl';
import { onGround, cityLight } from './gfx/ground.js';
import { makeLitMaterial, litGeometry } from './gfx/lit.js';
import { CASTER_LAYER, CASTER_NEAR } from './shadows.js';
import { TREE_WIND } from './forest.js';
import { beaconMaterial, beaconPhase } from './buildings.js';

/** Kąt obrotu wirników (rad) – narasta z prędkością zależną od wiatru (update). */
const ROTOR = { angle: uniform(0) };

/** Wirniki: ~14 obr./min przy wietrze od ~8 m/s, od ~2,5 m/s ruszają, przy ciszy stoją. */
export function updateRotors(dt) {
	const w = TREE_WIND.v.value, v = Math.hypot(w.x, w.y);
	const k = Math.min(1, Math.max(0, (v - 2.5) / 5.5));
	ROTOR.angle.value = (ROTOR.angle.value + dt * 1.45 * k * k * (3 - 2 * k)) % (Math.PI * 2000);
}

function makeRotorMaterial(atmo, clouds, plane, worldShadow, shadowOnly = false) {
	const m = new MeshBasicNodeMaterial({ side: DoubleSide });
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(vec3(0), 'vRotorWorld');
	const vN = varying(vec3(0), 'vRotorNormal');
	m.positionNode = Fn(() => {
		const p = positionLocal, top = attribute('aTop', 'vec3'), hubY = attribute('aSpin', 'float');
		// łopaty: obrót wokół osi wirnika (+z lokalnie) przez piastę; każdy wiatrak w innej fazie
		const a = ROTOR.angle.add(fract(top.x.mul(0.0137).add(top.z.mul(0.0291))).mul(6.283));
		const c = cos(a), s = sin(a), qy = p.y.sub(hubY);
		const spun = vec3(p.x.mul(c).sub(qy.mul(s)), p.x.mul(s).add(qy.mul(c)).add(hubY), p.z);
		const q = select(hubY.greaterThan(0), spun, p);
		// gondola pod wiatr: oś +z w stronę, z której wieje (przy ciszy – na zachód)
		const w = TREE_WIND.v;
		const f = normalize(vec3(w.x.negate(), 0, w.y.negate()).add(vec3(-0.001, 0, 0)));
		const r = vec3(f.z, 0, f.x.negate());
		const world = top.add(r.mul(q.x)).add(vec3(0, q.y, 0)).add(f.mul(q.z));
		const n = attribute('normal', 'vec3');
		vN.assign(r.mul(n.x).add(vec3(0, n.y, 0)).add(f.mul(n.z)));
		vWorld.assign(world);
		return onGround(world, camXZ);
	})();
	if (shadowOnly) { m.colorNode = vec3(0); return m; }
	const col = varying(attribute('aColor', 'vec3'), 'vRotorColor');
	m.colorNode = Fn(() => {
		const N = normalize(vN);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld.add(N.mul(0.3)), 0.5));
		// płaty dwustronne: światło z obu stron (abs), niebo zależne od pochylenia
		const ndl = max(dot(N, sun), dot(N.negate(), sun)).max(0);
		const sky = atmo.skyIrradiance().mul(N.y.abs().mul(0.3).add(0.6));
		return col.div(Math.PI).mul(sunE.mul(ndl).mul(shadow).add(sky).add(cityLight(vWorld).mul(0.3)));
	})();
	m.fog = false;
	return m;
}

/**
 * Siatki punktów orientacyjnych kafla z tablic wątku. shared – wspólne materiały (z pierwszego kafla). Zwraca
 * { objects, shadowCasters, materials } – materials: do ustawiania położenia kamery (krzywizna).
 */
export function landmarksFromArrays(a, atmo, clouds, plane, worldShadow, shared) {
	const objects = [], shadowCasters = [];
	if (a.body.count) {
		const geo = litGeometry(a.body);
		const m = new Mesh(geo, (shared.body ??= makeLitMaterial({ atmo, clouds, plane, worldShadow })));
		const s = new Mesh(geo, (shared.bodyShadow ??= makeLitMaterial({ atmo, clouds, plane, worldShadow: null })));
		s.layers.set(CASTER_LAYER);
		s.layers.enable(CASTER_NEAR);
		objects.push(m);
		shadowCasters.push(s);
	}
	if (a.rotor.count) {
		const r = a.rotor, geo = new BufferGeometry();
		geo.setAttribute('position', new BufferAttribute(r.pos, 3));
		geo.setAttribute('normal', new BufferAttribute(r.nrm, 3));
		geo.setAttribute('aColor', new BufferAttribute(r.col, 3));
		geo.setAttribute('aTop', new BufferAttribute(r.top, 3));
		geo.setAttribute('aSpin', new BufferAttribute(r.spin, 1));
		geo.setIndex(new BufferAttribute(r.idx, 1));
		const m = new Mesh(geo, (shared.rotor ??= makeRotorMaterial(atmo, clouds, plane, worldShadow)));
		const s = new Mesh(geo, (shared.rotorShadow ??= makeRotorMaterial(atmo, clouds, plane, null, true)));
		m.userData.rotor = s.userData.rotor = true; // położenie w atrybucie aTop (pozycje lokalne)
		s.layers.set(CASTER_LAYER);
		objects.push(m);
		shadowCasters.push(s);
	}
	for (const o of [...objects, ...shadowCasters]) o.frustumCulled = false;
	return { objects, shadowCasters };
}

/** Kamera dla wspólnych materiałów punktów orientacyjnych (krzywizna Ziemi). */
export function updateLandmarkMaterials(shared, cx, cz) {
	for (const k of ['body', 'bodyShadow', 'rotor', 'rotorShadow']) shared[k]?.userData.camXZ?.value.set(cx, cz);
}

/**
 * Światła przeszkodowe wszystkich kafli w jednym sprite z instancjami (stała pojemność, przebudowa przy zmianie
 * zestawu kafli – bez nowych materiałów).
 */
export class BeaconSet {
	constructor(scene, camXZ, pixelAngle, capacity = 4096) {
		this.cap = capacity;
		this.pos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
		this.phase = new InstancedBufferAttribute(new Float32Array(capacity), 1);
		this.pos.setUsage(DynamicDrawUsage);
		this.phase.setUsage(DynamicDrawUsage);
		this.sprite = new Sprite(beaconMaterial(this.pos, this.phase, camXZ, pixelAngle));
		this.sprite.count = 0;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 16;
		scene.add(this.sprite);
		this.byChunk = new Map();
		this.dirty = false;
	}
	set(key, list) { if (list?.length) this.byChunk.set(key, list); else this.byChunk.delete(key); this.dirty = true; }
	remove(key) { if (this.byChunk.delete(key)) this.dirty = true; }
	/** Przesunięcie początku układu: współrzędne świateł o (dx, dz). */
	shift(dx, dz) { for (const l of this.byChunk.values()) for (const p of l) { p[0] -= dx; p[2] -= dz; } this.dirty = true; }
	update() {
		if (!this.dirty) return;
		this.dirty = false;
		let n = 0;
		const P = this.pos.array, F = this.phase.array;
		for (const l of this.byChunk.values()) for (const p of l) {
			if (n >= this.cap) break;
			P[n * 3] = p[0]; P[n * 3 + 1] = p[1]; P[n * 3 + 2] = p[2];
			F[n] = beaconPhase(p);
			n++;
		}
		this.pos.needsUpdate = this.phase.needsUpdate = true;
		this.sprite.count = n;
	}
}

