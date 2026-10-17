// Kamera pościgowa „z góry”: wisi za samolotem i nad nim, patrzy trochę przed nos (widać, dokąd lecimy),
// obraca się za kursem z opóźnieniem. Kółko myszy – odległość, prawy przycisk – kąt patrzenia.
import { Vector3, MathUtils } from 'three/webgpu';

export class ChaseCamera {
	constructor(camera, dom) {
		this.camera = camera;
		this.distance = 120;
		this.goalDistance = 120;
		this.elevation = 38 * MathUtils.DEG2RAD; // kąt patrzenia w dół
		this.heading = 0;
		this.look = new Vector3();
		this.active = true;
		dom.addEventListener('wheel', (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.goalDistance = MathUtils.clamp(this.goalDistance * Math.exp(e.deltaY * 0.0012), 14, 1500);
		}, { passive: false });
		let drag = null;
		dom.addEventListener('pointerdown', (e) => { if (this.active && e.button === 2) drag = e.clientY; });
		window.addEventListener('pointerup', () => (drag = null));
		dom.addEventListener('pointermove', (e) => {
			if (drag === null) return;
			this.elevation = MathUtils.clamp(this.elevation + (e.clientY - drag) * 0.004, 8 * MathUtils.DEG2RAD, 85 * MathUtils.DEG2RAD);
			drag = e.clientY;
		});
	}

	/** Natychmiast za samolotem (po starcie i po kraksie). */
	snap(s) {
		this.heading = s.heading;
		this.distance = this.goalDistance;
		this.update(s, 0, true);
	}

	update(s, dt, snap = false) {
		const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
		let d = s.heading - this.heading;
		d = Math.atan2(Math.sin(d), Math.cos(d));
		this.heading += d * k;
		this.distance += (this.goalDistance - this.distance) * (snap ? 1 : 1 - Math.exp(-dt * 5));
		const fwd = new Vector3(Math.sin(this.heading), 0, -Math.cos(this.heading));
		// patrzymy trochę przed nos (widać, dokąd lecimy), ale samolot zostaje w dolnej części kadru
		const ahead = this.distance * 0.1 + s.speed * 0.2;
		const goal = new Vector3(s.x, s.y, s.z).addScaledVector(fwd, ahead);
		if (snap) this.look.copy(goal);
		else this.look.lerp(goal, 1 - Math.exp(-dt * 8));
		const c = Math.cos(this.elevation);
		this.camera.position.set(
			s.x - fwd.x * c * this.distance,
			s.y + Math.sin(this.elevation) * this.distance,
			s.z - fwd.z * c * this.distance,
		);
		this.camera.lookAt(this.look);
	}
}
