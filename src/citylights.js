// Nocne światła osad: latarnie wzdłuż ulic w zabudowie (z OSM: drogi od głównych po osiedlowe tam, gdzie wokół
// stoją domy) i okna zapalone zależnie od godziny. Latarnia to poświata (sprite, nie mniejsza niż kilka pikseli –
// widać łańcuchy świateł z daleka) i plama światła na ziemi; plamy wszystkich latarni są wypalone do tekstury
// regionu, więc teren, drogi, budynki i drzewa doliczają je jednym odczytem. Sterowanie: update(godzina, słońce).
import { Sprite, SpriteNodeMaterial, AdditiveBlending, DataTexture, RedFormat, UnsignedByteType, LinearFilter, InstancedBufferAttribute, Vector2 } from 'three/webgpu';
import { uniform, texture, vec3, float, uv, dot, exp, max, mix, cameraPosition, length, instancedBufferAttribute, clamp } from 'three/tsl';
import { densify } from './roads.js';
import { onGround } from './gfx/ground.js';
import { rng } from './clouds/noise3d.js';

const RES = 4096; // tekstura plam światła (≈11 m na piksel w regionie 46 km)
const SPACING = 34; // odstęp latarni (m)
const DENSE = 50; // komórka siatki gęstości zabudowy (m)

/** Odsetek zapalonych okien o danej godzinie (czas lokalny). */
export function windowsLit(hour) {
	const h = ((hour % 24) + 24) % 24;
	const pts = [[0, 0.16], [2, 0.08], [4.5, 0.06], [6, 0.2], [8, 0.1], [16, 0.1], [19, 0.42], [21.5, 0.5], [23, 0.3], [24, 0.16]];
	for (let i = 1; i < pts.length; i++) {
		if (h <= pts[i][0]) {
			const [h0, v0] = pts[i - 1], [h1, v1] = pts[i];
			return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
		}
	}
	return 0.16;
}

/** Punkty co ~step metrów wzdłuż linii, na przemian po obu stronach (odsunięcie offset). */
export function lampPositions(pts, step, offset) {
	const out = [];
	let carry = step / 2, side = 1;
	for (let i = 2; i < pts.length; i += 2) {
		const x0 = pts[i - 2], z0 = pts[i - 1], x1 = pts[i], z1 = pts[i + 1];
		const len = Math.hypot(x1 - x0, z1 - z0);
		if (len < 0.01) continue;
		const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
		let d = carry;
		while (d < len) {
			out.push([x0 + tx * d - tz * offset * side, z0 + tz * d + tx * offset * side]);
			side = -side;
			d += step;
		}
		carry = d - len;
	}
	return out;
}

export function createCityLights(osm, region) {
	const size = region.size, half = size / 2 - 30;
	// gęstość zabudowy: liczba budynków w komórce 50 m (ulica „w osadzie”, gdy w sąsiedztwie stoi kilka domów)
	const gn = Math.ceil(size / DENSE);
	const dens = new Uint16Array(gn * gn);
	const cellOf = (x, z) => {
		const i = Math.floor((x + size / 2) / DENSE), j = Math.floor((z + size / 2) / DENSE);
		return i < 0 || j < 0 || i >= gn || j >= gn ? -1 : j * gn + i;
	};
	for (const [type, , , , c] of osm.buildings) {
		if (type === 2) continue; // budynki gospodarcze nie świadczą o ulicy z latarniami
		const k = cellOf(c[0] / 10, c[1] / 10);
		if (k >= 0) dens[k]++;
	}
	const built = (x, z) => {
		const i = Math.floor((x + size / 2) / DENSE), j = Math.floor((z + size / 2) / DENSE);
		let n = 0;
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
			const ii = i + di, jj = j + dj;
			if (ii >= 0 && jj >= 0 && ii < gn && jj < gn) n += dens[jj * gn + ii];
		}
		return n >= 4;
	};

	const lamps = [];
	const r = rng(9090);
	for (const [cls, w10, , bridge, , c] of osm.roads) {
		if (cls < 1 || cls > 4) continue;
		const p = [];
		for (let i = 0; i < c.length; i += 2) p.push(c[i] / 10, c[i + 1] / 10);
		if (p.length < 4 || !p.every((v) => Math.abs(v) < half)) continue;
		for (const [x, z] of lampPositions(densify(p, 20), SPACING, w10 / 20 + 1.2)) {
			if (!built(x, z) && !bridge) continue;
			lamps.push([x, z, r() < 0.55 ? 0 : 1]); // 0 – sodowa (pomarańczowa), 1 – LED (biała)
		}
	}

	// plamy światła: gaussowskie, promień ~16 m (dwie komórki tekstury), sumowane i przycięte
	const acc = new Float32Array(RES * RES);
	const cell = size / RES;
	for (const [x, z] of lamps) {
		const fx = (x + size / 2) / cell - 0.5, fz = (z + size / 2) / cell - 0.5;
		const i0 = Math.floor(fx), j0 = Math.floor(fz);
		for (let j = j0 - 2; j <= j0 + 3; j++) for (let i = i0 - 2; i <= i0 + 3; i++) {
			if (i < 0 || j < 0 || i >= RES || j >= RES) continue;
			const d2 = ((i - fx) ** 2 + (j - fz) ** 2) * cell * cell;
			acc[j * RES + i] += Math.exp(-d2 / (2 * 11 * 11));
		}
	}
	const data = new Uint8Array(RES * RES);
	for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.round(acc[i] * 200));
	const tex = new DataTexture(data, RES, RES, RedFormat, UnsignedByteType);
	tex.minFilter = tex.magFilter = LinearFilter;
	tex.needsUpdate = true;
	const lightTex = texture(tex);

	const U = {
		street: uniform(0), // 0..1 – latarnie włączone
		windows: uniform(0), // odsetek zapalonych okien
		glow: uniform(0), // jasność poświat latarni (z adaptacją oka)
		winGlow: uniform(1), // jasność okien (z adaptacją oka)
		camXZ: uniform(new Vector2()),
	};
	const STREET_E = 0.5; // natężenie pod latarnią (księżyc w pełni po wzmocnieniu ≈ 0,05)
	return {
		lamps, uniforms: U, texture: tex,
		/** Natężenie światła latarni na ziemi w punkcie p (świat). */
		groundLight(p) {
			const st = p.xz.div(size).add(0.5);
			const v = lightTex.sample(st).level(0).r;
			return vec3(1.0, 0.72, 0.42).mul(v.mul(255 / 200).mul(STREET_E).mul(U.street));
		},
		/** Poświaty latarni – jeden sprite z instancjami; wymaga wysokości terenu (po utworzeniu terenu). */
		createGlows(terrain, pixelAngle) {
			const n = lamps.length;
			const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
			lamps.forEach(([x, z, kind], i) => {
				pos.set([x, terrain.meshHeightAt(x, z) + 7.5, z], i * 3);
				col.set(kind ? [0.85, 0.9, 1.0] : [1.0, 0.62, 0.28], i * 3);
			});
			const m = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
			const center = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3));
			const color = instancedBufferAttribute(new InstancedBufferAttribute(col, 3));
			const world = onGround(center, U.camXZ);
			m.positionNode = world;
			// rozmiar: 1,2 m z bliska, z daleka nie mniej niż ~4 piksele (mały sprite – mało pikseli do wypełnienia)
			const dist = length(cameraPosition.sub(world));
			const s = max(float(1.2), dist.mul(pixelAngle).mul(4)).min(80); // górna granica – pojedyncze sprite'y nie mogą urosnąć na pół ekranu
			m.scaleNode = vec3(s, s, 1).xy;
			const q = uv().sub(0.5).mul(2);
			const r2 = dot(q, q);
			const f = exp(r2.mul(-9)).add(float(0.06).div(r2.mul(12).add(1))).mul(clamp(float(1).sub(r2), 0, 1));
			m.colorNode = color.mul(f.mul(U.glow).mul(1.6));
			const sprite = new Sprite(m);
			sprite.count = n;
			sprite.frustumCulled = false;
			sprite.renderOrder = 15;
			return sprite;
		},
		/** Godzina lokalna, wysokość słońca (sun.y), adaptacja oka (≤ 1 nocą), kamera. */
		update(hour, sunY, adapt, camera) {
			const dusk = Math.min(1, Math.max(0, (0.03 - sunY) / 0.06));
			U.street.value = dusk;
			U.windows.value = windowsLit(hour) * Math.min(1, Math.max(0, (0.12 - sunY) / 0.15));
			U.glow.value = dusk * adapt;
			U.winGlow.value = adapt;
			U.camXZ.value.set(camera.position.x, camera.position.z);
		},
	};
}
