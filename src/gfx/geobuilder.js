// Zbieracz geometrii (ściany, belki) w tablicach – bez Three.js: działa w wątku głównym i w wątkach kafli.

/** Zbieracz geometrii: płaskie ściany i prostopadłościany z kolorem. */
export class GeoArrays {
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

	/** Belka o kwadratowym przekroju w między punktami a i b ([x, y, z]) w dowolnym kierunku (zastrzały, nogi kratownic). */
	strut(a, b, w, color) {
		const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1;
		const t = d.map((v) => v / L);
		// dwa wektory prostopadłe do osi
		const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		let u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
		const ul = Math.hypot(...u); u = u.map((v) => v / ul);
		const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
		const h = w / 2;
		const P = (p, su, sv) => [p[0] + (u[0] * su + v[0] * sv) * h, p[1] + (u[1] * su + v[1] * sv) * h, p[2] + (u[2] * su + v[2] * sv) * h];
		for (const [s1, s2, n] of [[[1, -1], [1, 1], u], [[1, 1], [-1, 1], v], [[-1, 1], [-1, -1], u.map((x) => -x)], [[-1, -1], [1, -1], v.map((x) => -x)]]) {
			this.quad(P(a, ...s1), P(a, ...s2), P(b, ...s2), P(b, ...s1), n, color);
		}
	}

	/** Pień stożka (walec, gdy r0 = r1) w (x, z) od y0 do y1, sides ścian z gładkimi normalnymi; cap – denko u góry. */
	tube(x, z, y0, y1, r0, r1, sides, color, cap = true) {
		const ny = (r0 - r1) / Math.max(1e-3, y1 - y0); // pochylenie ściany stożka
		for (let k = 0; k < sides; k++) {
			const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
			const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
			const i = this.count;
			for (const [c, s, r, y] of [[c0, s0, r0, y0], [c1, s1, r0, y0], [c1, s1, r1, y1], [c0, s0, r1, y1]]) {
				const l = Math.hypot(1, ny);
				this.pos.push(x + c * r, y, z + s * r); this.nrm.push(c / l, ny / l, s / l); this.col.push(...color);
			}
			this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
			this.count += 4;
		}
		if (cap && r1 > 0) {
			const i = this.count;
			this.pos.push(x, y1, z); this.nrm.push(0, 1, 0); this.col.push(...color);
			for (let k = 0; k <= sides; k++) {
				const a = (k / sides) * Math.PI * 2;
				this.pos.push(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1); this.nrm.push(0, 1, 0); this.col.push(...color);
			}
			for (let k = 0; k < sides; k++) this.idx.push(i, i + k + 2, i + k + 1);
			this.count += sides + 2;
		}
	}

	/** Tablice typowane (do przekazania z wątku bez kopiowania). */
	arrays() {
		return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col), idx: new Uint32Array(this.idx), count: this.count };
	}
}
