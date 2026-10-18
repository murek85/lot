// Wspólny materiał dla prostych brył (mosty, perony, słupy): kolor z atrybutu, normalne z geometrii, światło
// słońca po atmosferze, niebo, cienie chmur, samolotu i mapy cieni; krzywizna Ziemi jak u terenu.
// Do tego zbieracz geometrii z gotowymi bryłami (prostopadłościan wzdłuż odcinka, pionowa ściana).
import { BufferGeometry, BufferAttribute, Float32BufferAttribute, MeshBasicNodeMaterial, Vector2, DoubleSide } from 'three/webgpu';
import { GeoArrays } from './geobuilder.js';
import { Fn, vec3, attribute, varying, positionLocal, uniform, max, dot, normalize, mix, float } from 'three/tsl';
import { onGround, cityLight, worldOffset } from './ground.js';
import { valueNoise } from './noise.js';

const EARTH_R = 6371000;

export function makeLitMaterial({ atmo, clouds, plane, worldShadow, doubleSide = true }) {
	const m = new MeshBasicNodeMaterial({ side: doubleSide ? DoubleSide : undefined });
	const camXZ = uniform(new Vector2());
	m.userData.camXZ = camXZ;
	const vWorld = varying(vec3(0), 'vLitWorld');
	m.positionNode = Fn(() => {
		const p = positionLocal;
		vWorld.assign(p);
		const d = p.xz.sub(camXZ);
		return onGround(p, camXZ);
	})();
	const col = varying(attribute('aColor', 'vec3'), 'vLitColor');
	const nrm = varying(attribute('normal', 'vec3'), 'vLitNormal');
	m.colorNode = Fn(() => {
		const N = normalize(nrm);
		const sun = atmo.u.lightDir;
		const sunE = atmo.sunLight(vWorld.y);
		let shadow = clouds.groundShadow(vWorld).mul(plane.groundShadow(vWorld));
		if (worldShadow) shadow = shadow.mul(worldShadow.visibility(vWorld.add(N.mul(0.2)), 0.4));
		const albedo = col.mul(mix(float(0.88), float(1.08), valueNoise(vWorld.xz.add(worldOffset).add(vWorld.y).div(1.7))));
		const sky = atmo.skyIrradiance().mul(N.y.mul(0.5).add(0.5)).add(sunE.mul(max(0, sun.y)).mul(0.08).mul(float(1).sub(N.y)));
		return albedo.div(Math.PI).mul(sunE.mul(max(0, dot(N, sun))).mul(shadow).add(sky).add(plane.lights.landingLight(vWorld, N)).add(cityLight(vWorld)));
	})();
	m.fog = false;
	return m;
}

/** Zbieracz geometrii (src/gfx/geobuilder.js) z siatką Three.js. */
export class GeoBuilder extends GeoArrays {
	geometry() { return litGeometry(this); }
}

/** Siatka z tablic zbieracza (zwykłych albo typowanych z wątku kafli). */
export function litGeometry(a) {
	const g = new BufferGeometry();
	const attr = (v, n) => (v instanceof Float32Array ? new BufferAttribute(v, n) : new Float32BufferAttribute(v, n));
	g.setAttribute('position', attr(a.pos, 3));
	g.setAttribute('normal', attr(a.nrm, 3));
	g.setAttribute('aColor', attr(a.col, 3));
	g.setIndex(Array.isArray(a.idx) ? a.idx : new BufferAttribute(a.idx, 1));
	g.computeBoundingSphere();
	return g;
}
