// Wstęgi wzdłuż linii (drogi, tory, rzeki) – sama geometria w tablicach, bez Three.js: używana w wątku głównym
// i w wątkach kafli otwartego świata (src/world/chunkworker.js).

const STEP = 12; // maksymalna długość odcinka wstęgi (m) – żeby nadążała za rzeźbą

/** Zagęszcza linię (pary x, z w metrach) tak, by żaden odcinek nie był dłuższy niż step. */
export function densify(pts, step = STEP) {
	const out = [pts[0], pts[1]];
	for (let i = 2; i < pts.length; i += 2) {
		const x0 = out[out.length - 2], z0 = out[out.length - 1], x1 = pts[i], z1 = pts[i + 1];
		const d = Math.hypot(x1 - x0, z1 - z0);
		if (d < 0.01) continue;
		const k = Math.ceil(d / step);
		for (let j = 1; j <= k; j++) out.push(x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k);
	}
	return out;
}

/**
 * Wstęga wzdłuż linii: dwa wierzchołki na punkt, przesunięte w bok o połowę szerokości (z ograniczonym „uskokiem”
 * na ostrych załamaniach). heightAt(x, z) → y. Zwraca tablice pozycji, strony (−1/1), odległości wzdłuż i indeksów.
 */
export function ribbon(pts, halfWidth, heightAt, startIndex = 0) {
	const n = pts.length / 2;
	const pos = [], side = [], dist = [], idx = [];
	let along = 0;
	for (let i = 0; i < n; i++) {
		const x = pts[i * 2], z = pts[i * 2 + 1];
		const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
		const nx = pts[Math.min(n - 1, i + 1) * 2], nz = pts[Math.min(n - 1, i + 1) * 2 + 1];
		let tx = nx - px, tz = nz - pz;
		const tl = Math.hypot(tx, tz) || 1;
		tx /= tl; tz /= tl;
		// miter: przy załamaniu odsunięcie rośnie, ale najwyżej 2×
		let mx = -tz, mz = tx;
		if (i > 0 && i < n - 1) {
			const ax = x - px, az = z - pz, al = Math.hypot(ax, az) || 1;
			const dotv = (-az / al) * mx + (ax / al) * mz;
			const s = 1 / Math.max(0.5, dotv);
			mx *= s; mz *= s;
		}
		if (i > 0) along += Math.hypot(x - px, z - pz);
		const y = heightAt(x, z);
		for (const sgn of [-1, 1]) {
			pos.push(x + mx * halfWidth * sgn, y, z + mz * halfWidth * sgn);
			side.push(sgn);
			dist.push(along);
		}
		if (i > 0) {
			const a = startIndex + (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
			idx.push(a, b, c, b, d, c); // przeciwnie do wskazówek zegara patrząc z góry – przód wstęgi w górę
		}
	}
	return { pos, side, dist, idx };
}
