// Kamera pościgowa „z góry”: wisi za samolotem i nad nim, patrzy trochę przed nos (widać, dokąd lecimy),
// obraca się za kursem z opóźnieniem. Przeciąganie myszą (lewy lub prawy przycisk) – obrót wokół samolotu
// (pełny w poziomie, w pionie od spodu do widoku z góry), kółko – odległość, dwuklik lub X – z powrotem za ogon.
// Opcjonalnie (ustawienia) kamera po puszczeniu myszy sama łagodnie wraca za ogon.
import { Vector3, MathUtils } from 'three/webgpu';

const DEG = MathUtils.DEG2RAD;
export const CHASE_DEFAULT = { distance: 120, elevation: 38 * DEG };
const MIN_ELEV = -60 * DEG, MAX_ELEV = 88 * DEG;
const MIN_DIST = 12, MAX_DIST = 1500;
const RETURN_DELAY = 1.5; // s po puszczeniu myszy, zanim kamera zacznie wracać za ogon

export class ChaseCamera {
	constructor(camera, dom, groundAt = null) {
		this.camera = camera;
		this.groundAt = groundAt;
		this.distance = CHASE_DEFAULT.distance;
		this.goalDistance = CHASE_DEFAULT.distance;
		this.elevation = CHASE_DEFAULT.elevation; // kąt patrzenia w dół (ujemny – spod samolotu)
		this.goalElevation = CHASE_DEFAULT.elevation;
		this.orbit = 0; // obrót wokół samolotu względem kursu (0 – za ogonem, π – przed nosem)
		this.goalOrbit = 0;
		this.heading = 0;
		this.sens = 1; // czułość myszy (ustawienia)
		this.autoReturn = false; // powrót za ogon po puszczeniu myszy (ustawienia)
		this.idle = 0; // czas od puszczenia myszy
		this.look = new Vector3();
		this.active = true;
		this._fwd = new Vector3();
		this._goal = new Vector3();
		dom.addEventListener('wheel', (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.goalDistance = MathUtils.clamp(this.goalDistance * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
		}, { passive: false });
		let drag = null;
		dom.addEventListener('pointerdown', (e) => { if (this.active && (e.button === 0 || e.button === 2)) drag = [e.clientX, e.clientY]; });
		window.addEventListener('pointerup', () => { drag = null; this.idle = 0; });
		dom.addEventListener('pointermove', (e) => {
			if (!this.active || !drag) return;
			this.drag(e.clientX - drag[0], e.clientY - drag[1]);
			drag = [e.clientX, e.clientY];
		});
		dom.addEventListener('dblclick', () => { if (this.active) this.reset(); });
		this.dragging = () => drag !== null;
	}

	/** Obrót o przesunięcie myszy w pikselach. */
	drag(dx, dy) {
		const k = 0.005 * this.sens;
		this.goalOrbit -= dx * k;
		this.goalElevation = MathUtils.clamp(this.goalElevation + dy * k * 0.8, MIN_ELEV, MAX_ELEV);
		this.idle = 0;
	}

	/** Łagodny powrót do domyślnego ujęcia: za ogonem, domyślny kąt i odległość. */
	reset() {
		this.goalOrbit = this._nearestTurn(this.goalOrbit);
		this.goalElevation = CHASE_DEFAULT.elevation;
		this.goalDistance = CHASE_DEFAULT.distance;
	}

	// najbliższa wielokrotność 2π (po kilku pełnych obrotach kamera wraca krótszą drogą, nie odkręca ich)
	_nearestTurn(a) { return Math.round(a / (Math.PI * 2)) * Math.PI * 2; }

	/** Natychmiast za samolotem (po starcie i po kraksie). */
	snap(s) {
		this.heading = s.heading;
		this.orbit = this.goalOrbit = 0;
		this.elevation = this.goalElevation;
		this.distance = this.goalDistance;
		this.update(s, 0, true);
	}

	update(s, dt, snap = false) {
		const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
		let d = s.heading - this.heading;
		d = Math.atan2(Math.sin(d), Math.cos(d));
		this.heading += d * k;

		// powrót za ogon po puszczeniu myszy (tylko kierunek i kąt, odległość zostaje wybrana kółkiem)
		if (this.autoReturn && !this.dragging() && !snap) {
			this.idle += dt;
			if (this.idle > RETURN_DELAY) {
				const r = 1 - Math.exp(-dt * 1.2);
				const home = this._nearestTurn(this.goalOrbit);
				this.goalOrbit += (home - this.goalOrbit) * r;
				this.goalElevation += (CHASE_DEFAULT.elevation - this.goalElevation) * r;
			}
		}
		const m = snap ? 1 : 1 - Math.exp(-dt * 10);
		this.orbit += (this.goalOrbit - this.orbit) * m;
		this.elevation += (this.goalElevation - this.elevation) * m;
		this.distance += (this.goalDistance - this.distance) * (snap ? 1 : 1 - Math.exp(-dt * 5));

		const fwd = this._fwd.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
		// patrzymy trochę przed nos (widać, dokąd lecimy), ale samolot zostaje w dolnej części kadru;
		// przy kamerze z boku, z przodu lub z góry wyprzedzenie zanika – samolot zostaje w środku kadru
		const behind = Math.max(0, Math.cos(this.orbit)) * Math.max(0, Math.cos(this.elevation));
		const ahead = (this.distance * 0.1 + s.speed * 0.2) * behind;
		const goal = this._goal.set(s.x, s.y, s.z).addScaledVector(fwd, ahead);
		if (snap) this.look.copy(goal);
		else this.look.lerp(goal, 1 - Math.exp(-dt * 8));
		const h = this.heading + this.orbit, c = Math.cos(this.elevation);
		const p = this.camera.position.set(
			s.x - Math.sin(h) * c * this.distance,
			s.y + Math.sin(this.elevation) * this.distance,
			s.z + Math.cos(h) * c * this.distance,
		);
		// spod samolotu nie wchodzimy pod ziemię
		if (this.groundAt) p.y = Math.max(p.y, this.groundAt(p.x, p.z) + 2);
		this.camera.lookAt(this.look);
	}
}
