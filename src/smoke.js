// Dym i para: smugi z kominów przemysłowych (szary dym), chłodni (gęsta biała para) i – zimą – z kominów domów.
// Każde źródło to kilkanaście kłębów; wiek kłębu liczy shader z czasu (bez symulacji na CPU): kłąb rośnie, unosi się
// (przy silnym wietrze niżej) i płynie z wiatrem (TREE_WIND), na końcu się rozwiewa. Osobna scena nakładana po
// wygładzaniu (jak odległe ptaki, src/fauna/birddots.js) – miękkie kłęby widać też na tle nieba; zasłanianie z głębi
// sceny, perspektywa powietrzna liczona w wierzchołkach.
import { Sprite, SpriteNodeMaterial, InstancedBufferAttribute, NormalBlending, Vector2 } from 'three/webgpu';
import {
	Fn, vec2, vec3, vec4, float, uniform, instancedBufferAttribute, varying, uv, dot, max, sin, cos, exp, length, smoothstep, clamp, fract,
	cameraPosition, cameraViewMatrix, screenUV, getViewPosition, If, Discard, time, select, mix,
} from 'three/tsl';
import { onGround } from './gfx/ground.js';
import { valueNoise } from './gfx/noise.js';
import { TREE_WIND } from './forest.js';
import { SMOKE } from './gen/osmtags.js';

const STRIDE = 5; // źródło: x, y, z, rodzaj, promień wylotu
const HOUSE_R = 2500; // m – dym z domów tylko wokół kamery (z dalszych i tak kłęby mniejsze od piksela)
// na rodzaj: kłęby, czas życia (s), wzniesienie (m), wzrost (× promień), krycie, barwa, zasięg widoczności (m)
const KINDS = {
	[SMOKE.chimney]: { puffs: 24, life: 70, rise: 90, grow: 14, alpha: 0.6, col: [0.5, 0.49, 0.47], reach: 45000 },
	[SMOKE.steam]: { puffs: 24, life: 45, rise: 220, grow: 4.5, alpha: 0.9, col: [0.95, 0.95, 0.96], reach: 60000 },
	[SMOKE.house]: { puffs: 16, life: 24, rise: 24, grow: 8, alpha: 0.95, col: [0.2, 0.2, 0.21], reach: 2500 },
};

export class SmokeSet {
	constructor(atmo, pixelAngle, cap = 80000) {
		this.atmo = atmo;
		this.pixelAngle = pixelAngle;
		this.cap = cap;
		this.camXZ = uniform(new Vector2());
		this.houses = uniform(0); // dym z domów 0..1 (zima, chłodne jesienne wieczory)
		this.src = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); // x, y, z, promień
		this.par = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); // rodzaj, numer kłębu / kłęby, los, –
		this.src.setUsage(35048); this.par.setUsage(35048);
		this.byChunk = new Map();
		this.dirty = false;
	}

	set(key, list) { if (list?.length) this.byChunk.set(key, list); else this.byChunk.delete(key); this.dirty = true; }
	remove(key) { if (this.byChunk.delete(key)) this.dirty = true; }
	shift(dx, dz) { for (const l of this.byChunk.values()) for (let i = 0; i < l.length; i += STRIDE) { l[i] -= dx; l[i + 2] -= dz; } this.dirty = true; }

	/** Głębia sceny z przebiegu kamery (zasłanianie); scene – scena nakładki. */
	build(depthNode, projInv, scene) {
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: NormalBlending });
		const S = instancedBufferAttribute(this.src), Pr = instancedBufferAttribute(this.par);
		const kind = Pr.x, seed = Pr.z;
		const isSteam = kind.equal(SMOKE.steam), isHouse = kind.equal(SMOKE.house);
		const k = (f) => select(isSteam, float(KINDS[SMOKE.steam][f]), select(isHouse, float(KINDS[SMOKE.house][f]), float(KINDS[SMOKE.chimney][f])));
		const life = k('life').mul(mix(float(0.85), float(1.15), seed));
		const age = fract(time.div(life).add(Pr.y).add(seed.mul(7.31)));
		// wiatr (m/s): przy ciszy lekki dryf w losową stronę; silny wiatr kładzie smugę
		const w = TREE_WIND.v.add(vec2(cos(seed.mul(40)), sin(seed.mul(40))).mul(0.4));
		const ws = length(w);
		const t = age.mul(life);
		const rise = k('rise').div(ws.mul(0.18).add(1)).mul(float(1).sub(exp(age.mul(-3.5)))).add(t.mul(0.15));
		const r = S.w.mul(float(1.5).add(age.mul(k('grow'))));
		// zawirowania w poprzek wiatru, rosnące z wiekiem
		const wob = sin(t.mul(0.35).add(seed.mul(60))).mul(r).mul(0.5);
		const side = vec2(w.y.negate(), w.x).div(max(ws, 0.1));
		const off = w.mul(t).add(side.mul(wob));
		const world = onGround(vec3(S.x.add(off.x), S.y.add(rise).add(r.mul(0.5)), S.z.add(off.y)), this.camXZ);
		m.positionNode = world;
		m.scaleNode = vec2(r.mul(2), r.mul(2));
		m.rotationNode = seed.mul(31).add(age.mul(0.6));
		const dist = length(cameraPosition.sub(world));
		const houseOn = select(isHouse, this.houses, float(1));
		// pojawia się u wylotu, rozwiewa na końcu; za daleko (kłąb mniejszy od piksela) – znika
		const fade = smoothstep(0, 0.06, age).mul(float(1).sub(age).pow(1.4)).mul(k('alpha')).mul(houseOn)
			.mul(float(1).sub(smoothstep(0.5, 0.8, dist.div(k('reach'))))).mul(smoothstep(0.6, 2, r.mul(2).div(dist.mul(this.pixelAngle))));
		const vFade = varying(fade, 'vSmkFade');
		const vSeed = varying(seed.add(Pr.y), 'vSmkSeed');
		const vViewZ = varying(cameraViewMatrix.mul(vec4(world, 1)).z, 'vSmkViewZ');
		// światło: słońce (z dołu kłębu ciemniej) i niebo; perspektywa powietrzna w wierzchołkach
		const sun = this.atmo.u.lightDir;
		const vSun = varying(this.atmo.sunLight(world.y).mul(smoothstep(-0.04, 0.04, sun.y)).mul(0.6), 'vSmkSun'); // kłąb rozprasza światło ze wszystkich stron – bez cosinusa
		const air = this.atmo.aerial(cameraPosition.y, world.sub(cameraPosition));
		const vIns = varying(air.inscatter, 'vSmkIns'), vT = varying(air.transmittance, 'vSmkT');
		const vCol = varying(select(isSteam, vec3(...KINDS[SMOKE.steam].col), select(isHouse, vec3(...KINDS[SMOKE.house].col), vec3(...KINDS[SMOKE.chimney].col))), 'vSmkCol');
		m.colorNode = Fn(() => {
			const d = depthNode.sample(screenUV).r;
			const sceneZ = getViewPosition(screenUV, d, projInv).z;
			If(d.greaterThan(0).and(vViewZ.lessThan(sceneZ)), () => { Discard(); });
			const q = uv().sub(0.5).mul(2);
			const n = valueNoise(uv().mul(3.2).add(vSeed.mul(17))).mul(0.6).add(valueNoise(uv().mul(7).add(vSeed.mul(5))).mul(0.4));
			const a = clamp(float(1).sub(dot(q, q)).mul(n.mul(1.6)), 0, 1).mul(vFade);
			If(a.lessThan(0.004), () => { Discard(); });
			const shade = uv().y.mul(0.35).add(0.65);
			const light = vSun.mul(shade).add(this.atmo.skyIrradiance()).div(Math.PI);
			return vec4(vCol.mul(light).mul(vT).add(vIns), a);
		})();
		this.sprite = new Sprite(m);
		this.sprite.count = 0;
		this.sprite.frustumCulled = false;
		scene.add(this.sprite);
	}

	/**
	 * Kamera (krzywizna), dym z domów 0..1; przebudowa kłębów po zmianie zestawu źródeł albo po przelocie ~600 m:
	 * najpierw kominy i chłodnie (widać je z daleka), potem domy do HOUSE_R od kamery.
	 */
	update(camera, houses) {
		const cx = camera.position.x, cz = camera.position.z;
		this.camXZ.value.set(cx, cz);
		this.houses.value = houses;
		if (!this.sprite) return;
		const moved = houses > 0 && (this.at ? Math.hypot(cx - this.at[0], cz - this.at[1]) > 600 : true);
		const toggled = (houses > 0) !== this.housesOn; // zima przyszła albo minęła – domy do dodania albo usunięcia
		if (!this.dirty && !moved && !toggled) return;
		this.dirty = false;
		this.housesOn = houses > 0;
		this.at = [cx, cz];
		const Sa = this.src.array, Pa = this.par.array;
		let n = 0;
		for (const pass of [0, 1]) {
			for (const l of this.byChunk.values()) for (let i = 0; i < l.length; i += STRIDE) {
				const kind = l[i + 3], K = KINDS[kind];
				if (!K || (kind === SMOKE.house) !== (pass === 1) || n + K.puffs > this.cap) continue;
				if (pass === 1 && (houses <= 0 || Math.hypot(l[i] - cx, l[i + 2] - cz) > HOUSE_R)) continue;
				const seed = (Math.abs(Math.sin(l[i] * 12.9898 + l[i + 2] * 78.233)) * 43758.5453) % 1;
				for (let p = 0; p < K.puffs; p++, n++) {
					Sa[n * 4] = l[i]; Sa[n * 4 + 1] = l[i + 1]; Sa[n * 4 + 2] = l[i + 2]; Sa[n * 4 + 3] = Math.max(0.3, l[i + 4]);
					Pa[n * 4] = kind; Pa[n * 4 + 1] = p / K.puffs; Pa[n * 4 + 2] = seed; Pa[n * 4 + 3] = 0;
				}
			}
		}
		this.sprite.count = n;
		this.sprite.visible = n > 0;
		this.src.needsUpdate = this.par.needsUpdate = true;
	}
}
