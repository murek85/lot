// Kamera podglądu terenu (zanim będzie samolot): krąży nad punktem na ziemi, z płynnym wygaszaniem ruchu.
// Mysz: lewy – przesuwanie, prawy – obrót i pochylenie, kółko – wysokość. Klawisze: WASD/strzałki, Q/E, R/F, Shift – szybciej.
import { Vector3, MathUtils } from 'three/webgpu';

export class ViewCamera {
	constructor(camera, dom, groundAt) {
		this.camera = camera;
		this.groundAt = groundAt;
		this.target = new Vector3(0, 0, 0);
		this.distance = 7000;
		this.heading = 0; // 0 = patrzy na północ
		this.pitch = 48 * MathUtils.DEG2RAD; // kąt w dół od poziomu
		this.goal = { target: this.target.clone(), distance: this.distance, heading: this.heading, pitch: this.pitch };
		this.keys = new Set();
		this.active = true; // wyłączona, gdy prowadzi kamera pościgowa
		this._bind(dom);
	}

	_bind(dom) {
		let drag = null;
		dom.addEventListener('contextmenu', (e) => e.preventDefault());
		dom.addEventListener('pointerdown', (e) => {
			if (!this.active) return;
			drag = { x: e.clientX, y: e.clientY, button: e.button };
			dom.setPointerCapture(e.pointerId);
		});
		dom.addEventListener('pointerup', () => (drag = null));
		dom.addEventListener('pointermove', (e) => {
			if (!drag) return;
			const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
			drag.x = e.clientX;
			drag.y = e.clientY;
			const g = this.goal;
			if (drag.button === 0) {
				const k = (g.distance / dom.clientHeight) * 1.3;
				this._pan(-dx * k, -dy * k / Math.max(0.35, Math.sin(g.pitch)));
			} else {
				g.heading -= dx * 0.005;
				g.pitch = MathUtils.clamp(g.pitch + dy * 0.004, 8 * MathUtils.DEG2RAD, 89 * MathUtils.DEG2RAD);
			}
		});
		dom.addEventListener('wheel', (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.goal.distance = MathUtils.clamp(this.goal.distance * Math.exp(e.deltaY * 0.0012), 250, 90000);
		}, { passive: false });
		window.addEventListener('keydown', (e) => { if (this.active && !e.target.closest?.('input')) this.keys.add(e.code); });
		window.addEventListener('keyup', (e) => this.keys.delete(e.code));
		window.addEventListener('blur', () => this.keys.clear());
	}

	// przesunięcie w układzie kamery: right – w prawo, fwd – do przodu (po ziemi)
	_pan(right, fwd) {
		const h = this.goal.heading;
		this.goal.target.x += Math.cos(h) * right + Math.sin(h) * fwd;
		this.goal.target.z += Math.sin(h) * right - Math.cos(h) * fwd;
	}

	/** Przejęcie widoku od kamery pościgowej: krąży nad punktem, na który ona patrzyła. */
	takeOver(camera, look) {
		const d = camera.position.clone().sub(look);
		this.goal.target.copy(look);
		this.target.copy(look);
		this.goal.distance = this.distance = d.length();
		this.goal.heading = this.heading = Math.atan2(-d.x, d.z);
		this.goal.pitch = this.pitch = Math.asin(Math.min(1, Math.max(-1, d.y / d.length())));
	}

	update(dt) {
		const g = this.goal, k = this.keys;
		const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
		const v = g.distance * 0.6 * fast * dt;
		if (k.has('KeyW') || k.has('ArrowUp')) this._pan(0, v);
		if (k.has('KeyS') || k.has('ArrowDown')) this._pan(0, -v);
		if (k.has('KeyA') || k.has('ArrowLeft')) this._pan(-v, 0);
		if (k.has('KeyD') || k.has('ArrowRight')) this._pan(v, 0);
		if (k.has('KeyQ')) g.heading += 1.2 * dt;
		if (k.has('KeyE')) g.heading -= 1.2 * dt;
		if (k.has('KeyR')) g.pitch = Math.min(89 * MathUtils.DEG2RAD, g.pitch + 0.8 * dt);
		if (k.has('KeyF')) g.pitch = Math.max(8 * MathUtils.DEG2RAD, g.pitch - 0.8 * dt);
		if (k.has('PageUp')) g.distance = Math.max(250, g.distance * Math.exp(-1.5 * dt));
		if (k.has('PageDown')) g.distance = Math.min(90000, g.distance * Math.exp(1.5 * dt));

		const s = 1 - Math.exp(-dt * 6);
		this.target.lerp(g.target, s);
		this.distance += (g.distance - this.distance) * s;
		this.heading += (g.heading - this.heading) * s;
		this.pitch += (g.pitch - this.pitch) * s;
		this.target.y = this.groundAt(this.target.x, this.target.z);

		const c = Math.cos(this.pitch);
		const back = new Vector3(-Math.sin(this.heading) * c, Math.sin(this.pitch), Math.cos(this.heading) * c);
		const pos = this.target.clone().addScaledVector(back, this.distance);
		pos.y = Math.max(pos.y, this.groundAt(pos.x, pos.z) + 40);
		this.camera.position.copy(pos);
		this.camera.lookAt(this.target);
	}
}
