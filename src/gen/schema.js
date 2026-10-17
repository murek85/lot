// Klasy obiektów gry wspólne dla narzędzi wypiekania (tools/lib/osm.js) i generatora regionów w grze.

// Klasy dróg (kolejność = ważność; szerokość jezdni w metrach, gdy brak tagów).
export const ROAD = {
	motorway: { id: 0, width: 22 }, trunk: { id: 0, width: 12 }, primary: { id: 1, width: 9 }, secondary: { id: 2, width: 7.5 },
	tertiary: { id: 3, width: 6.5 }, unclassified: { id: 4, width: 5 }, residential: { id: 4, width: 5.5 }, living_street: { id: 4, width: 4.5 },
	service: { id: 5, width: 3.5 }, track: { id: 6, width: 3 }, path: { id: 7, width: 1.5 }, footway: { id: 7, width: 2 },
	cycleway: { id: 7, width: 2 }, pedestrian: { id: 4, width: 6 }, bridleway: { id: 7, width: 1.5 }, steps: { id: 7, width: 2 },
};
