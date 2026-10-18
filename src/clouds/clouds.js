// Chmury wolumetryczne (cumulusy): warstwa między dwiema sferami nad Ziemią, gęstość z mapy pogody i szumów 3D,
// marsz promienia z oświetleniem słońcem (po atmosferze), niebem i przybliżeniem rozpraszania wielokrotnego.
// Liczone w połowie rozdzielczości, z drganiem kroku i akumulacją czasową (reprojekcja z poprzedniej klatki).
// Wynik: rgb – światło chmur z mgiełką przed nimi, a – przepuszczalność (ile widać tła za chmurą).
import {
	RenderTarget, HalfFloatType, LinearFilter, RepeatWrapping, Data3DTexture, DataTexture, RedFormat, RGFormat, UnsignedByteType,
	NodeMaterial, QuadMesh, Vector2, Vector3, Matrix4,
} from 'three/webgpu';
import {
	Fn, float, vec2, vec3, vec4, uniform, uv, texture, texture3D, Loop, If, Break, int, exp, max, min, clamp, mix, smoothstep,
	normalize, dot, sqrt, select, abs, getViewPosition, screenCoordinate, interleavedGradientNoise, fract,
} from 'three/tsl';
import { shapeNoise, detailNoise, weatherMap } from './noise3d.js';

const EARTH_R = 6371000;
const PI = Math.PI;

function tex3d(data, n) {
	const t = new Data3DTexture(data, n, n, n);
	t.format = RedFormat;
	t.type = UnsignedByteType;
	t.minFilter = t.magFilter = LinearFilter;
	t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
	t.unpackAlignment = 1;
	t.needsUpdate = true;
	return t;
}

export class Clouds {
	constructor(renderer, atmo, camera) {
		this.renderer = renderer;
		this.atmo = atmo;
		this.camera = camera;
		const W = 512;
		const weather = new DataTexture(weatherMap(W), W, W, RGFormat, UnsignedByteType);
		weather.minFilter = weather.magFilter = LinearFilter;
		weather.wrapS = weather.wrapT = RepeatWrapping;
		weather.needsUpdate = true;
		this.shapeTex = texture3D(tex3d(shapeNoise(64), 64));
		this.detailTex = texture3D(tex3d(detailNoise(32), 32));
		this.weatherTex = texture(weather);

		this.u = {
			base: uniform(1500), // m n.p.m.
			thickness: uniform(1600),
			coverage: uniform(0.42),
			extinction: uniform(0.12), // 1/m przy gęstości 1
			wind: uniform(new Vector2()), // przesunięcie pogody, m
			origin: uniform(new Vector2()), // przesunięcie początku układu (otwarty świat), m
			frame: uniform(0),
			camPos: uniform(new Vector3()),
			projInv: uniform(new Matrix4()),
			camWorld: uniform(new Matrix4()),
			prevViewProj: uniform(new Matrix4()),
			history: uniform(0), // 0 = pierwsza klatka (bez historii)
			ambient: uniform(0.5), // światło nieba
			multi: uniform(0.35), // siła rozpraszania wielokrotnego
			sunGain: uniform(2.0), // jasność słońca w chmurach
			texel: uniform(new Vector2(0.5, 0.5)), // rozmiar teksela bufora chmur (uv)
		};
		this.windVelocity = new Vector2(7, 2.5); // m/s – z zachodu
		this.setSize(2, 2);
		this._build();
	}

	setSize(w, h) {
		const cw = Math.max(1, Math.floor(w / 2)), ch = Math.max(1, Math.floor(h / 2));
		if (this.rtA && this.rtA.width === cw && this.rtA.height === ch) return;
		this.rtA?.dispose();
		this.rtB?.dispose();
		const make = () => {
			const rt = new RenderTarget(cw, ch, { type: HalfFloatType, depthBuffer: false });
			rt.texture.minFilter = rt.texture.magFilter = LinearFilter;
			rt.texture.generateMipmaps = false;
			return rt;
		};
		this.rtA = make();
		this.rtB = make();
		if (this.u) this.u.texel.value.set(1 / cw, 1 / ch);
		this.u.history.value = 0;
	}

	/** Gęstość 0..1 w punkcie p (świat, metry); cheap – bez detalu (na marsz w stronę słońca i cienie). */
	density(p, height, cheap) {
		const U = this.u;
		const q = p.xz.add(U.wind).add(U.origin);
		const w = this.weatherTex.sample(q.div(36000)).level(0);
		const cov = clamp(w.r.sub(float(1).sub(U.coverage).sub(0.1)).div(0.32), 0, 1);
		const h = height.sub(U.base).div(U.thickness);
		// profil cumulusa: płaska podstawa, kopuła – im mniejszy zasięg w danym miejscu, tym niższy wierzchołek
		const top = mix(float(0.3), float(1.0), w.g).mul(cov.sqrt());
		const grad = smoothstep(0.0, 0.06, h).mul(smoothstep(top.mul(0.4), top, h).oneMinus());
		const shapeP = vec3(q.x, height.mul(1.6), q.y).div(2200);
		const s = this.shapeTex.sample(shapeP).level(0).r;
		const shape = clamp(s.sub(0.4).div(0.5), 0, 1);
		// kształt „wycina” kłęby z kopuły; zasięg przesuwa próg
		const d0 = clamp(shape.mul(grad).sub(float(1).sub(cov.mul(0.92))).div(max(cov.mul(0.92), 0.02)), 0, 1);
		if (cheap) return d0;
		// detal: drobne kalafiorowate kłęby u góry, strzępy u podstawy
		const dp = vec3(q.x, height.mul(1.3), q.y).add(vec3(0, U.wind.x.mul(0.4), 0)).div(330);
		const detail = this.detailTex.sample(dp).level(0).r;
		const erode = mix(detail.oneMinus(), detail, smoothstep(0.05, 0.4, h)).mul(0.6);
		return clamp(d0.sub(erode.mul(float(1).sub(d0))).div(float(1).sub(erode.mul(0.6))).mul(1.6), 0, 1);
	}

	_build() {
		const U = this.u, atmo = this.atmo;
		const self = this;
		const hg = (g, c) => {
			const g2 = g * g;
			return float((1 - g2) / (4 * PI)).div(float(1 + g2).sub(c.mul(2 * g)).pow(1.5));
		};
		// Przecięcie promienia z kamery (na wysokości hc) ze sferą o promieniu R + H, w postaci odpornej na float32:
		// c = (R+hc)² − (R+H)² liczone jako iloczyn różnicy, pierwiastki z q i c/q. Zwraca (bliższe, dalsze) albo (-1, -1).
		const shell = (hc, dy, H) => {
			const b = float(EARTH_R).add(hc).mul(dy);
			const cc = hc.sub(H).mul(hc.add(H).add(2 * EARTH_R));
			const disc = b.mul(b).sub(cc);
			const s = sqrt(max(0, disc));
			const q = b.negate().sub(select(b.greaterThanEqual(0), s, s.negate()));
			const r1 = q, r2 = cc.div(select(abs(q).greaterThan(1e-3), q, float(1e-3)));
			return select(disc.greaterThan(0), vec2(min(r1, r2), max(r1, r2)), vec2(-1, -1));
		};

		const cloudFn = Fn(() => {
			const st = uv();
			const viewPos = getViewPosition(st, float(0.5), U.projInv);
			const dir = normalize(U.camWorld.mul(vec4(viewPos, 0)).xyz);
			const hc = U.camPos.y;
			const top = U.base.add(U.thickness);
			const sIn = shell(hc, dir.y, U.base), sOut = shell(hc, dir.y, top), sG = shell(hc, dir.y, float(0));
			// odcinek promienia w warstwie (wyrażenia zamiast zagnieżdżonych If – prościej i bez pułapek TSL):
			// pod warstwą – od podstawy do wierzchołka, o ile promień nie trafia wcześniej w ziemię;
			// nad warstwą – od wierzchołka do podstawy albo wyjścia; w środku – od kamery do wyjścia
			const below = hc.lessThan(U.base), above = hc.greaterThan(top);
			const exitDown = select(sIn.x.greaterThan(0), sIn.x, sOut.y);
			const okBelow = sG.x.lessThan(0), okAbove = sOut.x.greaterThan(0);
			const t0 = select(below, select(okBelow, sIn.y, float(0)), select(above, select(okAbove, sOut.x, float(0)), float(0)));
			const t1raw = select(below, select(okBelow, sOut.y, float(0)), select(above, select(okAbove, exitDown, float(0)), exitDown));
			// głębia sceny: chmura za samolotem (czy za zboczem) nie może go zasłonić
			const sceneDist = float(1e9).toVar();
			if (self.sceneDepth) {
				const dS = self.sceneDepth.sample(st).level(0).r;
				sceneDist.assign(select(dS.greaterThan(0), getViewPosition(st, dS, U.projInv).length(), float(1e9)));
			}
			const t1 = min(min(t1raw, t0.add(60000)), sceneDist);
			// przeszkoda w warstwie; blisko kamery to zwykle sam samolot – porusza się z kamerą, więc reprojekcja
			// historii po głębi chmury trafia w poprzedniej klatce gdzie indziej (smugi chmur na kabinie przy skręcie)
			const clipped = sceneDist.lessThan(min(t1raw, t0.add(60000)));
			const nearGeo = clipped.and(sceneDist.lessThan(400));

			const L = vec3(0).toVar(), T = float(1).toVar(), depthSum = float(0).toVar(), wSum = float(0).toVar();
			const sun = atmo.u.lightDir;
			const cosT = dot(dir, sun);
			// fazy dla trzech „oktaw” rozpraszania wielokrotnego (Wrenninge): coraz mniej kierunkowe
			const ph0 = mix(hg(0.8, cosT), hg(-0.25, cosT), 0.25);
			const ph1 = mix(hg(0.4, cosT), hg(-0.12, cosT), 0.25);
			const ph2 = float(1 / (4 * PI));
			const skyE = atmo.skyIrradiance();
			const N = 110;
			const seg = t1.sub(t0);
			If(seg.greaterThan(1), () => {
				// krok rośnie z odległością (40 m przy kamerze, do 400 m daleko); drganie startu rozbija warstwice
				const jitter = fract(interleavedGradientNoise(screenCoordinate.xy).add(U.frame.mul(0.618034)));
				const stepAt = (tt) => clamp(tt.mul(0.018).add(40), 40, 400);
				const t = t0.add(stepAt(t0).mul(jitter)).toVar();
				Loop({ start: int(0), end: int(N) }, () => {
					If(t.greaterThan(t1), () => { Break(); });
					const dt = stepAt(t);
					const p = U.camPos.add(dir.mul(t));
					const dxz = p.xz.sub(U.camPos.xz);
					const height = p.y.sub(dot(dxz, dxz).div(2 * EARTH_R)); // wysokość nad zakrzywioną Ziemią
					const d = self.density(p, height, t.greaterThan(25000)).toVar();
					If(d.greaterThan(0.003), () => {
						const sigma = d.mul(U.extinction);
						// marsz w stronę słońca: 5 coraz dłuższych kroków
						const od = float(0).toVar();
						const ls = [60, 140, 260, 480, 900];
						let prev = 0;
						for (const s of ls) {
							const mid = (prev + s) / 2;
							const lp = p.add(sun.mul(mid));
							od.addAssign(self.density(lp, height.add(sun.y.mul(mid)), true).mul(s - prev));
							prev = s;
						}
						const odS = od.mul(U.extinction);
						const sunLight = atmo.sunLight(max(0, height));
						const hRel = clamp(height.sub(U.base).div(U.thickness), 0, 1);
						const beer = exp(odS.negate()).mul(ph0)
							.add(exp(odS.mul(-0.35)).mul(ph1).mul(0.5).mul(U.multi))
							.add(exp(odS.mul(-0.12)).mul(ph2).mul(0.25).mul(U.multi));
						const powder = float(1).sub(exp(d.mul(-6))).mul(0.6).add(0.4);
						const ambient = skyE.div(PI).mul(mix(float(0.3), float(0.9), hRel)).mul(U.ambient)
							.add(sunLight.mul(max(0, sun.y)).mul(0.05).mul(float(1).sub(hRel)));
						const S = sunLight.mul(beer).mul(powder).mul(U.sunGain.mul(PI * 1.1)).add(ambient).mul(sigma);
						const tr = exp(sigma.mul(dt).negate());
						const w = T.mul(float(1).sub(tr));
						L.addAssign(T.mul(S.sub(S.mul(tr)).div(max(sigma, 1e-6))));
						depthSum.addAssign(t.mul(w));
						wSum.addAssign(w);
						T.mulAssign(tr);
					});
					t.addAssign(dt);
					If(T.lessThan(0.01), () => { Break(); });
				});
			});
			// mgiełka między kamerą a chmurą (na średniej głębokości chmury)
			const dist = select(wSum.greaterThan(1e-4), depthSum.div(max(wSum, 1e-4)), t0.add(seg.mul(0.5)));
			const { inscatter, transmittance } = atmo.aerial(U.camPos.y, dir.mul(dist));
			const alpha = float(1).sub(T);
			const current = vec4(L.mul(transmittance).add(inscatter.mul(alpha)), T);

			// akumulacja czasowa: gdzie ten punkt był na ekranie w poprzedniej klatce
			const world = U.camPos.add(dir.mul(dist));
			const clip = U.prevViewProj.mul(vec4(world, 1));
			const ndc = clip.xy.div(clip.w);
			const prevUv = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
			const inside = prevUv.x.greaterThan(0).and(prevUv.x.lessThan(1)).and(prevUv.y.greaterThan(0)).and(prevUv.y.lessThan(1)).and(clip.w.greaterThan(0));
			const hist = self.historyNode.sample(prevUv).level(0);
			// historia z piksela zasłoniętego w poprzedniej klatce (a = 2) nie zna chmury – odsłonięte zaczynają od zera
			const valid = inside.and(U.history.greaterThan(0.5)).and(hist.a.lessThan(1.5));
			const k = select(valid, select(nearGeo, float(0.5), float(0.9)), float(0));
			// całkiem zasłonięte (samolot / zbocze przed warstwą) – brak chmury, bez historii; a = 2 to znacznik
			return select(seg.greaterThan(1), mix(current, hist, k), vec4(0, 0, 0, 2));
		});

		this.historyNode = texture(this.rtB.texture);
		const m = new NodeMaterial();
		m.fragmentNode = cloudFn();
		m.depthTest = m.depthWrite = false;
		this.quad = new QuadMesh(m);

		/** Cień chmur na ziemi w punkcie p (świat): 0 = pełny cień, 1 = słońce. Trzy próbki wzdłuż promienia słońca. */
		this.groundShadow = (p) => {
			const sun = atmo.u.lightDir;
			const sy = max(sun.y, 0.06);
			const acc = float(0).toVar();
			for (const f of [0.15, 0.4, 0.7]) {
				const hy = U.base.add(U.thickness.mul(f));
				const s = p.add(sun.mul(hy.sub(p.y).div(sy)));
				acc.addAssign(self.density(s, hy, true));
			}
			const od = acc.div(3).mul(U.extinction).mul(U.thickness.mul(0.6)).div(sy);
			return mix(float(0.12), float(1), exp(od.negate()));
		};
		this.output = texture(this.rtA.texture);
		/** Chmury w punkcie ekranu st: namiot 4×4 tekseli bufora (wygładza ziarno drgania kroku), ważony zgodnością
		 *  głębi sceny – teksele liczone na tle nie rozlewają się na krawędzie samolotu (i odwrotnie). */
		this.sample = (st) => {
			const dist = (p) => {
				const d = self.sceneDepth.sample(p).level(0).r;
				return select(d.greaterThan(0), getViewPosition(p, d, U.projInv).length(), float(1e9));
			};
			const lc = dist(st).log();
			const f = st.div(U.texel).sub(0.5);
			const base = f.floor();
			const fr = f.sub(base);
			const acc = vec4(0).toVar(), wSum = float(0).toVar();
			for (let j = -1; j <= 2; j++) {
				const wy = max(0, float(1).sub(abs(fr.y.sub(j)).div(2)));
				for (let i = -1; i <= 2; i++) {
					const wx = max(0, float(1).sub(abs(fr.x.sub(i)).div(2)));
					const p = base.add(vec2(i + 0.5, j + 0.5)).mul(U.texel);
					const wd = exp(abs(dist(p).log().sub(lc)).mul(-6)).add(1e-4);
					const w = wx.mul(wy).mul(wd);
					const c = this.output.sample(p).level(0);
					acc.addAssign(vec4(c.rgb, min(c.a, 1)).mul(w));
					wSum.addAssign(w);
				}
			}
			return acc.div(max(wSum, 1e-8));
		};
	}

	update(dt) {
		this.u.wind.value.addScaledVector(this.windVelocity, dt);
	}

	/**
	 * Przesunięcie początku układu o (dx, dz) (otwarty świat): pogoda zostaje nad tym samym miejscem Ziemi, a historia
	 * akumulacji czasowej – ważna (poprzednia macierz kamery w nowym układzie).
	 */
	shiftOrigin(dx, dz) {
		this.u.origin.value.x += dx;
		this.u.origin.value.y += dz;
		this.u.prevViewProj.value.multiply(new Matrix4().makeTranslation(dx, 0, dz));
	}

	/** Tekstura głębi sceny z przebiegu kamery – chmury liczą się tylko do najbliższej powierzchni. */
	useSceneDepth(depthTexture) {
		this.sceneDepth = texture(depthTexture);
	}

	/** Liczy chmury do bieżącego celu; przed renderem sceny (potrzebuje macierzy kamery z tej klatki). */
	render() {
		const cam = this.camera, U = this.u;
		cam.updateMatrixWorld();
		U.camPos.value.copy(cam.position);
		U.projInv.value.copy(cam.projectionMatrixInverse);
		U.camWorld.value.copy(cam.matrixWorld);
		[this.rtA, this.rtB] = [this.rtB, this.rtA];
		this.historyNode.value = this.rtB.texture;
		const r = this.renderer;
		const prev = r.getRenderTarget();
		r.setRenderTarget(this.rtA);
		this.quad.render(r);
		r.setRenderTarget(prev);
		this.output.value = this.rtA.texture;
		U.prevViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
		U.frame.value = (U.frame.value + 1) % 4096;
		U.history.value = 1;
	}
}
