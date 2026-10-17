// Parametry fizycznej atmosfery Ziemi (model Bruneton/Hillaire 2020) w kilometrach i liczenie przepuszczalności
// na procesorze – na kolor słońca dla świateł Three.js i do testów. Shadery GPU (gpu.js) używają tych samych liczb.

export const ATMOSPHERE = {
	groundRadius: 6360, // km
	topRadius: 6460,
	rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3], // 1/km
	rayleighScaleHeight: 8,
	mieScattering: 3.996e-3,
	mieExtinction: 4.4e-3,
	mieScaleHeight: 1.2,
	mieG: 0.8,
	ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3],
	ozoneCenter: 25,
	ozoneWidth: 15,
	groundAlbedo: 0.25,
	// Mnożnik aerozoli przy ziemi: 1 = krystalicznie czyste powietrze z publikacji; w Polsce latem widoczność to
	// zwykle 20–40 km, czyli kilkanaście razy więcej aerozoli – stąd głębia i niebieskawa mgiełka w oddali.
	haze: 6,
	// Perspektywa powietrzna liczona na skróconej drodze: z 5 km fizyczna mgiełka zjada kolory jak na zdjęciu bez
	// filtra; gra pokazuje krajobraz „po korekcie”, a daleki horyzont i tak tonie w mgle.
	aerialScale: 0.55,
	sunAngularRadius: 0.004675, // rad (Słońce ma 0,2675°)
	sunIlluminance: 12, // jasność słońca w jednostkach sceny (ekspozycja dobiera resztę)
};

/** Gęstości (Rayleigh, Mie, ozon) na wysokości h km nad powierzchnią. */
export function densities(h, a = ATMOSPHERE) {
	return [Math.exp(-h / a.rayleighScaleHeight), Math.exp(-h / a.mieScaleHeight), Math.max(0, 1 - Math.abs(h - a.ozoneCenter) / a.ozoneWidth)];
}

/** Współczynnik wygaszania (RGB, 1/km) na wysokości h km. */
export function extinction(h, a = ATMOSPHERE) {
	const [r, m, o] = densities(h, a);
	return [0, 1, 2].map((k) => a.rayleighScattering[k] * r + a.mieExtinction * a.haze * m + a.ozoneAbsorption[k] * o);
}

/** Odległość od punktu na promieniu r (km od środka Ziemi) w kierunku o cosinusie zenitu mu do górnej granicy atmosfery. */
export function distanceToTop(r, mu, a = ATMOSPHERE) {
	return Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + a.topRadius * a.topRadius)));
}

/** Czy promień z wysokości r pod kątem mu trafia w Ziemię. */
export function hitsGround(r, mu, a = ATMOSPHERE) {
	return mu < 0 && r * r * (mu * mu - 1) + a.groundRadius * a.groundRadius >= 0;
}

/** Przepuszczalność (RGB 0..1) od punktu na wysokości h km w kierunku o cosinusie zenitu mu do kosmosu. */
export function transmittance(h, mu, a = ATMOSPHERE, steps = 64) {
	const r = a.groundRadius + h;
	if (hitsGround(r, mu, a)) return [0, 0, 0];
	const d = distanceToTop(r, mu, a);
	const dt = d / steps;
	const depth = [0, 0, 0];
	for (let i = 0; i < steps; i++) {
		const t = (i + 0.5) * dt;
		const ri = Math.sqrt(r * r + t * t + 2 * r * mu * t);
		const e = extinction(ri - a.groundRadius, a);
		for (let k = 0; k < 3; k++) depth[k] += e[k] * dt;
	}
	return depth.map((x) => Math.exp(-x));
}
