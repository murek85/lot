// Cienie rzeźby terenu otwartego świata w shaderach (TSL): uniformy okien rzeźby i promień do słońca – wspólne dla
// terenu kafli (src/world/chunkview.js) i drzew 3D (src/forest.js), żeby las w cieniu góry był ciemny jak grunt pod nim.
import { DataTexture, RGBAFormat, HalfFloatType, LinearFilter, RepeatWrapping, Vector2 } from 'three/webgpu';
import { float, int, uniform, texture, max, abs, clamp, smoothstep, mix, If, Loop, select, length, min } from 'three/tsl';

/**
 * Okna rzeźby dla cieni terenu (uniformy wspólne dla materiałów kafli; tekstury podpina world.js, gdy okna powstaną):
 * fine – okno gruntu drzew 3D (src/world/window.js: R las, G wysokość − fineBase; ~5,5 m), coarse – zgrubne okno
 * (src/world/relief.js: R las, G wysokość − coarseBase, B dane; ~55 m). Środki okien i zasięgi – do sprawdzenia, czy
 * punkt leży w oknie (tekstury adresowane w kółko). on – 0 do czasu podpięcia okien (bez cieni).
 */
export function reliefUniforms() {
	const blank = () => {
		const t = new DataTexture(new Uint16Array(4), 1, 1, RGBAFormat, HalfFloatType);
		t.wrapS = t.wrapT = RepeatWrapping;
		t.minFilter = t.magFilter = LinearFilter;
		t.needsUpdate = true;
		return t;
	};
	return {
		on: uniform(0),
		smooth: uniform(0), // kanał A zgrubnego okna (wysokość wygładzona) gotowy – mgła w dolinach
		fine: texture(blank()), fineSize: uniform(1), fineBase: uniform(0), fineC: uniform(new Vector2()), fineReach: uniform(0),
		coarse: texture(blank()), coarseSize: uniform(1), coarseBase: uniform(0), coarseC: uniform(new Vector2()), coarseReach: uniform(0),
	};
}

/**
 * Cień rzeźby i ścian lasu w punkcie (jak rayShadow regionów w src/terrain.js): promień do słońca z krokiem rosnącym
 * geometrycznie – z bliska okno gruntu (drobna rzeźba, brzegi lasu), dalej zgrubne okno (cienie gór do ~4 km).
 * lite (daleki teren) – tylko zgrubne okno, mniej kroków od dalszego startu.
 */
export function reliefShadow(R, atmo, treeH, xz, h, wForest, footprint, lite) {
	const sun = atmo.u.lightDir;
	const sunXZ = sun.xz.div(max(1e-4, length(sun.xz)));
	const tanE = sun.y.div(max(1e-3, length(sun.xz)));
	const shadow = float(1).toVar();
	const y0 = h.add(wForest.mul(treeH)).add(0.5);
	const t = float(lite ? 60 : 3).toVar();
	const inCoarse = (p) => max(abs(p.x.sub(R.coarseC.x)), abs(p.y.sub(R.coarseC.y))).lessThan(R.coarseReach);
	If(R.on.greaterThan(0.5).and(sun.y.greaterThan(0.0)).and(sun.y.lessThan(0.97)).and(inCoarse(xz)), () => {
		// daleko (duży piksel) mniej kroków o większym mnożniku – ten sam zasięg, cienie i tak giną w perspektywie powietrznej
		const far = footprint.greaterThan(12);
		const steps = lite ? int(9) : int(select(far, float(11), float(18)));
		const grow = lite ? float(1.6) : select(far, float(1.85), float(1.5));
		Loop({ start: int(0), end: steps }, () => {
			const s = xz.add(sunXZ.mul(t));
			const c = R.coarse.sample(s.div(R.coarseSize)).level(0);
			let dens = c.r, hh = c.g.add(R.coarseBase), ok = c.b.mul(select(inCoarse(s), float(1), float(0)));
			if (!lite) {
				const inFine = max(abs(s.x.sub(R.fineC.x)), abs(s.y.sub(R.fineC.y))).lessThan(R.fineReach);
				const f = R.fine.sample(s.div(R.fineSize)).level(0);
				dens = select(inFine, f.r, dens);
				hh = select(inFine, f.g.add(R.fineBase), hh);
				ok = select(inFine, float(1), ok);
			}
			const surf = hh.add(smoothstep(0.2, 0.8, dens).mul(treeH));
			const ray = y0.add(t.mul(tanE));
			const vis = clamp(ray.sub(surf).div(t.mul(0.04).add(0.6)).add(0.5), 0, 1);
			shadow.assign(min(shadow, mix(float(1), vis, ok)));
			t.mulAssign(grow);
		});
	});
	return shadow;
}

/** Zagłębienia (doliny, wąwozy) ciemniejsze w świetle nieba: zgrubna (wygładzona) rzeźba ponad punktem. */
export function reliefCavity(R, xz, h) {
	const c = R.coarse.sample(xz.div(R.coarseSize)).level(0);
	const inC = max(abs(xz.x.sub(R.coarseC.x)), abs(xz.y.sub(R.coarseC.y))).lessThan(R.coarseReach);
	const cav = clamp(float(1).sub(c.g.add(R.coarseBase).sub(h).div(22)), 0.55, 1.05);
	return mix(float(1), cav, c.b.mul(select(inC, float(1), float(0))).mul(R.on));
}

/**
 * Jeden zestaw uniformów okien rzeźby dla całej gry (teren kafli, drzewa, obiekty przez plane.groundShadow) –
 * podpina go world.js; w regionach on = 0 (bez kosztu: pętla promienia w gałęzi pomijanej).
 */
export const RELIEF = reliefUniforms();

/** Cień rzeźby dla obiektów na ziemi (budynki, drogi, aleje, pojazdy): tani wariant – tylko zgrubne okno. */
export const reliefObjectShadow = (atmo, p) => reliefShadow(RELIEF, atmo, float(0), p.xz, p.y, float(0), float(100), true);

/**
 * Odbicie brzegu w wodzie (jak reflectOcc regionów w src/terrain.js): promień odbity od wody w poziomie (rh) wznosi się
 * z nachyleniem tanR – jeśli po drodze (do ~420 m) zasłoni go las albo zbocze, w wodzie widać brzeg zamiast nieba.
 * Z bliska okno gruntu (las i rzeźba co 5,5 m), dalej zgrubne okno rzeźby. Zwraca udział zasłonięcia 0..1.
 */
export function reliefReflect(R, treeH, xz, h, rh, tanR) {
	const reach = min(float(420), float(32).div(tanR));
	const occ = float(0).toVar();
	If(R.on.greaterThan(0.5), () => {
		for (let k = 1; k <= 8; k++) {
			const x = reach.mul(Math.pow(k / 8, 1.6));
			const s = xz.add(rh.mul(x));
			const inFine = max(abs(s.x.sub(R.fineC.x)), abs(s.y.sub(R.fineC.y))).lessThan(R.fineReach);
			const f = R.fine.sample(s.div(R.fineSize)).level(0), c = R.coarse.sample(s.div(R.coarseSize)).level(0);
			const dens = select(inFine, f.r, c.r), hh = select(inFine, f.g.add(R.fineBase), c.g.add(R.coarseBase));
			const ok = select(inFine, float(1), c.b);
			const surf = hh.sub(h).add(smoothstep(0.3, 0.7, dens).mul(treeH));
			occ.assign(max(occ, smoothstep(0, 3, surf.sub(x.mul(tanR))).mul(ok)));
		}
	});
	return occ;
}
