// Mapa cieni świata: budynki i drzewa 3D renderowane od strony słońca do tekstury głębi w kwadracie wokół kamery.
// Pozycja przyciągana do siatki tekseli (cienie nie „pływają” przy ruchu), próbkowanie z miękką krawędzią (PCF).
// Teren, drogi, budynki i drzewa odczytują ją w swoich shaderach – domy rzucają cień na ogrody, drzewa na drogi
// i na siebie nawzajem. Poza zasięgiem mapy cień wygasa łagodnie (dalej zostają cienie z rzeźby terenu i chmur).
import { OrthographicCamera, RenderTarget, DepthTexture, FloatType, UnsignedByteType, Vector3, Matrix4, NearestFilter } from 'three/webgpu';
import { uniform, texture, vec2, vec4, float, clamp, smoothstep, max, abs, min } from 'three/tsl';

export const CASTER_LAYER = 2;

export class WorldShadow {
	constructor(renderer, scene, { size = 4096, extent = 1400 } = {}) {
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
	}

	// Rzucające cień: osobne, tanie siatki na warstwie CASTER_LAYER (drzewa i budynki tworzą je same).

	/** Przelicza mapę (co klatkę albo rzadziej): środek – punkt, wokół którego potrzeba cieni. */
	update(center, sunDir) {
		if (sunDir.y < 0.02) { this.enabled.value = 0; return; }
		this.enabled.value = 1;
		const cam = this.cam;
		// baza światła i przyciąganie środka do siatki tekseli
		const fwd = sunDir.clone().negate().normalize();
		const up = Math.abs(fwd.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
		const right = new Vector3().crossVectors(fwd, up).normalize();
		const camUp = new Vector3().crossVectors(right, fwd).normalize();
		const texel = (2 * this.extent) / this.size;
		const r = Math.round(center.dot(right) / texel) * texel, u = Math.round(center.dot(camUp) / texel) * texel, f = center.dot(fwd);
		const snapped = right.clone().multiplyScalar(r).addScaledVector(camUp, u).addScaledVector(fwd, f);
		cam.position.copy(snapped).addScaledVector(fwd, -4000);
		cam.up.copy(camUp);
		cam.lookAt(snapped);
		cam.updateMatrixWorld();
		cam.updateProjectionMatrix();
		const r0 = this.renderer, prev = r0.getRenderTarget();
		const shadowWas = r0.shadowMap.enabled;
		r0.shadowMap.enabled = false;
		[this.rtA, this.rtB] = [this.rtB, this.rtA];
		this.depth.value = this.rtB.depthTexture; // w przebiegu cienia shadery czytają starą mapę
		const mrtWas = r0.getMRT();
		r0.setMRT(null);
		r0.setRenderTarget(this.rtA);
		r0.clear();
		r0.render(this.scene, cam);
		r0.setRenderTarget(prev);
		r0.setMRT(mrtWas);
		this.depth.value = this.rtA.depthTexture; // scena główna – świeża
		r0.shadowMap.enabled = shadowWas;
		this.matrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
		this.center.value.copy(snapped);
	}

	/**
	 * Widoczność słońca (0..1) w punkcie świata p. bias – w metrach wzdłuż promienia słońca (powierzchnie pochyłe
	 * potrzebują więcej). Głębia odwrócona: bliżej słońca = większa wartość.
	 */
	visibility(p, biasM = 0.4) {
		const clip = this.matrix.mul(vec4(p, 1));
		const uv = vec2(clip.x.mul(0.5).add(0.5), float(0.5).sub(clip.y.mul(0.5)));
		const depthRange = 8000 - 10;
		const z = clip.z.add(float(biasM).div(depthRange));
		const t = float(1 / this.size);
		let lit = float(0);
		const taps = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
		for (const [a, b] of taps) {
			const d = this.depth.sample(uv.add(vec2(a, b).mul(t).mul(1.2))).level(0).r;
			lit = lit.add(clamp(z.sub(d).mul(depthRange).mul(2).add(0.5), 0, 1));
		}
		lit = lit.div(taps.length);
		// wygaszenie przy krawędzi mapy i gdy słońce za nisko
		const edge = max(abs(uv.x.sub(0.5)), abs(uv.y.sub(0.5)));
		const fade = smoothstep(0.42, 0.5, edge).oneMinus().mul(this.enabled);
		return min(1, float(1).sub(fade).add(lit.mul(fade)));
	}
}
