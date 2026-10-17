// Ekrany wczytywania (jak w Maszyniście i Pograniczu Galaktyki): pełnoekranowy przy starcie lotu i wczytaniu zapisu –
// tło rysowane 2D (przelot nad szachownicą pól, lasami, rzeką i drogami, sylwetka samolotu z cieniem, chmury; nocą
// światła osad i błyski świateł samolotu), karta z narożnikami: linia nagłówkowa, tytuł, opis, pasek postępu z etapem
// i procentem, wskazówka. Samolot zwalnia w miarę postępu (podejście do lądowania). Mała karta bez tła – przy zapisie
// lotu i przygotowaniu nowej maszyny w menu. Pasek idzie do wartości z progress() przejściem CSS (działa, także gdy
// wątek jest zajęty budową), done() dociąga go do końca i zamyka ekran po minimalnym czasie.

export const TIPS = [
	'Poniżej ~110 km/h Dromader traci siłę nośną – opuść nos i dodaj gazu.',
	'Wilga przeciąga dopiero przy ~60 km/h – można nią lądować na łące.',
	'W Extrze lotki obracają samolot bez ograniczeń: przytrzymaj A lub D, by zrobić beczkę.',
	'Na plecach ster wysokości działa odwrotnie względem ziemi – ściągnięty drążek kieruje nos w dół.',
	'C przełącza kamerę: za samolotem, kabina, swobodna. V – wprost do kabiny.',
	'Nocą włącz reflektory (L) – oświetlą teren, drzewa i domy przed samolotem.',
	'Esc zatrzymuje lot – w pauzie zmienisz pogodę i porę dnia.',
	'Przyziemienie: skrzydła poziomo i opadanie wolniejsze niż ~4 m/s – patrz na wariometr.',
	'Autozapis powstaje co 30 sekund i przy wyjściu do menu – „Kontynuuj lot” wraca do niego.',
	'Latarnie zapalają się o zmierzchu, okna w domach – zależnie od godziny.',
	'Księżyc ma prawdziwą fazę i położenie – w pełnię noc jest najjaśniejsza.',
	'W kabinie przeciągnij myszą, by się rozejrzeć; dwuklik – widok na wprost.',
];

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hash2 = (i, j) => hash(i * 57.3 + j * 113.9);
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const FIELDS = [[150, 168, 92], [196, 184, 112], [122, 150, 78], [170, 160, 96], [104, 132, 70], [208, 196, 140], [138, 120, 84]];

/** Tło: s – przebyta droga (piksele mapy), night – 0 dzień … 1 noc, t – czas (s). Widok z góry, lot ku górze ekranu. */
export function aerialScene(c, W, H, s, night, t) {
	const u = Math.max(W, H) / 1400; // skala: komórka pola ~150 px przy 1400 px
	const cw = 150 * u, ch = 104 * u;
	const dim = (col) => mix(col, [10, 14, 22], night * 0.88);
	c.fillStyle = rgb(dim([118, 140, 80]));
	c.fillRect(0, 0, W, H);
	// pola: siatka z lekkim przesunięciem rzędów, w każdej komórce pasy upraw
	const j0 = Math.floor(-s / ch) - 1, j1 = j0 + Math.ceil(H / ch) + 2;
	for (let j = j0; j <= j1; j++) {
		const y = j * ch + s;
		const shift = hash(j * 3.3) * cw;
		for (let i = -2; i < W / cw + 2; i++) {
			const x = i * cw - shift;
			const h = hash2(i, j);
			if (h < 0.22) continue; // las (rysowany niżej)
			const col = FIELDS[Math.floor(hash2(i + 7, j) * FIELDS.length)];
			c.fillStyle = rgb(dim(col));
			c.fillRect(x + 1.5 * u, y + 1.5 * u, cw - 3 * u, ch - 3 * u);
			// pasy uprawy
			c.fillStyle = rgb(dim(mix(col, [60, 70, 40], 0.18)), 0.5);
			const vertical = hash2(i, j + 5) < 0.5, n = 4 + Math.floor(hash2(i + 2, j) * 5);
			for (let k = 1; k < n; k += 2) {
				if (vertical) c.fillRect(x + (cw * k) / n, y + 2 * u, cw / n / 2, ch - 4 * u);
				else c.fillRect(x + 2 * u, y + (ch * k) / n, cw - 4 * u, ch / n / 2);
			}
		}
	}
	// lasy: zbiory kół w komórkach „leśnych”
	for (let j = j0; j <= j1; j++) {
		const y = j * ch + s;
		const shift = hash(j * 3.3) * cw;
		for (let i = -2; i < W / cw + 2; i++) {
			if (hash2(i, j) >= 0.22) continue;
			const x = i * cw - shift;
			for (let k = 0; k < 26; k++) {
				const px = x + hash2(i * 9 + k, j) * cw, py = y + hash2(i, j * 9 + k) * ch, r = (9 + hash(k + i) * 12) * u;
				c.fillStyle = rgb(dim(k % 3 ? [44, 76, 46] : [56, 92, 52]));
				c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
			}
		}
	}
	// rzeka: meandrująca, i dwie drogi
	c.lineCap = 'round';
	const river = (y) => W * 0.28 + Math.sin((y - s) * 0.004 / u) * 90 * u + Math.sin((y - s) * 0.0013 / u + 1) * 140 * u;
	c.strokeStyle = rgb(dim([70, 120, 150]));
	c.lineWidth = 10 * u;
	c.beginPath();
	for (let y = -20; y <= H + 20; y += 12) (y === -20 ? c.moveTo(river(y), y) : c.lineTo(river(y), y));
	c.stroke();
	c.strokeStyle = rgb(dim([150, 150, 146]));
	c.lineWidth = 4 * u;
	c.beginPath(); c.moveTo(W * 0.7, -20); c.lineTo(W * 0.62, H + 20); c.stroke();
	const ry = ((s * 0.999) % (H * 1.6)) - H * 0.3;
	c.beginPath(); c.moveTo(-20, ry); c.lineTo(W + 20, ry + 120 * u); c.stroke();
	// nocą: światła osad wzdłuż dróg
	if (night > 0.35) {
		const a = (night - 0.35) / 0.65;
		for (let k = 0; k < 90; k++) {
			const f = hash(k * 1.7);
			const along = ((hash(k * 4.1) * H * 1.6 + s) % (H * 1.6)) - H * 0.3;
			const px = k % 2 ? W * 0.7 - (along / H) * 0.08 * W + 8 * u : f * W, py = k % 2 ? along : ry + f * 120 * u + 6 * u;
			const g = c.createRadialGradient(px, py, 0, px, py, 7 * u);
			g.addColorStop(0, `rgba(255,206,130,${0.8 * a})`);
			g.addColorStop(1, 'rgba(255,206,130,0)');
			c.fillStyle = g;
			c.fillRect(px - 7 * u, py - 7 * u, 14 * u, 14 * u);
		}
	}
	// chmury z cieniami (szybsze – wyżej)
	for (let k = 0; k < 7; k++) {
		const cy = ((hash(k * 5.5) * H * 1.8 + s * 1.6) % (H * 1.8)) - H * 0.4;
		const cx = hash(k * 2.2) * W, r = (90 + hash(k) * 120) * u;
		const shadow = c.createRadialGradient(cx + 60 * u, cy + 70 * u, 0, cx + 60 * u, cy + 70 * u, r);
		shadow.addColorStop(0, `rgba(0,0,0,${0.18 * (1 - night)})`);
		shadow.addColorStop(1, 'rgba(0,0,0,0)');
		c.fillStyle = shadow;
		c.fillRect(cx + 60 * u - r, cy + 70 * u - r, r * 2, r * 2);
		const cl = c.createRadialGradient(cx, cy, 0, cx, cy, r);
		const cc = mix([255, 255, 255], [70, 80, 110], night);
		cl.addColorStop(0, rgb(cc, 0.55));
		cl.addColorStop(0.6, rgb(cc, 0.22));
		cl.addColorStop(1, rgb(cc, 0));
		c.fillStyle = cl;
		c.fillRect(cx - r, cy - r, r * 2, r * 2);
	}
	// samolot (sylwetka z góry) i jego cień
	const px = W * 0.62, py = H * 0.42, sc = 2.1 * u;
	const plane = (dx, dy, fill) => {
		c.save();
		c.translate(px + dx, py + dy);
		c.scale(sc, sc);
		c.translate(-32, -30);
		c.fillStyle = fill;
		c.beginPath();
		c.moveTo(32, 5); c.bezierCurveTo(33.8, 5, 34.9, 7, 34.9, 10.2); c.lineTo(34.9, 22); c.lineTo(59.5, 24.6); c.lineTo(59.5, 30.8);
		c.lineTo(34.9, 33); c.lineTo(34.9, 46.6); c.lineTo(42.5, 49.2); c.lineTo(42.5, 53.4); c.lineTo(32, 52.2); c.lineTo(21.5, 53.4);
		c.lineTo(21.5, 49.2); c.lineTo(29.1, 46.6); c.lineTo(29.1, 33); c.lineTo(4.5, 30.8); c.lineTo(4.5, 24.6); c.lineTo(29.1, 22);
		c.lineTo(29.1, 10.2); c.bezierCurveTo(29.1, 7, 30.2, 5, 32, 5); c.fill();
		c.restore();
	};
	plane(70 * u, 90 * u, `rgba(0,0,0,${0.28 * (1 - night * 0.7)})`);
	plane(0, 0, rgb(mix([246, 195, 68], [120, 100, 50], night * 0.6)));
	// tarcza śmigła
	c.strokeStyle = 'rgba(30,30,30,0.35)';
	c.lineWidth = 2 * u;
	c.beginPath(); c.moveTo(px - 26 * u, py - 54 * u); c.lineTo(px + 26 * u, py - 54 * u); c.stroke();
	// światła pozycyjne i stroboskop (nocą wyraźne)
	const blink = (t % 1.1) < 0.06 || ((t % 1.1) > 0.13 && (t % 1.1) < 0.18);
	for (const [side, col] of [[-1, '255,40,30'], [1, '40,255,110']]) {
		const x = px + side * 27.5 * sc, y = py - 2 * sc; // końcówki skrzydeł sylwetki
		const g = c.createRadialGradient(x, y, 0, x, y, (6 + 10 * night) * u);
		g.addColorStop(0, `rgba(${col},${0.5 + 0.5 * night})`);
		g.addColorStop(1, `rgba(${col},0)`);
		c.fillStyle = g;
		c.fillRect(x - 20 * u, y - 20 * u, 40 * u, 40 * u);
		if (blink) {
			const b = c.createRadialGradient(x, y, 0, x, y, 30 * u);
			b.addColorStop(0, 'rgba(255,255,255,0.9)');
			b.addColorStop(1, 'rgba(255,255,255,0)');
			c.fillStyle = b;
			c.fillRect(x - 30 * u, y - 30 * u, 60 * u, 60 * u);
		}
	}
	// winieta
	const v = c.createRadialGradient(W * 0.55, H * 0.45, H * 0.25, W * 0.55, H * 0.45, W * 0.8);
	v.addColorStop(0, 'rgba(0,0,0,0)');
	v.addColorStop(1, 'rgba(0,0,0,0.62)');
	c.fillStyle = v;
	c.fillRect(0, 0, W, H);
}

/**
 * Ekran wczytywania: { eyebrow, title, sub, night (0…1), stages [nazwy], compact (mała karta bez tła), minTime (s) }.
 * Zwraca { progress(p, etap), done(after), close() }.
 */
export function loadingScreen(o = {}) {
	const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
	const root = document.createElement('div');
	root.className = `scr-load${o.compact ? ' compact' : ''}`;
	root.setAttribute('role', 'status');
	root.setAttribute('aria-live', 'polite');
	root.innerHTML = `${o.compact ? '' : '<canvas class="scr-bg" aria-hidden="true"></canvas><div class="scr-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'}
		<div class="scr-card"><span class="scr-eyebrow">${esc(o.eyebrow)}</span><h1>${esc(o.title)}</h1><p class="scr-sub">${esc(o.sub)}</p>
		<div class="scr-bar"><b></b></div><div class="scr-stage"><span>${esc(o.stage ?? 'Przygotowanie…')}</span><em>0%</em></div>
		${o.compact ? '' : `<p class="scr-tip"><b>Wskazówka</b> ${esc(tip)}</p>`}</div>`;
	document.body.append(root);
	if (reducedMotion() || document.body.classList.contains('reduced-motion')) root.classList.add('reduced');
	const bar = root.querySelector('.scr-bar b'), stage = root.querySelector('.scr-stage span'), pct = root.querySelector('.scr-stage em');
	const start = performance.now();
	let real = 0, finished = false, closing = false;
	// tło
	const canvas = root.querySelector('canvas');
	if (canvas) {
		const c = canvas.getContext('2d');
		const fit = () => {
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			canvas.width = Math.round(innerWidth * dpr);
			canvas.height = Math.round(innerHeight * dpr);
		};
		fit();
		addEventListener('resize', fit);
		let s = 0, last = 0;
		const frame = (now) => {
			if (!root.isConnected) { removeEventListener('resize', fit); return; }
			const t = (now - start) / 1000;
			// samolot zwalnia w miarę postępu (podejście do lądowania)
			const v = root.classList.contains('reduced') ? 0 : 260 * (1 - 0.75 * real) * (canvas.height / 1300);
			s += v * Math.max(0, Math.min(0.1, t - last));
			last = t;
			aerialScene(c, canvas.width, canvas.height, s, o.night ?? 0.1, t);
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	}
	const close = (after) => {
		if (closing) return;
		closing = true;
		root.classList.add('closing');
		setTimeout(() => { root.remove(); after?.(); }, o.compact ? 300 : 500);
	};
	return {
		root,
		/** Postęp 0…1 (nie maleje) i opcjonalnie nazwa etapu. */
		progress(p, label) {
			if (finished) return;
			real = Math.min(0.99, Math.max(real, p));
			bar.style.transform = `scaleX(${real})`;
			pct.textContent = `${Math.round(real * 100)}%`;
			if (label) stage.textContent = label;
		},
		/** Koniec pracy: pasek do końca, etap końcowy, zamknięcie po minimalnym czasie. */
		done(label = 'Gotowe', after) {
			if (finished) return;
			finished = true;
			real = 1;
			bar.style.transform = 'scaleX(1)';
			pct.textContent = '100%';
			stage.textContent = label;
			root.classList.add('finished');
			const wait = Math.max(0, (o.minTime ?? 1.4) * 1000 - (performance.now() - start)) + (o.compact ? 650 : 350);
			setTimeout(() => close(after), wait);
		},
		close,
	};
}

/**
 * Czeka n klatek przeglądarki (praca rozłożona na klatki – pasek i tło żyją między krokami). Gdy klatki stoją
 * (karta w tle, ukryte okno), kończy na zegarze – wczytywanie nie zawiesza się.
 */
export const nextFrames = (n = 1) => new Promise((r) => {
	let k = 0, done = false;
	const finish = () => { if (!done) { done = true; r(); } };
	const f = () => (++k >= n ? finish() : requestAnimationFrame(f));
	requestAnimationFrame(f);
	setTimeout(finish, 80 * n + 40);
});
