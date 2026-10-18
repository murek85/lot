// Obróbka danych OpenStreetMap do kompaktowej postaci gry: drogi, tory, budynki, cieki, linie energetyczne,
// szpalery drzew, stacje i przejazdy. Współrzędne w lokalnych metrach regionu (decymetry jako liczby całkowite).
import { lonLatToLocal } from '../../src/geo.js';
import { ROAD } from '../../src/gen/schema.js';
import { roadInfo, buildingInfo, num } from '../../src/gen/osmtags.js';

export { ROAD, roadInfo, buildingInfo };
/** Ilość punktów, przeliczona i zaokrąglona do decymetrów. */
function project(geom, center) {
	const out = new Array(geom.length * 2);
	geom.forEach((g, i) => {
		const p = lonLatToLocal(g.lon, g.lat, center);
		out[i * 2] = Math.round(p.x * 10);
		out[i * 2 + 1] = Math.round(p.z * 10);
	});
	return out;
}

/** Pole wielokąta (m², ze znakiem) z płaskiej listy decymetrów. */
export function polygonArea(c) {
	let a = 0;
	const n = c.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		a += c[i * 2] * c[j * 2 + 1] - c[j * 2] * c[i * 2 + 1];
	}
	return a / 2 / 100;
}

/** Zbiera elementy z wielu odpowiedzi Overpass (kafelki nakładają się – usuwa duplikaty po id). */
export function collect(responses, center) {
	const seen = new Set();
	const out = {
		roads: [], rails: [], buildings: [], waterways: [], power: [], treeRows: [], stations: [], crossings: [], platforms: [],
	};
	for (const res of responses) {
		for (const e of res.elements) {
			const key = e.type + e.id;
			if (seen.has(key)) continue;
			seen.add(key);
			const t = e.tags || {};
			if (e.type === 'node') {
				const p = lonLatToLocal(e.lon, e.lat, center);
				const xy = [Math.round(p.x * 10), Math.round(p.z * 10)];
				if (t.railway === 'station' || t.railway === 'halt') out.stations.push({ p: xy, name: t.name || '', halt: t.railway === 'halt' ? 1 : 0 });
				else if (t.railway === 'level_crossing' || t.railway === 'crossing') out.crossings.push({ p: xy, barrier: t['crossing:barrier'] && t['crossing:barrier'] !== 'no' ? 1 : 0 });
				continue;
			}
			if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
			const c = project(e.geometry, center);
			const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
			const tunnel = t.tunnel && t.tunnel !== 'no' ? 1 : 0;
			const layer = num(t.layer) ?? 0;
			if (t.building && !t['building:part']) {
				if (c.length < 8) continue;
				const b = buildingInfo(t);
				out.buildings.push({ c, ...b, name: t.name || undefined });
			} else if (t.highway) {
				const r = roadInfo(t);
				if (!r || tunnel) continue;
				if (t.area === 'yes') continue;
				out.roads.push({ c, ...r, bridge, layer });
			} else if (t.railway) {
				if (t.railway === 'platform') { out.platforms.push({ c }); continue; }
				const kind = { rail: 0, light_rail: 0, narrow_gauge: 1, disused: 2, abandoned: 3 }[t.railway];
				if (kind === undefined || tunnel) continue;
				out.rails.push({ c, kind, service: t.service ? 1 : 0, bridge, layer });
			} else if (t.waterway) {
				const w = { river: 12, canal: 6, stream: 2.5, ditch: 1.2, drain: 1.2 }[t.waterway];
				if (!w) continue;
				out.waterways.push({ c, width: num(t.width) ?? w });
			} else if (t.power === 'line' || t.power === 'minor_line') {
				out.power.push({ c, minor: t.power === 'minor_line' ? 1 : 0 });
			} else if (t.natural === 'tree_row') {
				out.treeRows.push({ c });
			}
		}
	}
	return out;
}
