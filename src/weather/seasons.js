// Barwy krajobrazu w porach roku (albedo liniowe, jak src/gfx/palette.js) – bez Three.js, testowane w Node.
// Lato to dotychczasowa paleta (koniec czerwca); pozostałe pory zmieniają uprawy na polach, trawę (mnożnik barwy)
// i liście drzew liściastych (kolor wiosenny/letni oraz udział drzew przebarwionych jesienią). Śnieg i nagie drzewa
// zimą – osobno (snowCover, bareTrees w src/gfx/ground.js).

const SUMMER = {
	// koniec czerwca: przewaga zbóż, rzepak w łuszczynach, jęczmień żółknie, mało gołej ziemi
	crops: {
		rapeseed: [0.150, 0.170, 0.065],
		cereal: [0.110, 0.190, 0.050],
		wheat: [0.140, 0.185, 0.090],
		ripening: [0.220, 0.190, 0.075],
		maize: [0.085, 0.100, 0.045],
		soil: [0.120, 0.098, 0.074],
	},
	grass: [1, 1, 1],
	leaf: [0.058, 0.100, 0.026],
	autumnLeaf: [0.150, 0.110, 0.030],
	autumnRed: [0.170, 0.060, 0.022],
	autumn: 0,
	bare: 0,
	// bele słomy na ścierniskach, bele siana na łąkach kośnych, fale wiatru na łanach zbóż (0..1)
	balesStubble: 0, balesHay: 0.6, waves: 1,
};

export const SEASON_PALETTE = {
	// 1 maja: rzepak kwitnie (jaskrawożółte łany), zboża młode i soczyste, kukurydza dopiero wschodzi (goła ziemia
	// w rzędach), świeża jasna zieleń łąk i liści
	spring: {
		crops: {
			rapeseed: [0.340, 0.280, 0.025],
			cereal: [0.085, 0.175, 0.040],
			wheat: [0.095, 0.165, 0.055],
			ripening: [0.100, 0.180, 0.045],
			maize: [0.110, 0.090, 0.068],
			soil: [0.095, 0.078, 0.060],
		},
		grass: [0.95, 1.12, 0.92],
		leaf: [0.074, 0.138, 0.030],
		autumnLeaf: [0.150, 0.110, 0.030],
		autumnRed: [0.170, 0.060, 0.022],
		autumn: 0,
		bare: 0,
		balesStubble: 0, balesHay: 0, waves: 1,
	},
	summer: SUMMER,
	// 26 września: po żniwach – ścierniska, pola zaorane i wschody ozimin, kukurydza sucha przed zbiorem, trawa
	// przyżółkła, pierwsze liściaste (ok. 1/5) żółkną
	autumn: {
		crops: {
			rapeseed: [0.075, 0.120, 0.040], // ozimy rzepak – wschody
			cereal: [0.235, 0.195, 0.115], // ściernisko
			wheat: [0.100, 0.082, 0.064], // podorywka
			ripening: [0.210, 0.180, 0.105], // ściernisko z samosiewami
			maize: [0.200, 0.160, 0.070], // kukurydza dojrzała
			soil: [0.085, 0.070, 0.055], // świeża orka
		},
		grass: [1.1, 0.95, 0.78],
		leaf: [0.070, 0.105, 0.030],
		autumnLeaf: [0.165, 0.118, 0.032],
		autumnRed: [0.180, 0.065, 0.024],
		autumn: 0.2,
		bare: 0,
		balesStubble: 1, balesHay: 0, waves: 0,
	},
	// 3 stycznia: pola pod śniegiem (w plamach – oziminy i zaorana ziemia), trawa zżółkła i przymarznięta;
	// liście bez znaczenia – drzewa liściaste nagie (bareTrees)
	winter: {
		crops: {
			rapeseed: [0.060, 0.085, 0.035],
			cereal: [0.070, 0.090, 0.040],
			wheat: [0.095, 0.080, 0.062],
			ripening: [0.150, 0.130, 0.085],
			maize: [0.140, 0.115, 0.070],
			soil: [0.080, 0.066, 0.052],
		},
		grass: [1.05, 0.82, 0.62],
		leaf: [0.058, 0.100, 0.026],
		autumnLeaf: [0.150, 0.110, 0.030],
		autumnRed: [0.170, 0.060, 0.022],
		autumn: 0,
		bare: 1,
		balesStubble: 0, balesHay: 0, waves: 0,
	},
};

/** Paleta pory roku (nieznana pora – lato). */
export const seasonPalette = (id) => SEASON_PALETTE[id] ?? SUMMER;

const P = SEASON_PALETTE, W = P.winter, SP = P.spring, SU = SUMMER, AU = P.autumn;
const with_ = (base, over) => ({ ...base, ...over, crops: { ...base.crops, ...(over.crops ?? {}) } });
/**
 * Klatki kalendarza (dzień roku 1–365) między czterema porami z menu: przedwiośnie (pąki, młode oziminy), pełnia
 * kwitnienia rzepaku, dojrzałe łany przed żniwami, ścierniska po żniwach, szczyt jesiennych barw (złoto i czerwień)
 * i opadanie liści. Paleta dnia – liniowo między sąsiednimi klatkami (w kółko przez Nowy Rok).
 */
export const CALENDAR = [
	[3, W],
	[60, W],
	[95, with_(SP, { crops: { rapeseed: [0.075, 0.140, 0.035], cereal: [0.075, 0.150, 0.038], maize: [0.100, 0.082, 0.062] }, grass: [1, 0.98, 0.85], leaf: [0.090, 0.130, 0.035], bare: 0.75, waves: 0 })],
	[121, SP],
	[138, with_(SP, { crops: { rapeseed: [0.380, 0.310, 0.020] } })],
	[158, with_(SP, { crops: { rapeseed: [0.120, 0.165, 0.050] }, leaf: [0.064, 0.115, 0.028] })],
	[180, SU],
	[205, with_(SU, { crops: { cereal: [0.240, 0.200, 0.085], wheat: [0.250, 0.205, 0.095], ripening: [0.260, 0.215, 0.100], rapeseed: [0.140, 0.120, 0.060] }, grass: [1.05, 0.98, 0.88], balesStubble: 0.3 })],
	[228, with_(AU, { crops: { maize: [0.080, 0.095, 0.042] }, leaf: [0.060, 0.100, 0.027], grass: [1.08, 0.96, 0.82], autumn: 0, balesHay: 0.3 })],
	[269, AU],
	[290, with_(AU, { grass: [1.12, 0.9, 0.72], autumn: 0.8, leaf: [0.090, 0.095, 0.030], balesStubble: 0.4 })],
	[312, with_(AU, { crops: { cereal: [0.080, 0.120, 0.040], maize: [0.120, 0.100, 0.070] }, grass: [1.08, 0.86, 0.66], autumn: 1, bare: 0.6, balesStubble: 0 })],
	[340, W],
];

const lerp = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * t) : a + (b - a) * t);
/** Paleta dnia roku (1–365): przejście między klatkami CALENDAR. */
export function paletteForDay(day) {
	const d = ((day - 1) % 365 + 365) % 365 + 1;
	let i = CALENDAR.findIndex(([k]) => k > d);
	const [d1, b] = CALENDAR[i < 0 ? 0 : i], [d0, a] = CALENDAR[i < 0 ? CALENDAR.length - 1 : (i - 1 + CALENDAR.length) % CALENDAR.length];
	const span = ((d1 - d0) % 365 + 365) % 365 || 365, t = (((d - d0) % 365 + 365) % 365) / span;
	const out = { crops: {} };
	for (const k of Object.keys(a.crops)) out.crops[k] = lerp(a.crops[k], b.crops[k], t);
	for (const k of ['grass', 'leaf', 'autumnLeaf', 'autumnRed', 'autumn', 'bare', 'balesStubble', 'balesHay', 'waves']) out[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
	return out;
}
