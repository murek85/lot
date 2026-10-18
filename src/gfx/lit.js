// Wspólny materiał dla prostych brył (mosty, perony, słupy): kolor z atrybutu, normalne z geometrii, światło
// słońca po atmosferze, niebo, cienie chmur, samolotu i mapy cieni; krzywizna Ziemi jak u terenu.
// Do tego zbieracz geometrii z gotowymi bryłami (prostopadłościan wzdłuż odcinka, pionowa ściana).
import { BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Vector2, DoubleSide } from 'three/webgpu';
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

/** Zbieracz geometrii: płaskie ściany i prostopadłościany z kolorem. */
export class GeoBuilder {
	constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.count = 0; }

	quad(a, b, c, d, n, color) {
		const i = this.count;
		for (const p of [a, b, c, d]) { this.pos.push(...p); this.nrm.push(...n); this.col.push(...color); }
		this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
		this.count += 4;
	}

	/** Prostopadłościan wzdłuż odcinka (x0,z0)→(x1,z1), szerokość w, od y0 do y1. */
	beam(x0, z0, x1, z1, w, y0, y1, color, caps = true) {
		const len = Math.hypot(x1 - x0, z1 - z0) || 1;
		const tx = (x1 - x0) / len, tz = (z1 - z0) / len, nx = -tz * (w / 2), nz = tx * (w / 2);
		const A = [x0 + nx, z0 + nz], B = [x1 + nx, z1 + nz], C = [x1 - nx, z1 - nz], D = [x0 - nx, z0 - nz];
		const side = (p, q, n) => this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], n, color);
		side(A, B, [-tz, 0, tx]);
		side(C, D, [tz, 0, -tx]);
		if (caps) { side(B, C, [tx, 0, tz]); side(D, A, [-tx, 0, -tz]); }
		this.quad([A[0], y1, A[1]], [B[0], y1, B[1]], [C[0], y1, C[1]], [D[0], y1, D[1]], [0, 1, 0], color);
	}

	geometry() {
		const g = new BufferGeometry();
		g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
		g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
		g.setAttribute('aColor', new Float32BufferAttribute(this.col, 3));
		g.setIndex(this.idx);
		g.computeBoundingSphere();
		return g;
	}
}
