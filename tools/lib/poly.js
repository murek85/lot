// Wielokąty obszarów w formacie .poly (Osmosis, Geofabrik) – granice wyciągów OSM dla własnych kafli.

/** Pierścienie (lon, lat) z pliku .poly (Osmosis); pierścienie z „!” – otwory. */
export function readPoly(text) {
	const rings = [];
	let cur = null;
	for (const line of text.split(/\r?\n/).slice(1)) {
		const t = line.trim();
		if (!t) continue;
		if (t === 'END') { if (cur) { rings.push(cur); cur = null; } continue; }
		if (!cur) { cur = { hole: t.startsWith('!'), pts: [] }; continue; }
		const [lon, lat] = t.split(/\s+/).map(Number);
		cur.pts.push([lon, lat]);
	}
	return rings;
}
/** Punkt w wielokącie (parzysto-nieparzyście po wszystkich pierścieniach, otwory działają same). */
export function inPoly(rings, lon, lat) {
	let inside = false;
	for (const { pts } of rings) {
		for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
			const [xi, yi] = pts[i], [xj, yj] = pts[j];
			if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}

