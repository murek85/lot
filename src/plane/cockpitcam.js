// Widok z kabiny: oko pilota na stałe w układzie samolotu (kamera porusza się razem z nim – zero smużenia TAA
// wnętrza), rozglądanie się przeciąganiem myszy (lewy przycisk), kółko – pole widzenia, podwójne kliknięcie –
// patrz przed siebie. Głowa lekko „pracuje”: ugina się pod przeciążeniem, zagląda w zakręt, drży z silnikiem.
import { Vector3, Quaternion, Euler, MathUtils } from 'three/webgpu';

export class CockpitCamera {
	constructor(camera, dom) {
		this.camera = camera;
		this.active = false;
		this.yaw = 0;
		this.pitch = -0.1;
		this.fov = 62;
		this.sens = 1; // czułość myszy (ustawienia)
		this.headY = 0;
		this.headX = 0;
		this.prev = null;
		this._e = new Euler(0, 0, 0, 'YXZ');
		this._q = new Quaternion();
		this._p = new Vector3();
		let drag = null;
		dom.addEventListener('pointerdown', (e) => { if (this.active && (e.button === 0 || e.button === 2)) drag = [e.clientX, e.clientY]; });
		window.addEventListener('pointerup', () => (drag = null));
		dom.addEventListener('pointermove', (e) => {
			if (!this.active || !drag) return;
			const k = (this.fov / 62) * 0.005 * this.sens;
			this.yaw = MathUtils.clamp(this.yaw - (e.clientX - drag[0]) * k, -2.7, 2.7);
			this.pitch = MathUtils.clamp(this.pitch - (e.clientY - drag[1]) * k, -1.2, 0.9);
			drag = [e.clientX, e.clientY];
		});
		dom.addEventListener('dblclick', () => { if (this.active) { this.yaw = 0; this.pitch = -0.1; } });
		dom.addEventListener('wheel', (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.fov = MathUtils.clamp(this.fov * Math.exp(e.deltaY * 0.001), 30, 95);
		}, { passive: false });
	}

	update(model, s, dt, t, rpm) {
		// przeciążenie z szybkości zmiany kąta ścieżki i przechyłu: n ≈ cos γ / cos φ + v·dγ/dt / g
		const dGamma = this.prev ? (s.gamma - this.prev.gamma) / Math.max(1e-3, dt) : 0;
		this.prev = { gamma: s.gamma };
		const n = Math.cos(s.gamma) * Math.cos(s.bank) / Math.max(0.3, Math.cos(s.bank) ** 2) + (s.speed * dGamma) / 9.81;
		const k = 1 - Math.exp(-dt * 6);
		this.headY += (MathUtils.clamp(-(n - 1) * 0.025, -0.06, 0.04) - this.headY) * k;
		this.headX += (MathUtils.clamp(-s.bank * 0.02, -0.03, 0.03) - this.headX) * k;
		const buzz = rpm > 100 ? 0.0006 * (0.5 + s.throttle) : 0;
		const eye = model.userData.anchors.eye;
		const p = this._p.set(eye[0] + this.headX + Math.sin(t * 61) * buzz, eye[1] + this.headY + Math.sin(t * 47.3) * buzz, eye[2]);
		model.updateMatrixWorld();
		this.camera.position.copy(p.applyMatrix4(model.matrixWorld));
		// głowa zagląda w zakręt
		this._e.set(this.pitch, this.yaw + Math.sin(s.bank) * 0.12, 0);
		this.camera.quaternion.copy(model.getWorldQuaternion(this._q)).multiply(new Quaternion().setFromEuler(this._e));
		if (this.camera.fov !== this.fov) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
		this.camera.updateMatrixWorld();
	}
}
