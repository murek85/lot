// Opady i błyskawice: osobna scena rysowana po wygładzaniu czasowym (TRAA rozmazałby cienkie, szybkie smugi),
// dodawana do obrazu w przebiegu końcowym. Krople i płatki to czworokąty liczone w całości na GPU: każda cząstka
// spada z wiatrem w sześcianie wokół kamery (zawijanie modulo – zawsze są wokół), smuga wydłuża się wzdłuż
// prędkości względem kamery (z lecącego samolotu deszcz pędzi na szybę), zasłanianie przez scenę – z jej głębi.
import { Mesh, Scene, BufferGeometry, BufferAttribute, MeshBasicNodeMaterial, AdditiveBlending, Vector3, Vector2, Color } from 'three/webgpu';
import {
	Fn, attribute, uniform, vec3, vec4, float, floor, mix, sin, cos, normalize, length, smoothstep, clamp, max, min, abs,
	varying, If, Discard, screenUV, cameraViewMatrix, cameraProjectionMatrix, getViewPosition, select, vec2, screenSize,
} from 'three/tsl';

const MAX = 48000;

export class Precipitation {
	constructor(pixelAngle) {
		this.scene = new Scene();
		this.u = {
			time: uniform(0),
			cam: uniform(new Vector3()),
			camVel: uniform(new Vector3()),
			wind: uniform(new Vector2()),
			box: uniform(80),
			fall: uniform(9),
			swirl: uniform(0),
			density: uniform(0),
			size: uniform(0.012), // szerokość smugi / płatka (m)
			streak: uniform(0.018), // „czas naświetlania” smugi (s)
			minLen: uniform(0.02),
			snow: uniform(0), // 0 deszcz, 1 śnieg (kształt i jasność)
			light: uniform(new Color(0.5, 0.52, 0.56)),
			alpha: uniform(0.3),
			bolt: uniform(0), // jasność błyskawicy 0..1
		};
		this.pixelAngle = pixelAngle;
		this.depth = null;
		this.projInv = null;
		this.camPrev = new Vector3();
		this.has = false;
	}

	/** Głębia sceny z przebiegu kamery (zasłanianie) – woła createPost. */
	build(depthNode, projInv) {
		this.depth = depthNode;
		this.projInv = projInv;
		this.scene.add(this.particles(), this.boltMesh());
	}

	particles() {
		const U = this.u;
		const g = new BufferGeometry();
		const seed = new Float32Array(MAX * 4 * 4), corner = new Float32Array(MAX * 4 * 2), idx = new Uint32Array(MAX * 6);
		for (let i = 0; i < MAX; i++) {
			const s = [Math.random(), Math.random(), Math.random(), Math.random()];
			for (let k = 0; k < 4; k++) {
				seed.set(s, (i * 4 + k) * 4);
				corner.set([k & 1, k < 2 ? -1 : 1], (i * 4 + k) * 2);
			}
			idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
		}
		g.setAttribute('position', new BufferAttribute(new Float32Array(MAX * 4 * 3), 3));
		g.setAttribute('seed', new BufferAttribute(seed, 4));
		g.setAttribute('corner', new BufferAttribute(corner, 2));
		g.setIndex(new BufferAttribute(idx, 1));

		const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
		const sd = attribute('seed', 'vec4'), cr = attribute('corner', 'vec2');
		// varyingi przypisywane w węźle wierzchołków muszą mieć nazwy (inaczej nie trafiają do shadera fragmentów)
		const vFade = varying(float(0), 'vPrecipFade'), vCorner = varying(cr, 'vPrecipCorner'), vViewZ = varying(float(0), 'vPrecipViewZ'), vThin = varying(float(1), 'vPrecipThin');
		// Smuga budowana w przestrzeni ekranu: oba końce (kropla teraz i chwilę wcześniej względem kamery) rzutowane
		// na ekran, czworokąt rozszerzony prostopadle w pikselach. Z lecącego samolotu krople pędzą prawie wzdłuż
		// promienia widzenia – iloczyn wektorowy w przestrzeni świata byłby wtedy zerowy (smugi znikały).
		m.vertexNode = Fn(() => {
			const B = U.box;
			const sp = mix(0.75, 1.25, sd.w);
			const vel = vec3(U.wind.x, U.fall.negate(), U.wind.y).mul(sp);
			// śnieg wiruje: przesunięcie po okręgu o losowej fazie
			const ph = sd.w.mul(60);
			const swirl = vec3(sin(U.time.mul(0.9).add(ph)), sin(U.time.mul(0.5).add(ph.mul(1.3))).mul(0.3), cos(U.time.mul(0.7).add(ph.mul(0.7)))).mul(U.swirl);
			const p = sd.xyz.mul(B).add(vel.mul(U.time)).add(swirl);
			// modulo dodatnie (% w WGSL zachowuje znak dzielnej)
			const q = p.sub(U.cam);
			const rel = q.sub(B.mul(floor(q.div(B)))).sub(B.mul(0.5));
			const dist = length(rel);
			const vRel = vel.sub(U.camVel);
			const len = clamp(length(vRel).mul(U.streak), U.minLen, 7);
			const head = U.cam.add(rel);
			const tail = head.sub(normalize(vRel.add(vec3(0, -1e-3, 0))).mul(len));
			const vp = cameraViewMatrix.mul(vec4(mix(head, tail, cr.x), 1));
			const cA = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(head, 1)));
			const cB = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(tail, 1)));
			// kierunek smugi na ekranie (w pikselach); krótka – pionowo
			const sA = cA.xy.div(max(cA.w, 0.05)).mul(screenSize), sB = cB.xy.div(max(cB.w, 0.05)).mul(screenSize);
			const d2 = sB.sub(sA);
			const l2 = length(d2);
			const dir2 = select(l2.greaterThan(0.5), d2.div(max(l2, 1e-4)), vec2(0, 1));
			const perp = vec2(dir2.y.negate(), dir2.x);
			// szerokość: rozmiar w świecie na ekranie, co najmniej ~1,2 piksela (cieńsze bledną zamiast migotać)
			const wPx = U.size.div(max(dist, 0.1).mul(this.pixelAngle));
			const w = max(wPx, 1.2);
			vThin.assign(min(1, wPx.div(1.2)).sqrt());
			const alive = select(sd.w.lessThan(U.density), float(1), float(0));
			// zanik przy kamerze i przy ścianach sześcianu (zawijanie niewidoczne); za kamerą – zwinięte
			// (smoothstep z odwróconymi progami jest w WGSL/D3D nieokreślony – stąd oneMinus)
			const front = select(cA.w.greaterThan(0.1).and(cB.w.greaterThan(0.1)), float(1), float(0));
			vFade.assign(smoothstep(0.4, 2.5, dist).mul(smoothstep(B.mul(0.32), B.mul(0.5), dist).oneMinus()).mul(alive).mul(front));
			vViewZ.assign(vp.z);
			const clip = mix(cA, cB, cr.x);
			// przesunięcie w pikselach → przestrzeń przycięcia (×2/rozmiar ekranu ×w); końce wydłużone o pół szerokości
			const offPx = perp.mul(cr.y.mul(w).mul(0.5)).add(dir2.mul(cr.x.sub(0.5).mul(w)));
			const off = offPx.mul(2).div(screenSize).mul(clip.w).mul(alive).mul(front);
			return vec4(clip.xy.add(off), clip.z, clip.w);
		})();
		m.colorNode = Fn(() => {
			// zasłanianie: dalej niż powierzchnia sceny w tym pikselu – niewidoczne
			const d = this.depth.sample(screenUV).r;
			const sceneZ = getViewPosition(screenUV, d, this.projInv).z;
			If(d.greaterThan(0).and(vViewZ.lessThan(sceneZ)), () => { Discard(); });
			// profil: smuga – miękka w poprzek i na końcach; płatek – okrągły
			const across = float(1).sub(abs(vCorner.y));
			const along = smoothstep(0, 0.25, vCorner.x).mul(smoothstep(0.75, 1, vCorner.x).oneMinus());
			const rain = across.mul(along);
			const flake = smoothstep(0.3, 1, length(vec3(vCorner.x.sub(0.5).mul(2), vCorner.y, 0))).oneMinus();
			const shape = mix(rain, flake, U.snow);
			const a = shape.mul(vFade).mul(vThin).mul(U.alpha);
			return vec4(U.light.mul(a), 1);
		})();
		const mesh = new Mesh(g, m);
		mesh.frustumCulled = false;
		this.particleMesh = mesh;
		return mesh;
	}

	// ---------- błyskawica ----------

	boltMesh() {
		const SEG = 96;
		const g = new BufferGeometry();
		g.setAttribute('position', new BufferAttribute(new Float32Array(SEG * 4 * 3), 3));
		g.setAttribute('glow', new BufferAttribute(new Float32Array(SEG * 4), 1));
		const idx = new Uint32Array(SEG * 6);
		for (let i = 0; i < SEG; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
		g.setIndex(new BufferAttribute(idx, 1));
		const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
		const glow = attribute('glow', 'float');
		m.colorNode = vec4(vec3(0.75, 0.82, 1).mul(glow).mul(this.u.bolt).mul(60), 1);
		const mesh = new Mesh(g, m);
		mesh.frustumCulled = false;
		mesh.visible = false;
		this.bolt = { mesh, SEG };
		return mesh;
	}

	/**
	 * Nowa błyskawica: kanał od podstawy chmur do ziemi w punkcie (x, z), łamany losowo, z odgałęzieniami;
	 * wstęga zwrócona do kamery (przez ułamek sekundy kamera prawie się nie rusza).
	 */
	strike(x, z, groundY, topY, camPos, random = Math.random) {
		const { mesh, SEG } = this.bolt;
		const pos = mesh.geometry.attributes.position.array, glow = mesh.geometry.attributes.glow.array;
		pos.fill(0); glow.fill(0);
		const segs = [];
		const walk = (p, steps, stepLen, spread, width, g) => {
			let cur = p.clone();
			for (let i = 0; i < steps && cur.y > groundY && segs.length < SEG; i++) {
				const next = cur.clone().add(new Vector3((random() - 0.5) * spread, -stepLen * (0.6 + random() * 0.6), (random() - 0.5) * spread));
				segs.push([cur, next, width, g]);
				if (g > 0.6 && random() < 0.12) walk(next, 6 + Math.floor(random() * 8), stepLen * 0.7, spread * 1.2, width * 0.5, g * 0.45);
				cur = next;
			}
		};
		const h = topY - groundY;
		walk(new Vector3(x, topY, z), 64, h / 40, h / 22, Math.max(4, h / 160), 1);
		const toCam = new Vector3(), dir = new Vector3(), side = new Vector3();
		segs.forEach(([a, b, w, g], i) => {
			dir.subVectors(b, a).normalize();
			toCam.subVectors(camPos, a).normalize();
			side.crossVectors(dir, toCam).normalize().multiplyScalar(w);
			const quad = [a.clone().sub(side), b.clone().sub(side), a.clone().add(side), b.clone().add(side)];
			quad.forEach((v, k) => { pos.set([v.x, v.y, v.z], (i * 4 + k) * 3); glow[i * 4 + k] = g; });
		});
		mesh.geometry.attributes.position.needsUpdate = true;
		mesh.geometry.attributes.glow.needsUpdate = true;
		mesh.visible = true;
	}

	// ---------- klatka ----------

	/**
	 * p: { type: 'rain' | 'snow' | null, rate 0..1, wind {x, z}, light [r, g, b] (HDR), flash 0..1, bolt 0..1 }.
	 * camera – kamera sceny, dt – krok (prędkość kamery do smug).
	 */
	update(dt, camera, p) {
		const U = this.u;
		U.time.value += dt;
		U.cam.value.copy(camera.position);
		if (dt > 0) U.camVel.value.subVectors(camera.position, this.camPrev).divideScalar(dt);
		if (U.camVel.value.length() > 400) U.camVel.value.set(0, 0, 0); // przeskok kamery (zmiana widoku, start)
		this.camPrev.copy(camera.position);
		U.wind.value.set(p.wind.x, p.wind.z);
		const snow = p.type === 'snow';
		U.snow.value = snow ? 1 : 0;
		U.density.value = p.type ? p.rate : 0;
		U.box.value = snow ? 50 : 60;
		U.fall.value = snow ? 1.3 : 9;
		U.swirl.value = snow ? 0.8 : 0;
		U.size.value = snow ? 0.05 : 0.008;
		U.streak.value = snow ? 0.004 : 0.02;
		U.minLen.value = snow ? 0.1 : 0.4;
		U.alpha.value = snow ? 1.2 : 0.9;
		const f = 1 + p.flash * 6;
		U.light.value.setRGB(p.light[0] * f, p.light[1] * f, p.light[2] * f);
		U.bolt.value = p.bolt;
		this.particleMesh.visible = !!p.type && p.rate > 0;
		if (p.bolt <= 0.001) this.bolt.mesh.visible = false;
		this.has = this.particleMesh.visible || this.bolt.mesh.visible;
	}
}
