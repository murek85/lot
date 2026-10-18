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

	/** Tablice typowane (do przekazania z wątku bez kopiowania). */
	arrays() {
		return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col), idx: new Uint32Array(this.idx), count: this.count };
	}
}
