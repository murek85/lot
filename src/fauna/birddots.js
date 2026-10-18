// Odległe ptaki jako punkty: gdy rozpiętość na ekranie spada poniżej ~6 pikseli, zamiast bryły (która znika poniżej
// ~4 pikseli) – kropka ~4 piksele w barwie gatunku, migocząca w rytmie machania. Osobna scena nakładana po
// wygładzaniu TRAA (inaczej drobne, szybkie punkty rozmywają się do zera), zasłanianie z głębi sceny – za budynkami
// i zboczami punktów nie widać. Stado szpaków z wysokości – ruchoma chmura kropek.
import { Scene, Sprite, SpriteNodeMaterial, InstancedBufferAttribute, NormalBlending, Vector2 } from 'three/webgpu';
import {
	Fn, vec2, vec3, vec4, float, uniform, instancedBufferAttribute, varying, uv, dot, max, sin, length, smoothstep, clamp,
	cameraPosition, cameraViewMatrix, screenUV, getViewPosition, If, Discard,
} from 'three/tsl';
import { onGround } from '../gfx/ground.js';
import { SPECIES } from './birds.js';

export class BirdDots {
	constructor(sim, atmo, pixelAngle, cap = 2000) {
		this.sim = sim;
		this.atmo = atmo;
		this.pixelAngle = pixelAngle;
		this.cap = cap;
		this.scene = new Scene();
		this.camXZ = uniform(new Vector2());
		this.dotPx = uniform(4); // średnica kropki (piksele)
		this.pos = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); // x, y, z, rozpiętość
		this.look = new InstancedBufferAttribute(new Float32Array(cap * 4), 4); // barwa, faza machania
		this.pos.setUsage(35048); this.look.setUsage(35048);
	}

	/** Głębia sceny z przebiegu kamery (zasłanianie) – woła createPost. */
	build(depthNode, projInv) {
		const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: NormalBlending });
		const P = instancedBufferAttribute(this.pos), Lk = instancedBufferAttribute(this.look);
		const world = onGround(P.xyz, this.camXZ);
		m.positionNode = world;
		const dist = length(cameraPosition.sub(world));
		const pxM = dist.mul(this.pixelAngle); // metry na piksel
		// rozpiętość na ekranie (piksele): punkt widoczny poniżej ~6 px, zanika, gdy pojawia się bryła (4–6 px)
		const spanPx = P.w.div(max(pxM, 1e-6));
		const fadeIn = smoothstep(4, 6, spanPx).oneMinus();
		// kropka ~2,5 px, migotanie w rytmie machania (skrzydła raz szerzej, raz wąsko)
		const flick = sin(Lk.w).mul(0.25).add(1);
		const size = pxM.mul(this.dotPx).mul(flick);
		m.scaleNode = vec2(size, size);
		const vViewZ = varying(cameraViewMatrix.mul(vec4(world, 1)).z, 'vDotViewZ');
		const vFade = varying(fadeIn.mul(smoothstep(2500, 3200, dist).oneMinus()), 'vDotFade');
		const vCol = varying(Lk.xyz, 'vDotCol');
		m.colorNode = Fn(() => {
			const d = depthNode.sample(screenUV).r;
			const sceneZ = getViewPosition(screenUV, d, projInv).z;
			If(d.greaterThan(0).and(vViewZ.lessThan(sceneZ.sub(2))), () => { Discard(); });
			const q = uv().sub(0.5).mul(2);
			const a = smoothstep(0.45, 1, dot(q, q)).oneMinus().mul(vFade);
			// barwa jak w świetle dnia: ciemne ptaki ciemne, jasne (bociany, mewy) – rozświetlone niebem
			const light = this.atmo.skyIrradiance().mul(0.25).add(0.02);
			// mieszanie zwykłe (SrcAlpha / 1−SrcAlpha): w celu barwa przemnożona przez krycie, krycie w kanale alfa
			return vec4(vCol.mul(light), a);
		})();
		const sprite = new Sprite(m);
		sprite.count = 0;
		sprite.frustumCulled = false;
		this.sprite = sprite;
		this.scene.add(sprite);
	}

	update(camera) {
		if (!this.sprite) return;
		this.camXZ.value.set(camera.position.x, camera.position.z);
		const p = this.pos.array, l = this.look.array;
		let n = 0;
		for (const g of this.sim.groups) {
			const col = SPECIES[g.id].col[0];
			for (const b of g.birds) {
				if (n >= this.cap) break;
				p.set([b.x, b.y, b.z, b.span], n * 4);
				l.set([col[0], col[1], col[2], b.phase], n * 4);
				n++;
			}
		}
		this.sprite.count = n;
		this.sprite.visible = n > 0;
		this.pos.needsUpdate = true;
		this.look.needsUpdate = true;
	}
}
