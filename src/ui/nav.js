// Nawigacja w locie: współrzędne, wiatr względem samolotu, ostrzeżenie o granicy mapy, pasek kursu.
// Sama matematyka i rysowanie 2D (bez Three.js) – testowana w Node.

/** Stopnie i minuty: 50°19′ N 18°47′ E. */
export function formatLatLon(lat, lon) {
	const f = (v, pos, neg) => {
		const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60 + 1e-9);
		return `${d}°${String(m).padStart(2, '0')}′ ${v >= 0 ? pos : neg}`;
	};
	return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

const DIR8 = ['północy', 'północnego wschodu', 'wschodu', 'południowego wschodu', 'południa', 'południowego zachodu', 'zachodu', 'północnego zachodu'];

/**
 * Wiatr względem samolotu: (wx, wz) – dokąd wieje (m/s, x – wschód, z – południe), heading – kurs (0 = północ).
 * Zwraca { speed (km/h), head (km/h, + czołowy), cross (km/h, + z prawej), arrow (rad – obrót strzałki „dokąd wieje”
 * względem nosa samolotu), text }.
 */
export function relativeWind(wx, wz, heading) {
	const fx = Math.sin(heading), fz = -Math.cos(heading); // przód
	const rx = Math.cos(heading), rz = Math.sin(heading); // prawo
	const along = wx * fx + wz * fz, side = wx * rx + wz * rz;
	const speed = Math.hypot(wx, wz) * 3.6;
	const head = -along * 3.6, cross = -side * 3.6; // czołowy: wieje w twarz; z prawej: wieje na lewo
	if (speed < 2) return { speed: 0, head: 0, cross: 0, arrow: 0, text: 'cisza' };
	const ang = Math.atan2(cross, head); // 0 – czołowy, +90° – z prawej
	const a = Math.abs(ang) * 180 / Math.PI;
	const kind = a < 30 ? 'czołowy' : a > 150 ? 'w ogon' : `boczny z ${ang > 0 ? 'prawej' : 'lewej'}`;
	return { speed: Math.round(speed), head, cross, arrow: Math.atan2(side, along), text: `${Math.round(speed)} km/h · ${kind}` };
}

/**
 * Granica mapy: odległość (m) do najbliższej krawędzi kwadratu regionu (bok 2·half) i kierunek powrotu (do środka).
 * Ostrzeżenie poniżej 3 km; poza regionem – „poza mapą”.
 */
export function edgeWarning(x, z, half, warnAt = 3000) {
	const dist = half - Math.max(Math.abs(x), Math.abs(z));
	if (dist > warnAt) return null;
	// kurs do środka regionu: 0 = północ (−z)
	const back = (Math.atan2(-x, z) + 2 * Math.PI) % (2 * Math.PI);
	const deg = Math.round((back * 180) / Math.PI) % 360;
	const dir = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'][Math.round(back / (Math.PI / 4)) % 8];
	if (dist < 0) return { dist, deg, text: `Poza mapą – zawróć na ${dir} (kurs ${String(deg).padStart(3, '0')}°)` };
	return { dist, deg, text: `Granica mapy za ${(dist / 1000).toFixed(1).replace('.', ',')} km – zawróć na ${dir} (${String(deg).padStart(3, '0')}°)` };
}

/**
 * Prowadzenie do celu: samolot (px, pz), kurs heading (rad), prędkość (m/s), cel (tx, tz). Zwraca { dist (m), bearing
 * (stopnie, 0 = północ), turn (stopnie, + w prawo, −180…180), eta (s), text } – np. „14,2 km · 4 min · skręć 30° w prawo”.
 */
export function targetInfo(px, pz, heading, speed, tx, tz) {
	const dx = tx - px, dz = tz - pz, dist = Math.hypot(dx, dz);
	const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
	const hdg = ((heading * 180) / Math.PI + 360) % 360;
	const turn = ((bearing - hdg + 540) % 360) - 180;
	const eta = dist / Math.max(1, speed);
	const km = dist < 10000 ? (dist / 1000).toFixed(1).replace('.', ',') : Math.round(dist / 1000);
	const min = eta < 90 ? `${Math.max(1, Math.round(eta))} s` : `${Math.round(eta / 60)} min`;
	const steer = dist < 600 ? 'nad celem' : Math.abs(turn) < 8 ? 'na kursie' : `skręć ${Math.round(Math.abs(turn))}° w ${turn > 0 ? 'prawo' : 'lewo'}`;
	return { dist, bearing, turn, eta, text: `${km} km · ${min} · ${steer}` };
}

/** Skąd wieje (słownie) – wektor dokąd wieje. */
export function windFromText(wx, wz) {
	const ang = (Math.atan2(-wx, wz) + 2 * Math.PI) % (2 * Math.PI);
	return DIR8[Math.round(ang / (Math.PI / 4)) % 8];
}

/**
 * Pasek kursu: taśma kompasu przesuwana z kursem (stopnie), co 5° kreska, co 10° dłuższa, co 30° liczba, kierunki
 * główne literami (N żółte). Opcjonalnie znacznik kursu powrotu do środka mapy (marker – stopnie).
 */
export function drawCompass(ctx, w, h, hdgDeg, marker = null, target = null) {
	ctx.clearRect(0, 0, w, h);
	const pxPerDeg = w / 110; // widać ±55°
	const cx = w / 2;
	ctx.font = '600 13px system-ui, sans-serif';
	ctx.textAlign = 'center';
	const NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
	for (let d = Math.floor(hdgDeg - 60); d <= hdgDeg + 60; d++) {
		if (d % 5) continue;
		const x = cx + (d - hdgDeg) * pxPerDeg;
		const dd = ((d % 360) + 360) % 360;
		const len = dd % 10 === 0 ? 10 : 5;
		ctx.fillStyle = 'rgba(232,238,242,0.75)';
		ctx.fillRect(Math.round(x), 0, 1, len);
		if (NAMES[dd] !== undefined) {
			ctx.fillStyle = dd === 0 ? '#f6c344' : '#e8eef2';
			ctx.font = '700 14px system-ui, sans-serif';
			ctx.fillText(NAMES[dd], x, 27);
		} else if (dd % 30 === 0) {
			ctx.fillStyle = 'rgba(232,238,242,0.7)';
			ctx.font = '500 11px system-ui, sans-serif';
			ctx.fillText(String(dd / 10).padStart(2, '0'), x, 26);
		}
	}
	if (marker != null) {
		let rel = ((marker - hdgDeg + 540) % 360) - 180;
		const x = cx + Math.max(-55, Math.min(55, rel)) * pxPerDeg;
		ctx.fillStyle = '#ff8f7a';
		ctx.beginPath();
		ctx.moveTo(x, 12); ctx.lineTo(x - 5, 2); ctx.lineTo(x + 5, 2);
		ctx.fill();
	}
	if (target != null) {
		// cel: niebieski romb (poza zakresem – przy krawędzi paska)
		const rel = ((target - hdgDeg + 540) % 360) - 180;
		const x = cx + Math.max(-53, Math.min(53, rel)) * pxPerDeg;
		ctx.fillStyle = '#8fd0ff';
		ctx.beginPath();
		ctx.moveTo(x, 4); ctx.lineTo(x + 6, 12); ctx.lineTo(x, 20); ctx.lineTo(x - 6, 12);
		ctx.fill();
	}
	// wskaźnik środka
	ctx.fillStyle = '#f6c344';
	ctx.beginPath();
	ctx.moveTo(cx, 14); ctx.lineTo(cx - 6, 0); ctx.lineTo(cx + 6, 0);
	ctx.fill();
}
