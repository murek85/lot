// Fizyczna atmosfera na GPU (S. Hillaire, „A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique”, 2020): tablice przepuszczalności i rozpraszania wielokrotnego, widok nieba z wysokości kamery,
// natężenie światła nieba i perspektywa powietrzna. Jednostki: kilometry; Ziemia to kula, kamera stoi nad jej
// biegunem, a scena (metry, y = wysokość n.p.m.) jest wokół niej – krzywizna i horyzont wychodzą same.
import { RenderTarget, HalfFloatType, LinearFilter, ClampToEdgeWrapping, NodeMaterial, QuadMesh, Vector3, Matrix3 } from 'three/webgpu';
import {
	Fn, float, vec2, vec3, vec4, uniform, uv, texture, Loop, If, exp, sqrt, max, min, clamp, abs, dot, normalize, length,
	cos, sin, acos, asin, pow, select, int, floor, fract, cross, smoothstep, time, mx_fractal_noise_float,
} from 'three/tsl';
import { hash12, hash22 } from '../gfx/noise.js';
import { ATMOSPHERE } from './model.js';

const PI = Math.PI;
const TRANSMITTANCE = [256, 64];
const MULTI = [32, 32];
const SKY = [192, 108];

function lut(w, h) {
	const rt = new RenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
	const t = rt.texture;
	t.minFilter = t.magFilter = LinearFilter;
	t.wrapS = t.wrapT = ClampToEdgeWrapping;
	t.generateMipmaps = false;
	return rt;
}

export class Atmosphere {
	constructor(renderer) {
		this.renderer = renderer;
		const a = ATMOSPHERE;
		this.u = {
			Rg: uniform(a.groundRadius),
			Rt: uniform(a.topRadius),
			rayleigh: uniform(new Vector3(...a.rayleighScattering)),
			rayleighH: uniform(a.rayleighScaleHeight),
			mieScat: uniform(a.mieScattering),
			mieExt: uniform(a.mieExtinction),
			mieH: uniform(a.mieScaleHeight),
			mieG: uniform(a.mieG),
			ozone: uniform(new Vector3(...a.ozoneAbsorption)),
			ozoneC: uniform(a.ozoneCenter),
			ozoneW: uniform(a.ozoneWidth),
			albedo: uniform(a.groundAlbedo),
			haze: uniform(a.haze),
			sunDir: uniform(new Vector3(0, 1, 0)),
			sunE: uniform(a.sunIlluminance),
			// główne światło sceny (słońce, a nocą księżyc) – kierunek i natężenie RGB dla materiałów
			lightDir: uniform(new Vector3(0, 1, 0)),
			lightE: uniform(new Vector3(a.sunIlluminance, a.sunIlluminance, a.sunIlluminance)),
			moonDir: uniform(new Vector3(0, -1, 0)),
			moonE: uniform(0), // natężenie światła księżyca (do rozpraszania w atmosferze)
			moonT1: uniform(new Vector3(1, 0, 0)), // baza tarczy księżyca (poziomo i pionowo na niebie)
			moonT2: uniform(new Vector3(0, 1, 0)),
			skyToEq: uniform(new Matrix3()), // obrót sfery niebieskiej: kierunek w scenie → układ równikowy
			pixelAngle: uniform(0.0005), // kątowa wielkość piksela (gwiazdy jako punkty)
			sunRadius: uniform(a.sunAngularRadius),
			viewH: uniform(a.groundRadius + 1), // km od środka Ziemi
			aerial: uniform(a.aerialScale), // siła perspektywy powietrznej przy ziemi (1 = fizycznie)
		};
		this.transmittanceRT = lut(...TRANSMITTANCE);
		this.multiRT = lut(...MULTI);
		this.skyRT = lut(...SKY);
		this.moonSkyRT = lut(...SKY);
		this.moonSkyTex = texture(this.moonSkyRT.texture);
		this.irradianceRT = lut(1, 1);
		this.tTex = texture(this.transmittanceRT.texture);
		this.msTex = texture(this.multiRT.texture);
		this.skyTex = texture(this.skyRT.texture);
		this.irrTex = texture(this.irradianceRT.texture);
		this._build();
		this.dirty = true;
	}

	/** Zmiana zamglenia (mnożnik aerozoli) – przelicza tablice przy następnej klatce. */
	setHaze(v) {
		this.u.haze.value = v;
		this.dirty = true;
	}

	/**
	 * Noc: kierunek do księżyca i jego natężenie, główne światło sceny (kierunek, natężenie RGB), macierz sfery
	 * niebieskiej (scena → układ równikowy) i kątowa wielkość piksela.
	 */
	setNight({ moonDir, moonE, lightDir, lightE, skyToEq, pixelAngle }) {
		this.u.moonDir.value.copy(moonDir).normalize();
		const md = this.u.moonDir.value;
		this.u.moonT1.value.set(-md.z, 0, md.x).normalize(); // md × góra
		this.u.moonT2.value.crossVectors(this.u.moonT1.value, md).normalize();
		this.u.moonE.value = moonE;
		this.u.lightDir.value.copy(lightDir).normalize();
		this.u.lightE.value.copy(lightE);
		this.u.skyToEq.value.copy(skyToEq);
		this.u.pixelAngle.value = pixelAngle;
	}

	/** sunDir – kierunek do słońca (świat, y w górę); cameraY – wysokość kamery n.p.m. w metrach. */
	update(sunDir, cameraY) {
		this.u.sunDir.value.copy(sunDir).normalize();
		this.u.viewH.value = this.u.Rg.value + Math.max(0.002, cameraY / 1000);
		const r = this.renderer;
		const prev = r.getRenderTarget();
		if (this.dirty) {
			this._pass(this.transmittanceQuad, this.transmittanceRT);
			this._pass(this.multiQuad, this.multiRT);
			this.dirty = false;
		}
		// niebo rozświetlone księżycem: ta sama tablica widoku nieba, liczona dla kierunku i natężenia księżyca
		this._pass(this.moonSkyQuad, this.moonSkyRT);
		this._pass(this.skyQuad, this.skyRT);
		this._pass(this.irradianceQuad, this.irradianceRT);
		r.setRenderTarget(prev);
	}

	_pass(quad, rt) {
		this.renderer.setRenderTarget(rt);
		quad.render(this.renderer);
	}

	// ---------- funkcje TSL do użytku w innych shaderach ----------

	_build() {
		const U = this.u;
		const self = this;

		const rayleighD = (h) => exp(h.negate().div(U.rayleighH));
		const mieD = (h) => exp(h.negate().div(U.mieH));
		const ozoneD = (h) => max(0, float(1).sub(abs(h.sub(U.ozoneC)).div(U.ozoneW)));
		const rayleighScat = (h) => U.rayleigh.mul(rayleighD(h));
		const mieScat = (h) => U.mieScat.mul(U.haze).mul(mieD(h));
		const extinctionAt = (h) => U.rayleigh.mul(rayleighD(h)).add(U.mieExt.mul(U.haze).mul(mieD(h))).add(U.ozone.mul(ozoneD(h)));

		const phaseRayleigh = (c) => float(3 / (16 * PI)).mul(c.mul(c).add(1));
		const phaseMie = (c) => {
			const g = U.mieG, g2 = g.mul(g);
			const k = float(3 / (8 * PI)).mul(float(1).sub(g2)).div(g2.add(2));
			return k.mul(c.mul(c).add(1)).div(pow(max(1e-4, g2.add(1).sub(g.mul(c).mul(2))), 1.5));
		};

		// Odległość do górnej granicy atmosfery / do Ziemi (lub -1, gdy jej nie trafia).
		const distTop = (r, mu) => max(0, r.negate().mul(mu).add(sqrt(max(0, r.mul(r).mul(mu.mul(mu).sub(1)).add(U.Rt.mul(U.Rt))))));
		const groundDisc = (r, mu) => r.mul(r).mul(mu.mul(mu).sub(1)).add(U.Rg.mul(U.Rg));
		const distGround = (r, mu) => select(mu.lessThan(0).and(groundDisc(r, mu).greaterThanEqual(0)), r.negate().mul(mu).sub(sqrt(max(0, groundDisc(r, mu)))), float(-1));

		const H = () => sqrt(U.Rt.mul(U.Rt).sub(U.Rg.mul(U.Rg)));
		const transmittanceUv = (r, mu) => {
			const rho = sqrt(max(0, r.mul(r).sub(U.Rg.mul(U.Rg))));
			const d = distTop(r, mu);
			const dMin = U.Rt.sub(r), dMax = rho.add(H());
			return vec2(d.sub(dMin).div(dMax.sub(dMin)), rho.div(H()));
		};
		const sampleT = (r, mu) => this.tTex.sample(transmittanceUv(r, mu)).level(0).rgb;
		// Przepuszczalność do słońca z cieniem Ziemi (miękkie przejście przy horyzoncie).
		const sunT = (r, muS) => {
			const sinH = U.Rg.div(r);
			const cosH = sqrt(max(0, float(1).sub(sinH.mul(sinH)))).negate();
			const vis = clamp(muS.sub(cosH).div(U.sunRadius.mul(2)).add(0.5), 0, 1);
			return sampleT(r, muS).mul(vis);
		};
		const sampleMS = (r, muS) => {
			const st = vec2(muS.mul(0.5).add(0.5), r.sub(U.Rg).div(U.Rt.sub(U.Rg)));
			const half = vec2(0.5 / MULTI[0], 0.5 / MULTI[1]);
			return this.msTex.sample(clamp(st, half, vec2(1).sub(half))).level(0).rgb;
		};

		/** Całkowanie rozpraszania wzdłuż promienia: zwraca { L (radiancja bez E słońca), T }. Musi być wołane w Fn. */
		const march = (pos, dir, tMax, steps, quadratic) => {
			const L = vec3(0).toVar(), T = vec3(1).toVar(), tPrev = float(0).toVar();
			const sun = U.sunDir;
			const cosV = dot(dir, sun);
			const pR = phaseRayleigh(cosV), pM = phaseMie(cosV);
			const n = float(steps);
			Loop({ start: int(0), end: int(n) }, ({ i }) => {
				const x = float(i).add(1).div(n);
				const t1 = tMax.mul(quadratic ? x.mul(x) : x);
				const dt = t1.sub(tPrev);
				const p = pos.add(dir.mul(tPrev.add(dt.mul(0.5))));
				const r = length(p);
				const h = r.sub(U.Rg);
				const muS = dot(p.div(r), sun);
				const sR = rayleighScat(h), sM = mieScat(h);
				const ext = extinctionAt(h);
				const S = sR.mul(pR).add(sM.mul(pM)).mul(sunT(r, muS)).add(sR.add(sM).mul(sampleMS(r, muS)));
				const tr = exp(ext.negate().mul(dt));
				L.addAssign(T.mul(S.sub(S.mul(tr)).div(max(ext, vec3(1e-7)))));
				T.mulAssign(tr);
				tPrev.assign(t1);
			});
			return { L, T };
		};

		// ---------- tablica przepuszczalności ----------
		const transmittanceFn = Fn(() => {
			const st = uv();
			const rho = H().mul(st.y);
			const r = sqrt(rho.mul(rho).add(U.Rg.mul(U.Rg)));
			const dMin = U.Rt.sub(r), dMax = rho.add(H());
			const d = max(1e-4, dMin.add(st.x.mul(dMax.sub(dMin))));
			const mu = clamp(H().mul(H()).sub(rho.mul(rho)).sub(d.mul(d)).div(r.mul(d).mul(2)), -1, 1);
			const depth = vec3(0).toVar();
			const N = 40;
			Loop({ start: int(0), end: int(N) }, ({ i }) => {
				const t = float(i).add(0.5).mul(d).div(N);
				const ri = sqrt(r.mul(r).add(t.mul(t)).add(r.mul(mu).mul(t).mul(2)));
				depth.addAssign(extinctionAt(ri.sub(U.Rg)).mul(d.div(N)));
			});
			return vec4(exp(depth.negate()), 1);
		});

		// ---------- rozpraszanie wielokrotne (Ψ) ----------
		const multiFn = Fn(() => {
			const st = uv();
			const muS = st.x.mul(2).sub(1);
			const r = max(U.Rg.add(0.01), U.Rg.add(st.y.mul(U.Rt.sub(U.Rg))));
			const sun = vec3(0, muS, sqrt(max(0, float(1).sub(muS.mul(muS)))));
			const pos = vec3(0, r, 0);
			const Lsum = vec3(0).toVar(), Fsum = vec3(0).toVar();
			const SQ = 8, STEPS = 20;
			Loop({ start: int(0), end: int(SQ * SQ) }, ({ i }) => {
				const fi = float(i);
				const a = fi.mod(SQ).add(0.5).div(SQ), b = fi.div(SQ).floor().add(0.5).div(SQ);
				const cosT = float(1).sub(a.mul(2)), sinT = sqrt(max(0, float(1).sub(cosT.mul(cosT))));
				const phi = b.mul(2 * PI);
				const dir = vec3(sinT.mul(cos(phi)), cosT, sinT.mul(sin(phi)));
				const g = distGround(r, cosT);
				const tMax = select(g.greaterThan(0), g, distTop(r, cosT));
				const L = vec3(0).toVar(), F = vec3(0).toVar(), T = vec3(1).toVar();
				const dt = tMax.div(STEPS);
				Loop({ start: int(0), end: int(STEPS) }, ({ i: k }) => {
					const p = pos.add(dir.mul(float(k).add(0.5).mul(dt)));
					const ri = length(p);
					const h = ri.sub(U.Rg);
					const sc = rayleighScat(h).add(mieScat(h));
					const ext = extinctionAt(h);
					const tr = exp(ext.negate().mul(dt));
					const S = sc.mul(sunT(ri, dot(p.div(ri), sun))).mul(1 / (4 * PI));
					L.addAssign(T.mul(S.sub(S.mul(tr)).div(ext)));
					F.addAssign(T.mul(sc.sub(sc.mul(tr)).div(ext)));
					T.mulAssign(tr);
				});
				If(g.greaterThan(0), () => {
					const pg = pos.add(dir.mul(g));
					const n = normalize(pg);
					const muG = dot(n, sun);
					L.addAssign(T.mul(sunT(U.Rg, muG)).mul(max(0, muG)).mul(U.albedo).div(PI));
				});
				Lsum.addAssign(L);
				Fsum.addAssign(F);
			});
			const L2 = Lsum.div(SQ * SQ), f = Fsum.div(SQ * SQ);
			return vec4(L2.div(max(vec3(1e-4), vec3(1).sub(f))), 1);
		});

		// ---------- widok nieba z wysokości kamery ----------
		const horizon = () => {
			const vh = sqrt(max(0, U.viewH.mul(U.viewH).sub(U.Rg.mul(U.Rg))));
			const beta = acos(clamp(vh.div(U.viewH), -1, 1));
			return { beta, zha: float(PI).sub(beta) };
		};
		const makeSkyFn = (lightDir, lightE) => Fn(() => {
			const st = uv();
			const { beta, zha } = horizon();
			const v = st.y;
			const c0 = float(1).sub(v.mul(2));
			const upper = zha.mul(float(1).sub(c0.mul(c0)));
			const c1 = v.mul(2).sub(1);
			const lower = zha.add(beta.mul(c1.mul(c1)));
			const vza = select(v.lessThan(0.5), upper, lower);
			const az = st.x.mul(st.x).mul(PI);
			const muS = lightDir.y;
			const sunL = vec3(sqrt(max(0, float(1).sub(muS.mul(muS)))), muS, 0);
			const dir = vec3(sin(vza).mul(cos(az)), cos(vza), sin(vza).mul(sin(az)));
			const pos = vec3(0, U.viewH, 0);
			const g = distGround(U.viewH, dir.y);
			const tMax = select(g.greaterThan(0), g, distTop(U.viewH, dir.y));
			// march() liczy fazę względem U.sunDir – tu słońce leży w lokalnym układzie, więc kąt podajemy wprost
			const L = vec3(0).toVar(), T = vec3(1).toVar(), tPrev = float(0).toVar();
			const cosV = dot(dir, sunL);
			const pR = phaseRayleigh(cosV), pM = phaseMie(cosV);
			const N = 32;
			Loop({ start: int(0), end: int(N) }, ({ i }) => {
				const x = float(i).add(1).div(N);
				const t1 = tMax.mul(x.mul(x));
				const dt = t1.sub(tPrev);
				const p = pos.add(dir.mul(tPrev.add(dt.mul(0.5))));
				const r = length(p);
				const h = r.sub(U.Rg);
				const ms = dot(p.div(r), sunL);
				const sR = rayleighScat(h), sM = mieScat(h);
				const ext = extinctionAt(h);
				const S = sR.mul(pR).add(sM.mul(pM)).mul(sunT(r, ms)).add(sR.add(sM).mul(sampleMS(r, ms)));
				const tr = exp(ext.negate().mul(dt));
				L.addAssign(T.mul(S.sub(S.mul(tr)).div(max(ext, vec3(1e-7)))));
				T.mulAssign(tr);
				tPrev.assign(t1);
			});
			return vec4(L.mul(lightE), 1);
		});

		/** Radiancja nieba w kierunku dir (świat) widziana z kamery – z tablicy widoku nieba (słońce + księżyc). */
		this.skyRadiance = (dir) => skyLookup(this.skyTex, U.sunDir, dir).add(skyLookup(this.moonSkyTex, U.moonDir, dir));
		const skyLookup = (tex, light, dir) => {
			const { beta, zha } = horizon();
			const vza = acos(clamp(dir.y, -1, 1));
			const up = clamp(vza.div(zha), 0, 1);
			const vUp = float(1).sub(sqrt(float(1).sub(up))).mul(0.5);
			const lo = clamp(vza.sub(zha).div(beta), 0, 1);
			const vLo = sqrt(lo).mul(0.5).add(0.5);
			const v = select(vza.lessThan(zha), vUp, vLo);
			const dh = dir.xz.div(max(1e-5, length(dir.xz)));
			const sh = light.xz.div(max(1e-5, length(light.xz)));
			const phi = acos(clamp(dot(dh, sh), -1, 1));
			const u = sqrt(phi.div(PI));
			const half = vec2(0.5 / SKY[0], 0.5 / SKY[1]);
			return tex.sample(clamp(vec2(u, v), half, vec2(1).sub(half))).level(0).rgb;
		};

		/** Tarcza słońca (radiancja) w kierunku dir, osłabiona atmosferą; zero poza tarczą. */
		this.sunDisk = (dir) => {
			const c = dot(dir, U.sunDir);
			const rad = U.sunRadius.mul(2.2); // trochę większa niż w naturze – czytelniejsza na ekranie
			const cosR = cos(rad);
			const x = clamp(float(1).sub(c).div(float(1).sub(cosR)), 0, 1); // 0 środek, 1 brzeg
			const limb = pow(max(0, float(1).sub(x)), 0.45);
			const T = sampleT(U.viewH, dir.y);
			return select(c.greaterThan(cosR), T.mul(U.sunE).mul(limb).mul(60), vec3(0));
		};

		/** Główne światło sceny (słońce, nocą księżyc) – natężenie RGB docierające na wysokość yM metrów n.p.m. */
		this.sunLight = (yM) => {
			const r = U.Rg.add(max(0.001, yM.div(1000)));
			return sunT(r, U.lightDir.y).mul(U.lightE);
		};

		/** Przepuszczalność atmosfery od kamery w kierunku dir (do ciał niebieskich). */
		this.viewTransmittance = (dir) => sampleT(U.viewH, dir.y);

		const mix3 = (a, b, t) => a.add(b.sub(a).mul(t));
		/**
		 * Niebo nocne w kierunku dir (świat): gwiazdy (dwie warstwy losowego katalogu, migotanie przy horyzoncie),
		 * Droga Mleczna i tarcza księżyca z fazą i morzami. Dodawane do radiancji nieba – w dzień giną w jego blasku.
		 */
		this.nightSky = (dir) => {
			const eq = U.skyToEq.mul(dir);
			const T = sampleT(U.viewH, dir.y).mul(smoothstep(-0.02, 0.01, dir.y));
			// gwiazdy: rzut na sześcian, w każdej komórce co najwyżej jedna gwiazda o losowej jasności i barwie
			const a = abs(eq);
			const isX = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
			const isY = a.y.greaterThan(a.x).and(a.y.greaterThanEqual(a.z));
			const fuv = select(isX, eq.yz.div(a.x), select(isY, eq.xz.div(a.y), eq.xy.div(a.z)));
			const face = select(isX, select(eq.x.greaterThan(0), float(0), float(1)), select(isY, select(eq.y.greaterThan(0), float(2), float(3)), select(eq.z.greaterThan(0), float(4), float(5))));
			const stretch = float(1).add(dot(fuv, fuv).mul(0.5));
			const sigma = U.pixelAngle.mul(1.1); // ~1 piksel – punkt stabilny przy drganiu TAA
			const layer = (cells, density, base, spread, power, seed) => {
				const g = fuv.mul(0.5).add(0.5).mul(cells);
				const cell = floor(g).add(face.mul(97.3)).add(seed);
				const pos = hash22(cell).mul(0.7).add(0.15);
				const delta = fract(g).sub(pos).mul(2 / cells).div(stretch);
				const h = hash12(cell.add(17.7));
				const exists = select(h.lessThan(density), float(1), float(0));
				const mag = hash12(cell.add(5.3));
				const b = float(base).add(pow(mag, power).mul(spread));
				const tint = mix3(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.66), hash12(cell.add(9.1)));
				const twinkle = float(1).add(sin(time.mul(hash12(cell.add(2.2)).mul(9).add(6)).add(h.mul(60))).mul(0.4).mul(float(1).sub(clamp(dir.y.mul(4), 0, 1))));
				return tint.mul(b.mul(exists).mul(twinkle).mul(exp(dot(delta, delta).div(sigma.mul(sigma)).negate())));
			};
			let stars = layer(36, 0.17, 0.12, 3.5, 6, 0).add(layer(110, 0.14, 0.02, 0.18, 3, 11));
			// Droga Mleczna: pas wokół płaszczyzny Galaktyki, jaśniejszy ku jej środkowi, z ciemnymi pyłami
			const gnp = vec3(-0.8676, -0.1981, 0.4560), gc = vec3(-0.0549, -0.8734, -0.4838);
			const gb = asin(clamp(dot(eq, gnp), -1, 1));
			const n1 = mx_fractal_noise_float(eq.mul(7), 4, 2, 0.5);
			const n2 = mx_fractal_noise_float(eq.mul(18).add(3.1), 3, 2, 0.5);
			const sq = (v) => v.mul(v); // pow(x, 2) jest niezdefiniowane dla x < 0 w WGSL
			const band = exp(sq(gb.div(0.16)).negate()).add(exp(sq(gb.div(0.42)).negate()).mul(0.35));
			const dust = float(1).sub(exp(sq(gb.div(0.05)).negate()).mul(smoothstep(-0.1, 0.4, n2)).mul(0.7));
			const core = dot(eq, gc).mul(0.5).add(0.5);
			const milky = vec3(0.95, 0.9, 0.82).mul(band.mul(dust).mul(n1.mul(0.6).add(0.7).max(0)).mul(core.mul(core).mul(0.9).add(0.25)).mul(0.005));
			// tarcza księżyca (powiększona ~2,4× dla czytelności), oświetlona od strony słońca; światło popielate
			const rM = 0.011;
			const md = U.moonDir;
			const t1 = U.moonT1, t2 = U.moonT2;
			const x = dot(dir, t1).div(rM), y = dot(dir, t2).div(rM);
			const r2 = x.mul(x).add(y.mul(y));
			const front = smoothstep(0, 0.001, dot(dir, md));
			const disk = float(1).sub(smoothstep(0.92, 1.0, r2)).mul(front);
			const z = sqrt(max(0, float(1).sub(r2)));
			const n = t1.mul(x).add(t2.mul(y)).sub(md.mul(z));
			const lit = smoothstep(-0.04, 0.08, dot(n, U.sunDir));
			const maria = mx_fractal_noise_float(vec3(x, y, 0).mul(1.6).add(vec3(4.2, 1.3, 0.7)), 4, 2.1, 0.55);
			const albedo = float(0.12).mul(smoothstep(-0.25, 0.3, maria).mul(0.6).add(0.45));
			// jasność nieco obniżona (×0,7) względem fizycznej – przy nocnej ekspozycji tarcza nie przepala się i widać morza
			const moon = vec3(1, 0.97, 0.92).mul(albedo.mul(U.sunE).div(PI).mul(lit.add(0.004))).mul(disk).mul(0.7);
			stars = stars.add(milky).mul(float(1).sub(disk));
			return stars.add(moon).mul(T);
		};

		/** Perspektywa powietrzna między kamerą (y kamery w metrach) a punktem odległym o offset (metry, świat). */
		this.aerial = (cameraY, offsetM) => {
			const pos = vec3(0, U.Rg.add(max(0.002, cameraY.div(1000))), 0);
			const d = offsetM.div(1000).mul(U.aerial);
			const dist = length(d);
			// krótka droga – mało kroków; daleko (horyzont) – do 12
			const steps = clamp(dist.mul(0.8).floor().add(3), 3, 12);
			const dir = d.div(max(1e-6, dist));
			const { L, T } = march(pos, dir, dist, steps, false);
			return { inscatter: L.mul(U.sunE), transmittance: T };
		};

		// ---------- natężenie światła nieba (do oświetlenia rozproszonego) ----------
		const irradianceFn = Fn(() => {
			const E = vec3(0).toVar();
			const N = 8;
			for (let i = 0; i < N; i++) {
				for (let j = 0; j < N; j++) {
					const a = (i + 0.5) / N, b = (j + 0.5) / N;
					const rr = Math.sqrt(a), phi = 2 * PI * b;
					const dir = vec3(rr * Math.cos(phi), Math.sqrt(1 - a), rr * Math.sin(phi));
					E.addAssign(self.skyRadiance(dir));
				}
			}
			return vec4(E.mul(PI / (N * N)), 1);
		});

		const quad = (fn) => {
			const m = new NodeMaterial();
			m.fragmentNode = fn();
			m.depthTest = m.depthWrite = false;
			return new QuadMesh(m);
		};
		this.transmittanceQuad = quad(transmittanceFn);
		this.multiQuad = quad(multiFn);
		this.skyQuad = quad(makeSkyFn(U.sunDir, U.sunE));
		this.moonSkyQuad = quad(makeSkyFn(U.moonDir, U.moonE));
		this.irradianceQuad = quad(irradianceFn);

		/** Światło nieba (natężenie RGB na poziomą powierzchnię). */
		this.skyIrradiance = () => this.irrTex.sample(vec2(0.5)).level(0).rgb;
		this.march = march;
	}
}
