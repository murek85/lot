// Bryły innych statków powietrznych (bez Three.js – także w wątku kafli): liniowiec, awionetka, śmigłowiec, szybowiec.
// Układ lokalny: x – w prawo, y – w górę, z – do przodu; kolor 1,1,1 – barwa instancji (malowanie, statecznik).
// box(x0, x1, y0, y1, z0, z1, kolor) – prostopadłościan wzdłuż osi z.

const WHITE = [0.86, 0.87, 0.88], GREY = [0.5, 0.51, 0.53], DARK = [0.08, 0.08, 0.09], GLASS = [0.06, 0.08, 0.1], PAINT = [1, 1, 1];

export function aircraftModel(kind, box) {
	if (kind === 'airliner') {
		box(-2, 2, 2, 6, -18, 17, WHITE); // kadłub
		box(-1.6, 1.6, 2.4, 5.4, 17, 19.5, WHITE); // nos
		box(-1.3, 1.3, 4.6, 5.3, 17.5, 18.8, GLASS);
		box(-17, 17, 3, 3.5, -3, 3.5, GREY); // skrzydła
		for (const x of [-6, 6]) box(x - 1.1, x + 1.1, 1.2, 3.2, -1, 3.5, GREY); // silniki
		box(-6.5, 6.5, 5.3, 5.6, -19, -15.5, GREY); // statecznik poziomy
		box(-0.25, 0.25, 6, 12, -19, -13.5, PAINT); // statecznik pionowy – barwy linii
		box(-1.2, 1.2, 0, 2, 1, 3, DARK); // podwozie (z daleka niewidoczne)
	} else if (kind === 'light') {
		box(-0.6, 0.6, 0.8, 2, -4, 2.8, PAINT);
		box(-0.55, 0.55, 1.6, 2.1, 0.6, 2, GLASS);
		box(-5.5, 5.5, 2, 2.2, -0.2, 1.3, WHITE);
		box(-1.8, 1.8, 1.4, 1.55, -4.2, -3.2, WHITE);
		box(-0.07, 0.07, 1.4, 3, -4.2, -3.3, PAINT);
		box(-1, 1, 1.25, 1.35, 2.75, 2.85, DARK); // śmigło
	} else if (kind === 'heli') {
		box(-1, 1, 0.8, 2.8, -2, 2.4, PAINT);
		box(-0.9, 0.9, 1.4, 2.6, 1.6, 2.6, GLASS);
		box(-0.25, 0.25, 2, 2.45, -8, -2, PAINT);
		box(-0.06, 0.06, 2.2, 3.6, -8.2, -7.4, PAINT);
		box(-5.2, 5.2, 3.2, 3.26, -0.18, 0.18, DARK); // wirnik (dwie łopaty na krzyż)
		box(-0.18, 0.18, 3.2, 3.26, -5.2, 5.2, DARK);
		for (const x of [-0.9, 0.9]) box(x - 0.06, x + 0.06, 0, 0.12, -1.8, 2, DARK); // płozy
	} else if (kind === 'glider') {
		box(-0.38, 0.38, 0.6, 1.4, -4.5, 2.2, WHITE);
		box(-0.32, 0.32, 1.2, 1.55, 0.6, 1.8, GLASS);
		box(-8.5, 8.5, 1.3, 1.42, -0.2, 0.75, WHITE);
		box(-0.06, 0.06, 1.2, 2.6, -4.6, -3.8, WHITE);
		box(-1.6, 1.6, 2.5, 2.6, -4.6, -4, WHITE);
		box(-8.5, -7.6, 1.3, 1.42, -0.2, 0.75, PAINT); // końcówki skrzydeł w barwie
		box(7.6, 8.5, 1.3, 1.42, -0.2, 0.75, PAINT);
	}
}

/**
 * Samolot stojący (płyta lotniska) w świecie: body – GeoArrays, (x, z), wysokość podłoża g, kurs a (0 – na północ,
 * −z), barwa malowania.
 */
export function placeAircraft(body, kind, x, z, g, a, paint) {
	const fx = Math.sin(a), fz = -Math.cos(a), rx = -fz, rz = fx;
	aircraftModel(kind, (x0, x1, y0, y1, z0, z1, col) => {
		const cx = (x0 + x1) / 2;
		const p0 = [x + rx * cx + fx * z0, z + rz * cx + fz * z0], p1 = [x + rx * cx + fx * z1, z + rz * cx + fz * z1];
		body.beam(p0[0], p0[1], p1[0], p1[1], x1 - x0, g + y0, g + y1, col === PAINT ? paint : col);
	});
}
