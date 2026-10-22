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
	autumn: 0,
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
		autumn: 0,
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
		autumn: 0.2,
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
		autumn: 0,
	},
};

/** Paleta pory roku (nieznana pora – lato). */
export const seasonPalette = (id) => SEASON_PALETTE[id] ?? SUMMER;
