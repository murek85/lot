// Światła samolotu: pozycyjne (czerwone lewe, zielone prawe, białe na ogonie – każde widoczne tylko w swoim
// sektorze, jak w przepisach), stroboskopy na końcówkach (podwójny błysk co sekundę), czerwony błyskacz
// antykolizyjny na stateczniku, dwa reflektory w krawędzi natarcia i żar z rur wydechowych.
// Każde światło to: świecący klosz w modelu (jasność HDR), poświata (sprite addytywny, który z daleka nie maleje
// poniżej kilku pikseli – światło widać z odległości, jak w rzeczywistości) i lampa punktowa oświetlająca
// samolot (skrzydło, kadłub, wnętrze kabiny). Reflektory oświetlają też teren (landingLight w shaderze terenu).
// Samolot może nie mieć części świateł (model.userData.noLights – np. przedwojenny myśliwiec bez stroboskopów,
// błyskacza i reflektorów): te są wygaszone, a ich klosze ukryte.
import { Group, Sprite, SpriteNodeMaterial, PointLight, AdditiveBlending, Vector3, Matrix4, Quaternion, Color } from 'three/webgpu';
import { uniform, uv, vec3, float, exp, length, abs, max, dot, smoothstep } from 'three/tsl';

const v3 = (a) => new Vector3(...a);

/** Faza błysku stroboskopu: dwa krótkie błyski (50 ms) co 1,1 s. */
export function strobeAt(t) {
	const ph = t % 1.1;
	return ph < 0.05 || (ph > 0.13 && ph < 0.18) ? 1 : 0;
}

/** Błyskacz: obracające się lustro – impuls ~0,12 s co 0,9 s. */
export function beaconAt(t) {
	const ph = (t % 0.9) / 0.9;
	return Math.exp(-(((ph - 0.12) / 0.05) ** 2));
}

export class PlaneLights {
	constructor(scene, model) {
		this.group = new Group();
		this.group.name = 'plane-lights';
		scene.add(this.group);
		this.landing = true;
		this.state = { strobeFlash: 0, beaconFlash: 0, landing: true };

		const glowMaterial = (streaks) => {
			const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
			const col = uniform(new Color(0, 0, 0));
			const p = uv().sub(0.5).mul(2);
			const r2 = dot(p, p);
			// jasny rdzeń + poświata malejąca jak 1/r² (rozproszenie w oku i na szybie), wygaszona na brzegu sprite'a
			let f = exp(r2.mul(-400)).add(float(0.012).div(r2.mul(300).add(1)));
			if (streaks) f = f.add(exp(abs(p.y).mul(-160)).mul(exp(abs(p.x).mul(-4))).mul(0.03)).add(exp(abs(p.x).mul(-160)).mul(exp(abs(p.y).mul(-7))).mul(0.012));
			// wygaszenie do zera na brzegu sprite'a – przy dużej ekspozycji (noc) nie widać krawędzi kwadratu
			const edge = float(1).sub(r2).max(0);
			m.colorNode = col.mul(f.mul(edge.mul(edge).mul(edge)));
			m.depthTest = true;
			return { m, col };
		};
		const make = (name, color, { size, minPx, streaks = false, light = null, lamp = true }) => {
			const { m, col } = glowMaterial(streaks);
			const sprite = new Sprite(m);
			sprite.frustumCulled = false;
			sprite.renderOrder = 20;
			this.group.add(sprite);
			const lampCol = uniform(new Color(0, 0, 0));
			const pl = light ? new PointLight(color, 0, light.distance, 2) : null;
			return { name, color: new Color(color), sprite, col, lampCol, anchor: new Vector3(), size, minPx, pl, light, hasLamp: lamp };
		};
		this.lights = {
			navL: make('navL', 0xff1a0c, { size: 1.2, minPx: 40, light: { distance: 5, power: 0.5, offset: [0.15, 0.05, 0] } }),
			navR: make('navR', 0x10ff50, { size: 1.2, minPx: 40, light: { distance: 5, power: 0.5, offset: [-0.15, 0.05, 0] } }),
			tail: make('tail', 0xfff4e0, { size: 1.0, minPx: 34, light: { distance: 3, power: 0.25 } }),
			strobeL: make('strobeL', 0xe8f0ff, { size: 4, minPx: 70, streaks: true, light: { distance: 14, power: 9, offset: [0.3, 0.2, 0] } }),
			strobeR: make('strobeR', 0xe8f0ff, { size: 4, minPx: 70, streaks: true, light: { distance: 14, power: 9, offset: [-0.3, 0.2, 0] } }),
			beacon: make('beacon', 0xff1808, { size: 2.5, minPx: 50, light: { distance: 9, power: 4, offset: [0, 0.15, 0] } }),
			landingL: make('landingL', 0xfff1d8, { size: 4, minPx: 60, streaks: true }),
			landingR: make('landingR', 0xfff1d8, { size: 4, minPx: 60, streaks: true }),
			exhaustL: make('exhaustL', 0xff7020, { size: 0.8, minPx: 16, lamp: false, light: { distance: 3, power: 0.35, offset: [0, -0.2, 0.3] } }),
			exhaustR: make('exhaustR', 0xff7020, { size: 0.8, minPx: 16, lamp: false }),
		};
		// lampka kabiny (ciepła, przyciemniona) – nocą rozjaśnia wnętrze
		this.cabin = new PointLight(0xffc890, 0, 2.2, 2);
		this.attach(model);

		// reflektory na terenie: jedno złożone źródło między reflektorami, wiązka w przód i lekko w dół
		this.ll = { pos: uniform(new Vector3()), dir: uniform(new Vector3(0, 0, -1)), power: uniform(0) };
		this._m = new Matrix4();
		this._q = new Quaternion();
		this._v = new Vector3();
		this._c = new Vector3();
	}

	/**
	 * Przepięcie świateł na inny model samolotu: kotwice z model.userData.anchors, lampy punktowe przenoszone do
	 * modelu (ta sama liczba lamp – shadery samolotu bez rekompilacji), klosze dostają te same uniformy koloru.
	 */
	attach(model) {
		this.model = model;
		const A = (this.anchors = model.userData.anchors);
		const lamps = model.userData.lamps;
		this.absent = new Set(model.userData.noLights ?? []);
		for (const name of this.absent) if (lamps[name]) lamps[name].visible = false;
		for (const L of Object.values(this.lights)) {
			L.anchor.set(...A[L.name]);
			if (L.pl) {
				model.add(L.pl);
				L.pl.position.copy(L.anchor).add(v3(L.light.offset ?? [0, 0, 0]));
			}
			const lamp = L.hasLamp && lamps[L.name];
			if (lamp && lamp.material.colorNode !== L.lampCol) {
				lamp.material.colorNode = L.lampCol;
				lamp.material.needsUpdate = true;
			}
		}
		model.add(this.cabin);
		this.cabin.position.set(...A.cabinLight);
	}

	/** Czy samolot ma reflektory (klawisz L i światło na terenie). */
	get hasLanding() { return !this.absent.has('landingL'); }

	/** Natężenie oświetlenia reflektorami w punkcie p (świat) o normalnej N – dla shaderów terenu. */
	landingLight(p, N) {
		const { pos, dir, power } = this.ll;
		const d = pos.sub(p);
		const dist2 = max(dot(d, d), 4);
		const L = d.div(dist2.sqrt());
		const cosA = dot(L.negate(), dir);
		const cone = smoothstep(0.95, 0.99, cosA).mul(0.8).add(smoothstep(0.8, 0.95, cosA).mul(0.2));
		return vec3(1, 0.93, 0.82).mul(power.mul(cone).mul(max(0, dot(N, L))).div(dist2));
	}

	/** Klatka: błyski, kierunki widoczności, rozmiary poświat (min. kilka pikseli), lampy punktowe. */
	update(camera, t, { night, rpm, throttle, cockpit, viewportH, adapt = 1 }) {
		const m = this.model;
		m.updateMatrixWorld();
		const strobe = strobeAt(t), beacon = beaconAt(t);
		this.state.strobeFlash = strobe;
		this.state.beaconFlash = beacon;
		this.state.landing = this.landing;
		const pxAngle = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportH;
		const camLocal = this._c.copy(camera.position);
		m.worldToLocal(camLocal);
		const dayDim = 0.2 + 0.8 * night;
		const flicker = 0.8 + 0.2 * Math.sin(t * 37) * Math.sin(t * 23.3);
		const engine = rpm > 100 ? 1 : 0;
		for (const L of Object.values(this.lights)) {
			// kierunek od światła do kamery w układzie samolotu (sektory widoczności)
			const toCam = this._v.copy(camLocal).sub(L.anchor);
			const dist = toCam.length();
			toCam.divideScalar(Math.max(1e-3, dist));
			let lamp = 0, glow = 0, light = 0;
			switch (L.name) {
				case 'navL': case 'navR': {
					// 110° od przodu na swoją burtę
					const side = L.name === 'navL' ? -toCam.x : toCam.x;
					const sector = Math.max(0, Math.min(1, (side + 0.35) / 0.3)) * Math.max(0, Math.min(1, (-toCam.z + 0.45) / 0.3));
					lamp = 14; glow = 40 * sector * dayDim; light = 1;
					break;
				}
				case 'tail': lamp = 10; glow = 30 * Math.max(0, Math.min(1, (toCam.z - 0.3) / 0.3)) * dayDim; light = 1; break;
				case 'strobeL': case 'strobeR': lamp = 400 * strobe + 0.3; glow = 600 * strobe; light = strobe; break;
				case 'beacon': lamp = 120 * beacon + 0.4; glow = 200 * beacon * (0.5 + 0.5 * night); light = beacon; break;
				case 'landingL': case 'landingR': {
					const on = this.landing && this.hasLanding ? 1 : 0;
					const cosA = -toCam.z * 0.995 - toCam.y * 0.1;
					lamp = 220 * on; glow = on * (700 * Math.pow(Math.max(0, cosA), 30) + 25 * Math.max(0, cosA)) * (0.25 + 0.75 * night);
					break;
				}
				default: { // wydech: żar widoczny nocą, migocący z gazem
					const a = engine * (0.25 + throttle) * flicker;
					glow = 14 * a * night; light = a * night;
				}
			}
			if (cockpit && (L.name === 'tail' || L.name === 'beacon')) glow *= 0; // z kabiny poza widokiem
			if (this.absent.has(L.name)) lamp = glow = light = 0;
			L.lampCol.value.copy(L.color).multiplyScalar(lamp);
			L.col.value.copy(L.color).multiplyScalar(glow * adapt);
			L.sprite.visible = glow > 1e-3;
			if (L.sprite.visible) {
				// poświata nieco przed kloszem (ku kamerze) – nie przenika z nim, rozmiar nie mniejszy niż minPx
				const wp = this._v.copy(L.anchor);
				m.localToWorld(wp);
				const camDist = wp.distanceTo(camera.position);
				const toward = camera.position.clone().sub(wp).normalize().multiplyScalar(Math.min(0.25, camDist * 0.3));
				L.sprite.position.copy(wp).add(toward);
				const s = Math.max(L.size, camDist * pxAngle * L.minPx);
				L.sprite.scale.set(s, s, 1);
			}
			if (L.pl) L.pl.intensity = L.light.power * light;
		}
		this.cabin.intensity = 0.012 * night * adapt;
		// reflektory: środek między lampami, wiązka 6° w dół względem osi samolotu
		const ll = this.ll;
		ll.pos.value.set(0, this.anchors.landingL[1], this.anchors.landingL[2]).applyMatrix4(m.matrixWorld);
		m.getWorldQuaternion(this._q);
		ll.dir.value.set(0, -Math.sin(0.16), -Math.cos(0.16)).applyQuaternion(this._q);
		ll.power.value = this.landing && this.hasLanding ? 60000 : 0;
	}
}
