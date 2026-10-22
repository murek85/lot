// Obraz końcowy: scena w HDR (kolor + wektory ruchu), chmury liczone po scenie (znają jej głębię), niebo i perspektywa
// powietrzna z fizycznej atmosfery, poranna mgła w dolinach (otwarty świat), gradacja, wygładzanie czasowe TRAA (drgająca kamera + historia klatek),
// wyostrzenie (RCAS – oddaje detale rozmyte przez TRAA), poświata jasnych świateł (bloom), efekt miniatury
// (tilt-shift), opady i błyskawice (osobna scena, po wygładzaniu) i na końcu tone mapping.
import { RenderPipeline, TempNode, NodeUpdateType, Color } from 'three/webgpu';
import { pass, mrt, output, velocity, Fn, uv, vec3, vec4, If, normalize, uniform, getViewPosition, luminance, mix, max, float, select, exp, length, abs, clamp, smoothstep } from 'three/tsl';
import { RELIEF } from './world/reliefshade.js';
import { worldOffset } from './gfx/ground.js';
import { valueNoise } from './gfx/noise.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
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
	// poranna mgła w dolinach 0..1 (pora dnia, wiatr, pogoda, pora roku – src/weather/weather.js: valleyFog)
	const fog = uniform(0);

	/**
	 * Mgła radiacyjna w obniżeniach terenu (otwarty świat): grunt w punkcie p leży `under` metrów pod poziomem okolicy
	 * (wysokość wygładzona ~1 km – kanał A zgrubnego okna rzeźby); mgła wypełnia obniżenie do kilku metrów pod tym
	 * poziomem, w plamach. Promień z góry przechodzi przez warstwę tym dłużej, im bardziej ukośnie patrzymy.
	 * Zwraca kolor gruntu za mgłą.
	 */
	const valleyFog = (ground, p, dir) => {
		const R = RELIEF;
		const res = ground.toVar();
		If(fog.greaterThan(0.001).and(R.on.greaterThan(0.5)).and(R.smooth.greaterThan(0.5)), () => {
			const c = R.coarse.sample(p.xz.div(R.coarseSize)).level(0);
			const edge = max(abs(p.x.sub(R.coarseC.x)), abs(p.z.sub(R.coarseC.y)));
			const inside = float(1).sub(smoothstep(R.coarseReach.mul(0.85), R.coarseReach, edge)).mul(c.b);
			const under = c.a.add(R.coarseBase).sub(p.y);
			// plamy i jęzory mgły (stałe względem Ziemi – worldOffset)
			const q = p.xz.add(worldOffset);
			const patch = valueNoise(q.div(900)).mul(0.6).add(valueNoise(q.div(260)).mul(0.4));
			const thick = smoothstep(0, 18, under).mul(clamp(under, 0, 120)).mul(smoothstep(0.25, 0.65, patch)).mul(inside).mul(fog);
			const od = thick.div(max(dir.y.negate(), 0.07)).mul(0.03);
			const T = exp(od.negate());
			// mgła jak biała, rozpraszająca powierzchnia w świetle słońca i nieba (bez cieni – warstwa leży nad nimi)
			const sun = atmo.u.lightDir;
			const light = atmo.sunLight(p.y.add(thick)).mul(max(0, sun.y)).add(atmo.skyIrradiance()).mul(0.85 / Math.PI);
			res.assign(ground.mul(T).add(light.mul(float(1).sub(T))));
		});
		return res;
	};

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
			const ground = valleyFog(color.sample(st).rgb, camPos.add(offset), dir);
			out.assign(ground.mul(transmittance).add(inscatter));
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
	// wyostrzenie z adaptacją do kontrastu (0 – najmocniej, 2 – wcale; ustawienie „Wyostrzenie obrazu”)
	const sharpness = uniform(1);
	const sharp = sharpen(aa, sharpness);
	// poświata: tylko to, co po ekspozycji jaśniejsze od bieli (odblask słońca na wodzie, światła miast i reflektory
	// nocą, błyskawice) – obraz przemnożony przez bieżącą ekspozycję (tone mapping jest na końcu, w rendererze),
	// więc próg działa tak samo w południe i w nocy; wynik z powrotem w jednostkach sceny
	const exposure = uniform(1);
	const glowStrength = uniform(0.3);
	const glow = bloom(sharp.rgb.mul(exposure), glowStrength, 0.55, 1.0);
	glow.smoothWidth.value = 0.6;
	const lit = vec4(sharp.rgb.add(glow.rgb.div(max(exposure, 1e-4))), 1);
	const ts = tiltShift(lit, depth, camera);
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
	/**
	 * Historia wygładzania od nowa (z bieżącej klatki) – po przesunięciu początku układu otwartego świata wektory ruchu
	 * jednej klatki są błędne (three trzyma poprzednie macierze kamery u siebie), więc lepiej nie sięgać do historii.
	 * TRAA zaczyna od nowa przy zmianie rozmiaru – udajemy ją, psując zapamiętany rozmiar historii.
	 */
	const resetHistory = () => { if (aa._historyRenderTarget) aa._historyRenderTarget.width = 0; };
	/** Ustawienia obrazu: glow 0..2 (poświata, 0 – wyłączona), sharp 0..1 (wyostrzenie, 0 – wyłączone). */
	const setLook = ({ glow: g, sharp: sh }) => {
		if (g !== undefined) glowStrength.value = 0.3 * g;
		if (sh !== undefined) sharpness.value = 2 - 2 * sh;
	};
	return {
		pipeline, scenePass, saturation, flash, veil, veilColor, fog, tiltShift: ts, resetHistory, setLook,
		render: () => { exposure.value = renderer.toneMappingExposure; pipeline.render(); },
	};
}
