// Obraz końcowy: scena w HDR (kolor + wektory ruchu), chmury liczone po scenie (znają jej głębię), niebo i perspektywa
// powietrzna z fizycznej atmosfery, gradacja, wygładzanie czasowe TRAA (drgająca kamera + historia klatek),
// efekt miniatury (tilt-shift), opady i błyskawice (osobna scena, po wygładzaniu) i na końcu tone mapping.
import { RenderPipeline, TempNode, NodeUpdateType, Color } from 'three/webgpu';
import { pass, mrt, output, velocity, Fn, uv, vec3, vec4, If, normalize, uniform, getViewPosition, luminance, mix, max, float, select, exp, length } from 'three/tsl';
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

export function createPost(renderer, scene, camera, atmo, clouds, precip = null, overlay = null) {
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
	// błysk burzy: rozświetlenie całego obrazu (mocniej nieba i chmur), barwa chłodna
	const flash = uniform(0);
	// ulewa: szara zasłona deszczu w oddali (w dodatku do zamglenia powietrza)
	const veil = uniform(0);
	const veilColor = uniform(new Color(0.3, 0.32, 0.35));

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
		// zasłona opadu: rośnie z odległością (niebo – pełna), błysk rozświetla
		const far = select(d.lessThanEqual(0.0), float(1), float(1).sub(exp(length(offset).mul(-1 / 2500))));
		out.assign(mix(out, veilColor, far.mul(veil)));
		out.addAssign(vec3(0.75, 0.8, 1).mul(flash).mul(mix(float(0.35), float(1), select(d.lessThanEqual(0.0), float(1), cloud.a.oneMinus().mul(0.5).add(0.3)))));
		// gradacja: trochę nasycenia (w świetle liniowym, przed tone mappingiem)
		const lum = luminance(out);
		return vec4(max(vec3(0), mix(vec3(lum), out, saturation)), 1);
	});

	const aa = traa(composite(), depth, vel, camera);
	const ts = tiltShift(aa, depth, camera);
	const pipeline = new RenderPipeline(renderer);
	let outNode = ts.node;
	if (precip) {
		precip.build(depth, projInv);
		const precipPass = pass(precip.scene, camera);
		outNode = vec4(ts.node.rgb.add(precipPass.getTextureNode('output').rgb), 1);
	}
	if (overlay) {
		// nakładka po wygładzaniu (odległe ptaki jako punkty): barwa przemnożona przez krycie w kanale alfa
		overlay.build(depth, projInv);
		const ov = pass(overlay.scene, camera).getTextureNode('output');
		outNode = vec4(outNode.rgb.mul(float(1).sub(ov.a)).add(ov.rgb), 1);
	}
	pipeline.outputNode = outNode;
	return { pipeline, scenePass, saturation, flash, veil, veilColor, tiltShift: ts, render: () => pipeline.render() };
}
