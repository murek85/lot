// Samolot w scenie: model, światła zgodne z atmosferą (słońce po przejściu przez powietrze i światło nieba),
// cień własny (mapa cieni Three.js tylko dla samolotu) i cień na terenie: sylwetka samolotu widziana od słońca,
// rozmywana z wysokością – jak półcień od tarczy słońca (0,53°), więc wysoko zostaje tylko blada plama.
import {
	Scene, DirectionalLight, HemisphereLight, OrthographicCamera, RenderTarget, MeshBasicNodeMaterial, Vector3, Matrix4, Color,
	LinearFilter, UnsignedByteType,
} from 'three/webgpu';
import { uniform, texture, vec2, vec4, float, clamp, max, smoothstep } from 'three/tsl';
import { aircraftById } from './aircraft.js';
import { PlaneLights } from './lights.js';
import { transmittance, ATMOSPHERE } from '../atmosphere/model.js';

const SIL = 30; // bok obszaru sylwetki (m)
const half = (b) => {
	const e = (b >> 10) & 31, m = b & 1023;
	return e === 0 ? m / 16777216 : Math.pow(2, e - 15) * (1 + m / 1024);
};

export class Plane {
	constructor(renderer, scene, atmo) {
		this.renderer = renderer;
		this.scene = scene;
		this.silScene = new Scene();
		this.atmo = atmo;
		this.models = new Map(); // zbudowane modele (przełączanie bez ponownej budowy)
		this.type = null;
		this.setAircraft('dromader');

		this.sun = new DirectionalLight(0xffffff, 10);
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set(2048, 2048);
		const sc = this.sun.shadow.camera;
		sc.left = sc.bottom = -11;
		sc.right = sc.top = 11;
		sc.near = 1;
		sc.far = 80;
		this.sun.shadow.bias = -0.0004;
		this.sun.shadow.normalBias = 0.03;
		this.sun.target = this.model;
		this.sky = new HemisphereLight(0x8899bb, 0x445533, 1);
		scene.add(this.sun, this.sky);
		renderer.shadowMap.enabled = true;

		// sylwetka od strony słońca
		this.silRT = new RenderTarget(256, 256, { type: UnsignedByteType });
		this.silRT.texture.minFilter = this.silRT.texture.magFilter = LinearFilter;
		this.silCam = new OrthographicCamera(-SIL / 2, SIL / 2, SIL / 2, -SIL / 2, 1, 400);
		this.silCam.layers.set(1);
		this.white = new MeshBasicNodeMaterial({ color: 0xffffff });
		this.silMatrix = uniform(new Matrix4());
		this.planePos = uniform(new Vector3());
		this.silTex = texture(this.silRT.texture);
		this.skyE = new Color(0.15, 0.25, 0.6);
		this._frame = 0;
		this._reading = false;
	}

	/** Zmiana samolotu: model budowany przy pierwszym wyborze, światła przepinane (te same lampy i uniformy). */
	setAircraft(id) {
		const spec = aircraftById(id);
		if (this.type === spec.id) return spec;
		if (this.model) this.scene.remove(this.model);
		let model = this.models.get(spec.id);
		if (!model) {
			model = spec.build(this.atmo);
			model.traverse((o) => o.layers.enable(1));
			this.models.set(spec.id, model);
		}
		this.model = model;
		this.scene.add(model);
		if (this.sun) this.sun.target = model;
		if (this.lights) this.lights.attach(model);
		else this.lights = new PlaneLights(this.scene, model);
		this.cockpit = model.userData.cockpit;
		this.type = spec.id;
		this.spec = spec;
		return spec;
	}

	/** Cień samolotu na ziemi w punkcie p (świat): 1 – słońce, mniej – cień. Do materiału terenu. */
	groundShadow(p) {
		const sun = this.atmo.u.lightDir;
		const clip = this.silMatrix.mul(vec4(p, 1));
		const uvS = vec2(clip.x.mul(0.5).add(0.5), float(0.5).sub(clip.y.mul(0.5)));
		const height = max(0, this.planePos.y.sub(p.y)).div(max(sun.y, 0.1));
		// półcień: promień ~ wysokość · tg(0,27°) + 0,25 m, w jednostkach tekstury sylwetki
		const r = height.mul(0.0047).add(0.25).div(SIL);
		const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
		let occ = float(0);
		for (const [a, b] of taps) occ = occ.add(this.silTex.sample(uvS.add(vec2(a, b).mul(r))).level(0).r);
		occ = occ.div(taps.length);
		const inside = smoothstep(0, 0.02, uvS.x).mul(smoothstep(0.98, 1, uvS.x).oneMinus()).mul(smoothstep(0, 0.02, uvS.y)).mul(smoothstep(0.98, 1, uvS.y).oneMinus());
		// zostaje światło rozproszone wokół tarczy – cień nigdy nie jest całkiem czarny, a wysoko blednie
		return float(1).sub(clamp(occ.mul(inside), 0, 1).mul(0.85));
	}

	/** Ustawia model według stanu lotu i odświeża światła oraz sylwetkę cienia. */
	/** sunDir – główne światło (słońce albo nocą księżyc), keyE – jego natężenie poza atmosferą, keyTint – barwa. */
	update(s, dt, sunDir, haze, rpm, controls = { roll: 0, pitch: 0, yaw: 0 }, keyE = ATMOSPHERE.sunIlluminance, keyTint = [1, 1, 1]) {
		const m = this.model;
		m.position.set(s.x, s.y, s.z);
		m.rotation.set(s.gamma + s.alpha, -s.heading, -s.bank, 'YXZ');
		m.updateMatrixWorld(true);
		m.userData.animate(dt, rpm, controls, s.speed);

		// słońce: kolor i natężenie po drodze przez atmosferę do wysokości samolotu
		const T = transmittance(Math.max(0, s.y / 1000), sunDir.y, { ...ATMOSPHERE, haze });
		const vis = Math.min(1, Math.max(0, (sunDir.y + 0.01) / 0.03));
		const E = keyE * vis;
		for (let i = 0; i < 3; i++) T[i] *= keyTint[i];
		const peak = Math.max(T[0], T[1], T[2], 1e-4);
		this.sun.color.setRGB(T[0] / peak, T[1] / peak, T[2] / peak);
		this.sun.intensity = E * peak;
		this.sun.position.copy(m.position).addScaledVector(sunDir, 40);
		// niebo: odczyt natężenia z GPU co kilkadziesiąt klatek (asynchronicznie)
		if (++this._frame % 30 === 1 && !this._reading) {
			this._reading = true;
			this.renderer.readRenderTargetPixelsAsync(this.atmo.irradianceRT, 0, 0, 1, 1).then((px) => {
				this.skyE.setRGB(half(px[0]), half(px[1]), half(px[2]));
			}).catch(() => {}).finally(() => (this._reading = false));
		}
		const skyMax = Math.max(this.skyE.r, this.skyE.g, this.skyE.b, 1e-4);
		this.sky.color.setRGB(this.skyE.r / skyMax, this.skyE.g / skyMax, this.skyE.b / skyMax);
		this.sky.groundColor.setRGB(0.55 * T[0] / peak, 0.6 * T[1] / peak, 0.4 * T[2] / peak);
		this.sky.intensity = skyMax * 0.9;
		this.sky.groundColor.multiplyScalar(Math.min(1, (E * peak * Math.max(0, sunDir.y) * 0.13) / Math.max(1e-4, this.sky.intensity)));

		// sylwetka od słońca (tylko warstwa 1 – samolot), materiał zastąpiony białym
		const c = this.silCam;
		c.position.copy(m.position).addScaledVector(sunDir, 200);
		c.up.set(0, 1, 0);
		if (Math.abs(sunDir.y) > 0.99) c.up.set(0, 0, 1);
		c.lookAt(m.position);
		c.updateMatrixWorld();
		this.silMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
		this.planePos.value.copy(m.position);
		const saved = [];
		m.traverse((o) => { if (o.isMesh) { saved.push([o, o.material, o.visible]); o.material = this.white; } });
		const bladesWere = m.userData.blades.visible;
		m.userData.disc.visible = false;
		m.userData.blades.visible = true;
		const r = this.renderer, prev = r.getRenderTarget();
		const shadowWas = r.shadowMap.enabled;
		const clear = r.getClearColor(new Color()), clearAlpha = r.getClearAlpha();
		r.shadowMap.enabled = false;
		this.silScene.add(m);
		r.setRenderTarget(this.silRT);
		r.setClearColor(0x000000, 1);
		r.clear();
		r.render(this.silScene, c);
		r.setRenderTarget(prev);
		r.setClearColor(clear, clearAlpha);
		r.shadowMap.enabled = shadowWas;
		this.scene.add(m);
		for (const [o, mat, vis] of saved) { o.material = mat; o.visible = vis; }
		m.userData.blades.visible = bladesWere;
	}

	/** Po ustawieniu kamery: światła (błyski, poświaty) i przyrządy w kabinie. */
	updateAfterCamera(camera, s, t, dt, { rpm, hour, night, cockpit, controls, viewportH, exposure = 2.4 }) {
		// nocą ekspozycja rośnie do 5 – lampy i podświetlenie przyciemniamy, żeby nie świeciły mocniej niż o zmierzchu
		const adapt = Math.min(1, 2.4 / exposure);
		this.lights.update(camera, t, { night, rpm, throttle: s.throttle, cockpit, viewportH, adapt });
		this.model.userData.pilot.visible = !cockpit;
		this.cockpit.update(s, controls, rpm, hour, t, dt, this.lights.state, night, adapt);
	}
}
