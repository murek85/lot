// Mapa cieni świata: budynki i drzewa 3D renderowane od strony słońca do tekstury głębi w kwadracie wokół kamery –
// dwie kaskady: daleka (±1,4 km, 4096², ~0,7 m na teksel, wszystkie rzucające cień) i bliska (±250 m, 2048², ~0,24 m,
// tylko warstwa CASTER_NEAR: budynki, mosty, aleje, słupy, bliskie drzewa) – ostre cienie płotów, koron i dachów z bliska.
// Pozycja przyciągana do siatki tekseli (cienie nie „pływają” przy ruchu), próbkowanie z miękką krawędzią (PCF).
// Teren, drogi, budynki i drzewa odczytują ją w swoich shaderach – domy rzucają cień na ogrody, drzewa na drogi
// i na siebie nawzajem. Poza zasięgiem mapy cień wygasa łagodnie (dalej zostają cienie z rzeźby terenu i chmur).
import { OrthographicCamera, RenderTarget, DepthTexture, FloatType, UnsignedByteType, Vector3, Matrix4, NearestFilter } from 'three/webgpu';
import { uniform, texture, vec2, vec4, float, clamp, smoothstep, max, abs, min, mix } from 'three/tsl';

export const CASTER_LAYER = 2;
/** Warstwa rzucających cień także w bliskiej kaskadzie (dalsze drzewa – tylko w dalekiej). */
export const CASTER_NEAR = 3;

export class WorldShadow {
	constructor(renderer, scene, { size = 4096, extent = 1400, nearSize = 2048, nearExtent = 250 } = {}) {
		this.renderer = renderer;
		this.scene = scene;
		this.size = size;
		this.extent = extent;
		// dwie mapy na zmianę: rzucające cień same też próbkują mapę (w swoich shaderach), a WebGPU nie pozwala
		// czytać tekstury, do której właśnie się pisze – podczas przebiegu cienia czytają tę drugą
		const make = () => {
			const rt = new RenderTarget(size, size, { type: UnsignedByteType, depthBuffer: true });
			rt.depthTexture = new DepthTexture(size, size, FloatType);
			rt.depthTexture.minFilter = rt.depthTexture.magFilter = NearestFilter;
			return rt;
		};
		this.rtA = make();
		this.rtB = make();
		this.cam = new OrthographicCamera(-extent, extent, extent, -extent, 10, 8000);
		this.cam.layers.set(CASTER_LAYER);
		this.matrix = uniform(new Matrix4());
		this.center = uniform(new Vector3());
		this.enabled = uniform(1);
		this.depth = texture(this.rtB.depthTexture);
		this._frame = 0;
		// bliska kaskada: własne mapy (na zmianę), kamera i macierz
		this.nearSize = nearSize;
		this.nearExtent = nearExtent;
		const makeNear = () => {
			const rt = new RenderTarget(nearSize, nearSize, { type: UnsignedByteType, depthBuffer: true });
			rt.depthTexture = new DepthTexture(nearSize, nearSize, FloatType);
			rt.depthTexture.minFilter = rt.depthTexture.magFilter = NearestFilter;
			return rt;
		};
		this.nA = makeNear();
		this.nB = makeNear();
		this.nearCam = new OrthographicCamera(-nearExtent, nearExtent, nearExtent, -nearExtent, 10, 8000);
		this.nearCam.layers.set(CASTER_NEAR);
		this.nearMatrix = uniform(new Matrix4());
		this.nearDepth = texture(this.nB.depthTexture);
	}

	// Rzucające cień: osobne, tanie siatki na warstwie CASTER_LAYER (drzewa i budynki tworzą je same).

	/** Przelicza mapy (co klatkę albo rzadziej): środek – punkt, wokół którego potrzeba cieni. */
	update(center, sunDir) {
		if (sunDir.y < 0.02) { this.enabled.value = 0; return; }
		this.enabled.value = 1;
		const r0 = this.renderer, prev = r0.getRenderTarget();
		const shadowWas = r0.shadowMap.enabled;
		r0.shadowMap.enabled = false;
		const mrtWas = r0.getMRT();
		r0.setMRT(null);
		// daleka kaskada, potem bliska; w przebiegu cienia shadery rzucających czytają starą mapę danej kaskady
		[this.rtA, this.rtB] = [this.rtB, this.rtA];
		this.depth.value = this.rtB.depthTexture;
		const far = this.pass(this.cam, this.rtA, center, sunDir, this.extent, this.size);
		this.depth.value = this.rtA.depthTexture;
		this.matrix.value.copy(far.matrix);
		this.center.value.copy(far.center);
		[this.nA, this.nB] = [this.nB, this.nA];
		this.nearDepth.value = this.nB.depthTexture;
		const near = this.pass(this.nearCam, this.nA, center, sunDir, this.nearExtent, this.nearSize);
		this.nearDepth.value = this.nA.depthTexture;
		this.nearMatrix.value.copy(near.matrix);
		r0.setRenderTarget(prev);
		r0.setMRT(mrtWas);
		r0.shadowMap.enabled = shadowWas;
	}

	/** Jeden przebieg kaskady: kamera od słońca nad środkiem przyciągniętym do siatki tekseli. */
	pass(cam, rt, center, sunDir, extent, size) {
		const fwd = sunDir.clone().negate().normalize();
		const up = Math.abs(fwd.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
		const right = new Vector3().crossVectors(fwd, up).normalize();
		const camUp = new Vector3().crossVectors(right, fwd).normalize();
		const texel = (2 * extent) / size;
		const r = Math.round(center.dot(right) / texel) * texel, u = Math.round(center.dot(camUp) / texel) * texel, f = center.dot(fwd);
		const snapped = right.clone().multiplyScalar(r).addScaledVector(camUp, u).addScaledVector(fwd, f);
		cam.position.copy(snapped).addScaledVector(fwd, -4000);
		cam.up.copy(camUp);
		cam.lookAt(snapped);
		cam.updateMatrixWorld();
		cam.updateProjectionMatrix();
		const r0 = this.renderer;
		r0.setRenderTarget(rt);
		r0.clear();
		r0.render(this.scene, cam);
		return { matrix: new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), center: snapped };
	}

	/**
	 * Widoczność słońca (0..1) w punkcie świata p. bias – w metrach wzdłuż promienia słońca (powierzchnie pochyłe
	 * potrzebują więcej). Głębia odwrócona: bliżej słońca = większa wartość.
	 */
	visibility(p, biasM = 0.4) {
		const depthRange = 8000 - 10;
		const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
		// PCF jednej kaskady: udział oświetlonych próbek i odległość od środka mapy (0..0,5)
		const cascade = (matrix, depth, size) => {
			const clip = matrix.mul(vec4(p, 1));
			const uv = vec2(clip.x.mul(0.5).add(0.5), float(0.5).sub(clip.y.mul(0.5)));
			const z = clip.z.add(float(biasM).div(depthRange));
			const t = float(1 / size);
			let lit = float(0);
			for (const [a, b] of taps) {
				const d = depth.sample(uv.add(vec2(a, b).mul(t).mul(1.2))).level(0).r;
				lit = lit.add(clamp(z.sub(d).mul(depthRange).mul(2).add(0.5), 0, 1));
			}
			return { lit: lit.div(taps.length), edge: max(abs(uv.x.sub(0.5)), abs(uv.y.sub(0.5))) };
		};
		const far = cascade(this.matrix, this.depth, this.size);
		const near = cascade(this.nearMatrix, this.nearDepth, this.nearSize);
		// bliska kaskada w jej zasięgu, przy brzegu płynnie w daleką
		const lit = mix(far.lit, near.lit, smoothstep(0.38, 0.47, near.edge).oneMinus());
		// wygaszenie przy krawędzi dalekiej mapy i gdy słońce za nisko
		const fade = smoothstep(0.42, 0.5, far.edge).oneMinus().mul(this.enabled);
		return min(1, float(1).sub(fade).add(lit.mul(fade)));
	}
}
