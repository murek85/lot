// Obraz końcowy: scena w HDR (kolor + wektory ruchu), chmury liczone po scenie (znają jej głębię), niebo i perspektywa
// powietrzna z fizycznej atmosfery, gradacja, wygładzanie czasowe TRAA (drgająca kamera + historia klatek),
// efekt miniatury (tilt-shift) i na końcu tone mapping.
import { RenderPipeline, TempNode, NodeUpdateType } from 'three/webgpu';
import { pass, mrt, output, velocity, Fn, uv, vec3, vec4, If, normalize, uniform, getViewPosition, luminance, mix, max } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { tiltShift } from './gfx/tiltshift.js';

/** Węzeł, który przed użyciem wyniku liczy chmury – w potoku jest budowany po głębi sceny, więc i liczony po niej. */
class CloudStepNode extends TempNode {
	constructor(clouds, result) {
		super('vec4');
		this.clouds = clouds;
		this.result = result;
		this.updateBeforeType = NodeUpdateType.FRAME;
	}

	updateBefore() {
		this.clouds.render();
	}

	setup() {
		return this.result;
	}
}

export function createPost(renderer, scene, camera, atmo, clouds) {
	const scenePass = pass(scene, camera);
	scenePass.setMRT(mrt({ output, velocity }));
	const color = scenePass.getTextureNode('output');
	const depth = scenePass.getTextureNode('depth');
	const vel = scenePass.getTextureNode('velocity');
	clouds.useSceneDepth(scenePass.getTexture('depth'), camera);
	// Uwaga: wbudowane cameraPosition/cameraWorldMatrix w przebiegu końcowym należą do kamery prostokąta ekranu,
	// a nie sceny – dlatego macierze kamery sceny podajemy jawnie (śledzą obiekty kamery na bieżąco).
	const projInv = uniform(camera.projectionMatrixInverse);
	const camWorld = uniform(camera.matrixWorld);
	const camPos = uniform(camera.position);
	const saturation = uniform(1.08);

	const composite = Fn(() => {
		const st = uv();
		const d = depth.sample(st).r;
		const viewPos = getViewPosition(st, d, projInv);
		const offset = camWorld.mul(vec4(viewPos, 0)).xyz;
		const dir = normalize(offset);
		const out = vec3(0).toVar();
		// odwrócony bufor głębi: 0 = nieskończoność (niebo)
		If(d.lessThanEqual(0.0), () => {
			out.assign(atmo.skyRadiance(dir).add(atmo.sunDisk(dir)).add(atmo.nightSky(dir)));
		}).Else(() => {
			const { inscatter, transmittance } = atmo.aerial(camPos.y, offset);
			out.assign(color.sample(st).rgb.mul(transmittance).add(inscatter));
		});
		// chmury (pół rozdzielczości, wygładzone czasowo, przycięte głębią sceny): ich światło + tło przez nie
		const cloud = new CloudStepNode(clouds, clouds.sample(st));
		out.assign(cloud.rgb.add(out.mul(cloud.a)));
		// gradacja: trochę nasycenia (w świetle liniowym, przed tone mappingiem)
		const lum = luminance(out);
		return vec4(max(vec3(0), mix(vec3(lum), out, saturation)), 1);
	});

	const aa = traa(composite(), depth, vel, camera);
	const ts = tiltShift(aa, depth, camera);
	const pipeline = new RenderPipeline(renderer);
	pipeline.outputNode = ts.node;
	return { pipeline, scenePass, saturation, tiltShift: ts, render: () => pipeline.render() };
}
