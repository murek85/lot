// Duża mapa (Tab albo menu pauzy): cały region na ekranie z mapy bazowej minimapy, przesuwanie (przeciąganie) i
// powiększanie (kółko, wokół kursora), nazwy miejscowości dobrane do powiększenia, miejsca startu, samolot ze
// strzałką kursu, cel lotu. Kliknięcie – cel (przyciąga do pobliskiej nazwy), prawy przycisk – bez celu.

const FONT = { city: '700 15px', town: '700 13.5px', village: '600 12px', suburb: 'italic 500 11.5px', quarter: 'italic 500 11px', hamlet: '500 11px', neighbourhood: 'italic 500 10.5px', isolated_dwelling: '500 10px' };
// od jakiego powiększenia (piksele na km) podpisywać rodzaj miejscowości
const MIN_ZOOM = { city: 0, town: 0, village: 14, suburb: 22, quarter: 40, hamlet: 45, neighbourhood: 70, isolated_dwelling: 90 };

export class BigMap {
	/** root – element nakładki (z <canvas> i paskiem), base – źródło mapy (regionBase albo WorldMap), size – bok regionu (m). */
	constructor(root, base, size, labels, starts, onTarget) {
		this.root = root;
		this.cv = root.querySelector('canvas');
		this.ctx = this.cv.getContext('2d');
		this.info = root.querySelector('.bigmap-info');
		this.base = base;
		this.size = size;
		this.labels = labels;
		this.starts = starts;
		this.onTarget = onTarget;
		this.cx = 0; this.cz = 0; this.pxPerM = 0.02; // widok: środek (m) i skala
		this.plane = { x: 0, z: 0, heading: 0 };
		this.target = null;
		this.hover = null;
		const cv = this.cv;
		let drag = null;
		cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz, moved: false }; cv.setPointerCapture(e.pointerId); });
		cv.addEventListener('pointermove', (e) => {
			if (drag) {
				const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
				if (Math.hypot(dx, dy) > 4) drag.moved = true;
				this.cx = drag.cx - dx / this.pxPerM; this.cz = drag.cz - dy / this.pxPerM;
				this.draw();
			} else {
				this.hover = this.pick(e.offsetX, e.offsetY);
				this.draw();
			}
		});
		cv.addEventListener('pointerup', (e) => {
			if (drag && !drag.moved && e.button === 0) {
				const p = this.pick(e.offsetX, e.offsetY);
				this.target = p;
				this.onTarget?.(p);
				this.draw();
			}
			drag = null;
		});
		cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.target = null; this.onTarget?.(null); this.draw(); });
		cv.addEventListener('wheel', (e) => {
			e.preventDefault();
			const [wx, wz] = this.toWorld(e.offsetX, e.offsetY);
			const k = Math.exp(-e.deltaY * 0.0015);
			this.pxPerM = Math.max(this.minZoom(), Math.min(0.6, this.pxPerM * k));
			// powiększanie wokół kursora
			this.cx = wx - (e.offsetX - this.cv.clientWidth / 2) / this.pxPerM;
			this.cz = wz - (e.offsetY - this.cv.clientHeight / 2) / this.pxPerM;
			this.draw();
		}, { passive: false });
		addEventListener('resize', () => { if (this.open) { this.fit(); this.draw(); } });
	}

	get open() { return !this.root.hidden; }

	minZoom() { return Math.min(this.cv.clientWidth, this.cv.clientHeight) / (this.size * 1.15); }

	fit() {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		this.cv.width = Math.round(this.cv.clientWidth * dpr);
		this.cv.height = Math.round(this.cv.clientHeight * dpr);
		this.dpr = dpr;
	}

	/** Otwarcie: widok wyśrodkowany na samolocie w skali ~25 km na ekran. */
	show(plane, target) {
		this.root.hidden = false;
		this.plane = plane;
		this.target = target;
		this.fit();
		this.cx = plane.x; this.cz = plane.z;
		this.pxPerM = Math.max(this.minZoom(), Math.min(this.cv.clientWidth, this.cv.clientHeight) / 25000);
		this.draw();
	}

	hide() { this.root.hidden = true; }

	toWorld(sx, sy) { return [this.cx + (sx - this.cv.clientWidth / 2) / this.pxPerM, this.cz + (sy - this.cv.clientHeight / 2) / this.pxPerM]; }
	toScreen(x, z) { return [this.cv.clientWidth / 2 + (x - this.cx) * this.pxPerM, this.cv.clientHeight / 2 + (z - this.cz) * this.pxPerM]; }

	/** Cel pod kursorem: nazwa miejscowości bliżej niż 14 px, inaczej punkt mapy. */
	pick(sx, sy) {
		let best = null, bd = 14;
		for (const l of this.labels) {
			if (this.pxPerM * 1000 < (MIN_ZOOM[l.cls] ?? 50)) continue;
			const [x, y] = this.toScreen(l.x, l.z);
			const d = Math.hypot(x - sx, y - sy);
			if (d < bd) { bd = d; best = l; }
		}
		if (best) return { name: best.name, gen: best.gen, x: best.x, z: best.z };
		const [x, z] = this.toWorld(sx, sy);
		return { name: null, x, z };
	}

	draw() {
		if (!this.open) return;
		const { ctx, base, dpr } = this;
		const W = this.cv.clientWidth, H = this.cv.clientHeight;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = 'rgb(46,52,60)';
		ctx.fillRect(0, 0, W, H);
		// mapa bazowa (region – jedno płótno, otwarty świat – płytki kafli)
		ctx.save();
		ctx.translate(W / 2, H / 2);
		base.drawOn(ctx, this.cx, this.cz, this.pxPerM, Math.hypot(W, H) / 2 / this.pxPerM);
		ctx.restore();
		const [x0, y0] = this.toScreen(-this.size / 2, -this.size / 2);
		const s = this.size * this.pxPerM;
		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 1;
		ctx.strokeRect(x0, y0, s, s);
		// siatka co 5 km (lekko) i podziałka
		const pxKm = this.pxPerM * 1000;
		// nazwy
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const taken = [];
		for (const l of this.labels) {
			if (pxKm < (MIN_ZOOM[l.cls] ?? 50)) continue;
			const [x, y] = this.toScreen(l.x, l.z);
			if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
			ctx.font = `${FONT[l.cls] ?? '500 11px'} system-ui, sans-serif`;
			const w = ctx.measureText(l.name).width;
			if (taken.some((t) => Math.abs(t[0] - x) < (t[2] + w) / 2 + 4 && Math.abs(t[1] - y) < 14)) continue;
			taken.push([x, y, w]);
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = 'rgba(255,255,255,0.88)';
			ctx.fillStyle = l.cls === 'city' || l.cls === 'town' ? 'rgb(24,24,30)' : 'rgb(55,55,66)';
			ctx.strokeText(l.name, x, y);
			ctx.fillText(l.name, x, y);
		}
		// miejsca startu
		ctx.fillStyle = '#f6c344';
		ctx.strokeStyle = 'rgba(30,20,0,0.85)';
		ctx.lineWidth = 1.5;
		for (const st of this.starts) {
			const [x, y] = this.toScreen(st.x, st.z);
			ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath();
			ctx.fill(); ctx.stroke();
		}
		// cel: linia od samolotu i znacznik
		const [px, py] = this.toScreen(this.plane.x, this.plane.z);
		if (this.target) {
			const [tx, ty] = this.toScreen(this.target.x, this.target.z);
			ctx.strokeStyle = 'rgba(143,208,255,0.9)';
			ctx.lineWidth = 2;
			ctx.setLineDash([8, 6]);
			ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#8fd0ff';
			ctx.strokeStyle = 'rgba(0,20,40,0.9)';
			ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
			ctx.fillStyle = 'rgba(0,20,40,0.9)';
			ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
		}
		// samolot
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(this.plane.heading);
		ctx.fillStyle = '#ffffff';
		ctx.strokeStyle = 'rgba(0,0,0,0.8)';
		ctx.lineWidth = 1.8;
		ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath();
		ctx.fill(); ctx.stroke();
		ctx.restore();
		// podziałka
		const step = [500, 1000, 2000, 5000, 10000].find((m) => m * this.pxPerM > 70) ?? 10000;
		ctx.fillStyle = 'rgba(10,14,20,0.7)';
		ctx.fillRect(16, H - 40, step * this.pxPerM + 16, 26);
		ctx.fillStyle = '#e8eef2';
		ctx.fillRect(24, H - 24, step * this.pxPerM, 3);
		ctx.font = '600 11px system-ui, sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(step >= 1000 ? `${step / 1000} km` : `${step} m`, 24, H - 32);
		// podpowiedź nad kursorem
		if (this.hover?.name) {
			const [hx, hy] = this.toScreen(this.hover.x, this.hover.z);
			ctx.strokeStyle = '#8fd0ff';
			ctx.lineWidth = 2;
			ctx.beginPath(); ctx.arc(hx, hy, 11, 0, Math.PI * 2); ctx.stroke();
		}
	}
}
