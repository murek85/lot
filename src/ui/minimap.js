// Minimapa (zaokrąglony kwadrat jak pozostałe panele): mapa bazowa regionu rysowana raz (pokrycie terenu w barwach mapy, cieniowanie rzeźby, woda, zabudowa,
// główne drogi i tory) do płótna; w locie z niej – wycinek wokół samolotu (północ u góry albo kurs u góry),
// trzy skale, nazwy miejscowości dobrane do skali, miejsca startu i strzałka samolotu. Wszystko w 2D (Canvas).

/** Barwy klas pokrycia (COVER: grass, forest, shrub, crop, built, bare, water, wetland) – jak na mapie turystycznej. */
export const MAP_COLORS = [
	[196, 214, 150], [92, 138, 80], [160, 170, 110], [226, 222, 170], [196, 186, 176], [222, 206, 170], [120, 170, 214], [150, 190, 170],
];
/** Skale: szerokość widoku (m) i jakie miejscowości podpisywać. */
export const SCALES = [
	{ km: 2, span: 2000, labels: ['city', 'town', 'village', 'suburb', 'quarter', 'hamlet', 'neighbourhood'] },
	{ km: 5, span: 5000, labels: ['city', 'town', 'village', 'suburb'] },
	{ km: 15, span: 15000, labels: ['city', 'town'] },
];

/**
 * Przeliczenie świat → minimapa: punkt (x, z) względem samolotu (px, pz), skala (piksele na metr), obrót
 * (kurs u góry: o −heading). Zwraca [u, v] w pikselach od środka minimapy (v w dół).
 */
export function worldToMap(x, z, px, pz, pxPerM, rotate, heading) {
	let dx = (x - px) * pxPerM, dz = (z - pz) * pxPerM;
	if (rotate) {
		const c = Math.cos(-heading), s = Math.sin(-heading);
		[dx, dz] = [dx * c - dz * s, dx * s + dz * c];
	}
	return [dx, dz];
}

/**
 * Mapa bazowa: płótno res×res całego regionu. region – z loadRegion (coverTex, heights, meta), osm – drogi i tory.
 * Rzeźba: cieniowanie od północnego zachodu (jak na mapach), wzmocnione na płaskim (Bory) i stonowane w górach.
 */
export async function buildBaseMap(region, osm, res = 4096) {
	const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(res, res) : document.createElement('canvas');
	cv.width = res; cv.height = res;
	const ctx = cv.getContext('2d');
	const img = ctx.createImageData(res, res);
	const cover = region.coverTex.image.data, cn = region.meta.cover.res;
	const H = region.heights, hn = region.meta.height.res, size = region.size;
	const cellH = size / hn, relief = Math.max(1, 30 / Math.max(10, region.meta.height.max - region.meta.height.min));
	// wiersze porcjami z przerwami – budowa nie zacina menu (całość ~1 s przy 4096²)
	const t0 = performance.now();
	let last = t0;
	for (let j = 0; j < res; j++) {
		if (performance.now() - last > 12) { await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
		const cj = Math.min(cn - 1, Math.floor((j / res) * cn)), hj = Math.min(hn - 2, Math.max(1, Math.floor((j / res) * hn)));
		for (let i = 0; i < res; i++) {
			const ci = Math.min(cn - 1, Math.floor((i / res) * cn)), hi = Math.min(hn - 2, Math.max(1, Math.floor((i / res) * hn)));
			const col = MAP_COLORS[cover[cj * cn + ci]] ?? MAP_COLORS[0];
			// cieniowanie: nachylenie w stronę światła z płn.-zach. (x – wschód, z – południe)
			const dx = (H[hj * hn + hi + 1] - H[hj * hn + hi - 1]) / (2 * cellH), dz = (H[(hj + 1) * hn + hi] - H[(hj - 1) * hn + hi]) / (2 * cellH);
			const shade = Math.max(0.55, Math.min(1.25, 1 - (dx + dz) * 2.2 * relief));
			const k = (j * res + i) * 4;
			img.data[k] = col[0] * shade; img.data[k + 1] = col[1] * shade; img.data[k + 2] = col[2] * shade; img.data[k + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	await new Promise((r) => setTimeout(r, 0));
	const toPx = (v) => (v / 10 / size + 0.5) * res; // decymetry → piksele mapy bazowej
	const line = (c) => { ctx.beginPath(); ctx.moveTo(toPx(c[0]), toPx(c[1])); for (let i = 2; i < c.length; i += 2) ctx.lineTo(toPx(c[i]), toPx(c[i + 1])); ctx.stroke(); };
	ctx.lineCap = ctx.lineJoin = 'round';
	const sc = res / 2048; // grubości linii jak przy 2048²
	const lw = (w) => w * sc;
	if (osm) {
		// cieki
		ctx.strokeStyle = 'rgb(110,160,210)';
		for (const [w10, c] of osm.waterways ?? []) { ctx.lineWidth = lw(w10 >= 60 ? 1.6 : 0.8); if (w10 >= 25) line(c); }
		// drogi: lokalne cienko na szaro, główne szerzej (obwódka i wypełnienie jak na mapie samochodowej)
		const roads = osm.roads.filter((r) => r[0] <= 4).sort((a, b) => b[0] - a[0]);
		for (const [cls, , , , , c] of roads) {
			if (cls === 4) { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = lw(0.9); line(c); }
		}
		const MAIN = [[3.6, 'rgb(150,60,40)', 'rgb(240,120,70)'], [2.8, 'rgb(150,100,40)', 'rgb(250,190,90)'], [2.2, 'rgb(150,130,60)', 'rgb(250,225,120)'], [1.6, 'rgb(130,130,120)', 'rgb(255,255,255)']];
		for (const pass of [1, 2]) for (const [cls, , , , , c] of roads) {
			if (cls > 3) continue;
			const [w, edge, fill] = MAIN[cls];
			ctx.strokeStyle = pass === 1 ? edge : fill;
			ctx.lineWidth = lw(pass === 1 ? w + 1 : w);
			line(c);
		}
		// tory: ciemna linia z poprzecznymi kreskami (uproszczone – przerywana)
		ctx.strokeStyle = 'rgb(60,60,70)';
		ctx.lineWidth = lw(1.4);
		ctx.setLineDash([3 * sc, 2 * sc]);
		for (const [kind, service, , , c] of osm.rails) if (kind < 2 && !service) line(c);
		ctx.setLineDash([]);
	}
	return cv;
}

const CLASS_FONT = { city: '700 13px', town: '700 12px', village: '600 11px', suburb: 'italic 500 10.5px', quarter: 'italic 500 10px', hamlet: '500 10px', neighbourhood: 'italic 500 9.5px' };

export class Minimap {
	/** canvas – płótno minimapy (kwadratowe), base – mapa bazowa, size – bok regionu (m), labels – [{ name, cls, x, z }]. */
	constructor(canvas, base, size, labels = [], starts = []) {
		this.cv = canvas;
		this.ctx = canvas.getContext('2d');
		this.base = base;
		this.size = size;
		this.labels = labels;
		this.starts = starts;
		this.scale = 1; // indeks SCALES
		this.rotate = true; // kurs u góry
		this.target = null; // cel lotu { x, z }
	}

	nextScale() { this.scale = (this.scale + 1) % SCALES.length; return SCALES[this.scale]; }
	toggleRotate() { this.rotate = !this.rotate; return this.rotate; }

	/** Rysuje minimapę dla samolotu w (px, pz), kurs heading (rad, 0 = północ). */
	draw(px, pz, heading) {
		const { cv, ctx, base } = this;
		const W = cv.width, R = W / 2;
		const S = SCALES[this.scale];
		const pxPerM = W / S.span;
		ctx.save();
		ctx.clearRect(0, 0, W, W);
		// kwadrat z zaokrąglonymi rogami (jak panele interfejsu)
		const rr = W * 0.045;
		ctx.beginPath();
		ctx.roundRect(0, 0, W, W, rr);
		ctx.clip();
		// czy punkt (u, v od środka) mieści się w kwadracie z marginesem m
		const inside = (u, v, m) => Math.abs(u) < R - m && Math.abs(v) < R - m;
		// punkt na brzegu kwadratu (z marginesem m) w kierunku (u, v)
		const edgeAt = (u, v, m) => { const k = (R - m) / Math.max(Math.abs(u), Math.abs(v), 1e-6); return [R + u * k, R + v * k]; };
		ctx.fillStyle = 'rgb(70,78,86)'; // poza regionem
		ctx.fillRect(0, 0, W, W);
		// wycinek mapy bazowej: obrót wokół środka (kurs u góry) i przesunięcie do samolotu
		ctx.translate(R, R);
		if (this.rotate) ctx.rotate(-heading);
		const k = base.width / this.size; // piksele bazy na metr
		const bx = (px / this.size + 0.5) * base.width, bz = (pz / this.size + 0.5) * base.height;
		ctx.scale(pxPerM / k, pxPerM / k);
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(base, -bx, -bz);
		ctx.restore();
		// pierścień odległości (połowa promienia) i krawędź
		ctx.save();
		ctx.strokeStyle = 'rgba(20,28,36,0.25)';
		ctx.lineWidth = 1;
		ctx.beginPath(); ctx.arc(R, R, R / 2, 0, Math.PI * 2); ctx.stroke();
		// nazwy miejscowości (w kolejności ważności – mniej ważne pomijane, gdy nachodzą)
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const taken = [];
		for (const l of this.labels) {
			if (!S.labels.includes(l.cls)) continue;
			const [u, v] = worldToMap(l.x, l.z, px, pz, pxPerM, this.rotate, heading);
			if (!inside(u, v, 10)) continue;
			const x = R + u, y = R + v;
			ctx.font = `${CLASS_FONT[l.cls] ?? '500 10px'} system-ui, sans-serif`;
			const w = ctx.measureText(l.name).width;
			if (taken.some((t) => Math.abs(t[0] - x) < (t[2] + w) / 2 + 2 && Math.abs(t[1] - y) < 12)) continue;
			taken.push([x, y, w]);
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(255,255,255,0.85)';
			ctx.fillStyle = l.cls === 'city' || l.cls === 'town' ? 'rgb(30,30,36)' : 'rgb(60,60,70)';
			ctx.strokeText(l.name, x, y);
			ctx.fillText(l.name, x, y);
		}
		// miejsca startu: małe romby
		ctx.fillStyle = '#f6c344';
		ctx.strokeStyle = 'rgba(30,20,0,0.8)';
		for (const s of this.starts) {
			const [u, v] = worldToMap(s.x, s.z, px, pz, pxPerM, this.rotate, heading);
			if (!inside(u, v, 6)) continue;
			ctx.beginPath(); ctx.moveTo(R + u, R + v - 5); ctx.lineTo(R + u + 4, R + v); ctx.lineTo(R + u, R + v + 5); ctx.lineTo(R + u - 4, R + v); ctx.closePath();
			ctx.fill(); ctx.stroke();
		}
		// cel lotu: znacznik, a poza zasięgiem – strzałka na obwodzie w jego kierunku
		if (this.target) {
			const [u, v] = worldToMap(this.target.x, this.target.z, px, pz, pxPerM, this.rotate, heading);
			ctx.fillStyle = '#8fd0ff';
			ctx.strokeStyle = 'rgba(0,20,40,0.9)';
			ctx.lineWidth = 1.5;
			if (inside(u, v, 10)) {
				ctx.beginPath(); ctx.arc(R + u, R + v, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
			} else {
				const a = Math.atan2(v, u), [ex, ey] = edgeAt(u, v, 9);
				ctx.save(); ctx.translate(ex, ey); ctx.rotate(a + Math.PI / 2);
				ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
				ctx.restore();
			}
		}
		// północ na obwodzie (przy kursie u góry – obraca się)
		const na = this.rotate ? -heading : 0;
		const [nx, ny] = edgeAt(Math.sin(na), -Math.cos(na), 10);
		ctx.font = '700 12px system-ui, sans-serif';
		ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.fillStyle = '#f6c344';
		ctx.strokeText('N', nx, ny); ctx.fillText('N', nx, ny);
		// samolot: strzałka w środku (kurs u góry – zawsze w górę)
		ctx.translate(R, R);
		ctx.rotate(this.rotate ? 0 : heading);
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = 'rgba(0,0,0,0.75)';
		ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
		ctx.fill(); ctx.stroke();
		ctx.restore();
	}
}
