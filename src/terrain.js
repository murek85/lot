// Teren regionu: siatka wysokości z danych, pokrycie terenu z WorldCover i materiały proceduralne w TSL
// (pola w pasach z koleinami, bory z koronami drzew i duktami, zabudowa, woda z odbiciem nieba), oświetlone
// fizycznie: światło słońca po przejściu przez atmosferę, światło nieba, cienie rzeźby i ścian lasu.
// Poza regionem ciągnie się płaski „świat zastępczy” z tym samym materiałem – zakrzywiony jak Ziemia aż po horyzont.
import { cityLight, snowCover, worldOffset } from './gfx/ground.js';
import {
	Mesh, Group, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicNodeMaterial, Vector2, DataTexture, RGBAFormat,
	UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three/webgpu';
import {
	Fn, float, vec2, vec3, vec4, ivec2, uniform, texture, textureLoad, varying, positionLocal, cameraPosition, Loop, If, int,
	max, min, clamp, abs, mix, smoothstep, normalize, dot, length, floor, fract, sin, cos, pow, exp, reflect, fwidth, select, step,
} from 'three/tsl';
import { valueNoise, fbm, voronoi, hash12, hash22 } from './gfx/noise.js';
import { waveMap } from './gfx/waves.js';
import { COL } from './gfx/palette.js';
import { forestStand, forestCover } from './gfx/stand.js';

const EARTH_R = 6371000;


function createWaveTexture() {
	const n = 256;
	const t = new DataTexture(waveMap(n), n, n, RGBAFormat, UnsignedByteType);
	t.wrapS = t.wrapT = RepeatWrapping;
	t.magFilter = LinearFilter;
	t.minFilter = LinearMipmapLinearFilter;
	t.generateMipmaps = true;
	t.needsUpdate = true;
	return t;
}

/** Siatka „ramy” wokół regionu: kwadrat o boku outer z dziurą na region, gęstsza przy regionie (krzywizna Ziemi). */
export function ringGeometry(inner, outer) {
	const h = inner / 2;
	const lines = [];
	for (let x = h; x < outer / 2; x *= 1.18) lines.push(x);
	lines.push(outer / 2);
	const innerSteps = 24;
	const coords = [...lines.map((v) => -v).reverse()];
	for (let i = 1; i < innerSteps; i++) coords.push(-h + (i / innerSteps) * inner);
	coords.push(...lines);
	const n = coords.length;
	const pos = [], idx = [];
	for (const z of coords) for (const x of coords) pos.push(x, 0, z);
	const insideCell = (i, j) => Math.abs(coords[i] + coords[i + 1]) / 2 < h && Math.abs(coords[j] + coords[j + 1]) / 2 < h;
	for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
		if (insideCell(i, j)) continue;
		const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
		idx.push(a, c, b, b, c, d);
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	return g;
}

/** Jasność lasu z tekstury koron względem lasu z drzew 3D (pomiar: średnia jasność obrazu w obu strefach). */
export const farForest = uniform(0.5);

let WAVES = null;
const wavesTex = () => (WAVES ??= texture(createWaveTexture()));

const oneHotA = (c) => max(vec4(0), vec4(1).sub(abs(vec4(c).sub(vec4(0, 1, 2, 3)))));
const oneHotB = (c) => max(vec4(0), vec4(1).sub(abs(vec4(c).sub(vec4(4, 5, 6, 7)))));

/**
 * Układ pól jak w polskiej szachownicy: bloki ~400 m dzielone prostymi liniami (raz wzdłuż, raz w poprzek),
 * a w strefach chłopskich jeszcze na wąskie pasy wzdłuż dłuższego boku. Lekko wygięte szumem, żeby granice
 * nie były od linijki. Zwraca losowy identyfikator pola, odległość do granicy (m) i współrzędną w poprzek pasów.
 */
const fieldLayout = (r, zone) => {
	const warp = vec2(valueNoise(r.div(330)), valueNoise(r.div(330).add(9.7))).sub(0.5).mul(36);
	const p = r.add(warp);
	const B0 = vec2(430, 330).mul(mix(float(1), float(1.8), hash12(zone.add(23.3))));
	const key = floor(p.div(B0)).toVar();
	const l = fract(p.div(B0));
	const lx = l.x.toVar(), ly = l.y.toVar(), sx = B0.x.toVar(), sy = B0.y.toVar();
	const splitX = (salt, prob) => {
		const h = hash12(key.add(salt));
		const t = mix(float(0.3), float(0.7), fract(h.mul(7.13)));
		const on = step(h, prob);
		const b = step(t, lx).mul(on);
		const tt = mix(float(1), select(b.greaterThan(0.5), float(1).sub(t), t), on);
		lx.assign(select(on.greaterThan(0.5), select(b.greaterThan(0.5), lx.sub(t).div(float(1).sub(t)), lx.div(t)), lx));
		sx.mulAssign(tt);
		key.assign(key.mul(1.91).add(vec2(b, 0.37)));
	};
	const splitY = (salt, prob) => {
		const h = hash12(key.add(salt));
		const t = mix(float(0.3), float(0.7), fract(h.mul(7.13)));
		const on = step(h, prob);
		const b = step(t, ly).mul(on);
		const tt = mix(float(1), select(b.greaterThan(0.5), float(1).sub(t), t), on);
		ly.assign(select(on.greaterThan(0.5), select(b.greaterThan(0.5), ly.sub(t).div(float(1).sub(t)), ly.div(t)), ly));
		sy.mulAssign(tt);
		key.assign(key.mul(1.73).add(vec2(0.61, b)));
	};
	splitX(1.7, 0.9);
	splitY(3.1, 0.75);
	splitX(5.9, 0.45);
	// pasy chłopskich pól wzdłuż dłuższego boku
	const longY = step(sx, sy);
	const strips = floor(mix(float(1), mix(float(1.5), float(7), hash12(zone.add(11.9))), hash12(key.add(8.8))));
	const u = select(longY.greaterThan(0.5), lx, ly).mul(strips);
	const ui = floor(u);
	lx.assign(select(longY.greaterThan(0.5), fract(u), lx));
	ly.assign(select(longY.greaterThan(0.5), ly, fract(u)));
	sx.assign(select(longY.greaterThan(0.5), sx.div(strips), sx));
	sy.assign(select(longY.greaterThan(0.5), sy, sy.div(strips)));
	const id = hash12(key.add(vec2(ui.mul(1.37), ui.mul(0.71))).add(0.5));
	const edgeM = min(min(lx, float(1).sub(lx)).mul(sx), min(ly, float(1).sub(ly)).mul(sy));
	return { id, edgeM, across: select(longY.greaterThan(0.5), p.x, p.y) };
};



/**
 * Barwa i światło gruntu (wspólne dla terenu regionu i kafli otwartego świata). vFlat – pozycja świata (bez krzywizny),
 * src – źródło danych: { U: { cam, time, treeH, treesFar }, isRing, hasOsm, cover(xz, footprint) → { wA, wB } (wagi klas
 * 0–3 i 4–7), ground(xz) → { h, hx, hz } (wysokość i spadki), opcjonalnie rayShadow, cavity, shoreM, reflectOcc }.
 */
export function shadeGround(vFlat, src, atmo, clouds, plane, worldShadow) {
	return Fn(() => {
		const p = vFlat;
		const xz = p.xz.add(worldOffset); // wzory w układzie stałym względem Ziemi (otwarty świat przesuwa początek)
		const footprint = max(fwidth(xz.x), fwidth(xz.y)).max(0.05);
		const sun = atmo.u.lightDir;
		const sunXZ = sun.xz.div(max(1e-4, length(sun.xz)));

		const { wA, wB } = src.cover(xz, footprint);
		wB.z.assign(smoothstep(0.35, 0.65, wB.z));
		const total = max(1e-4, dot(wA, vec4(1)).add(dot(wB, vec4(1))));
		wA.divAssign(total);
		wB.divAssign(total);
		const wGrass = wA.x, wForest = wA.y, wShrub = wA.z, wCrop = wA.w;
		const wBuilt = wB.x, wBare = wB.y, wWater = wB.z, wWet = wB.w;

		// --- wysokość i normalna ---
		const { h, hx, hz } = src.ground(xz);
		// drobna rzeźba z szumu (wydmy, bruzdy) – gaśnie, gdy piksel jest duży
		const mfade = float(1).sub(smoothstep(4, 40, footprint));
		const nx = valueNoise(xz.div(55)).sub(valueNoise(xz.div(55).add(vec2(0.35, 0)))).mul(0.12).mul(mfade);
		const nz = valueNoise(xz.div(55)).sub(valueNoise(xz.div(55).add(vec2(0, 0.35)))).mul(0.12).mul(mfade);
		const N = normalize(vec3(hx.negate().add(nx.mul(float(1).sub(wWater))), 1, hz.negate().add(nz.mul(float(1).sub(wWater)))));

		// --- albedo ---
		const albedo = vec3(0).toVar();
		const lit = float(1).toVar(); // dodatkowe cieniowanie w koronach drzew

		// trawa i łąki
		If(wGrass.add(wShrub).greaterThan(0.002), () => {
			const v = fbm(xz.div(160), 3);
			const g = mix(COL.meadowA, COL.meadowB, smoothstep(0.3, 0.75, v)).toVar();
			// suchsze, żółtawe płaty i drobna niejednorodność runi (gaśnie z odległością)
			g.assign(mix(g, COL.ripening.mul(0.8), smoothstep(0.62, 0.8, valueNoise(xz.div(55).add(7.7))).mul(0.45)));
			const fine = float(1).sub(smoothstep(1.5, 10, footprint));
			g.mulAssign(mix(float(1), mix(float(0.8), float(1.12), valueNoise(xz.div(5.5))).mul(mix(float(0.92), float(1.06), valueNoise(xz.div(1.6)))), fine));
			// kępy krzewów i pojedyncze drzewa na łąkach
			// kępy tylko w części łąk (szum dużej skali), o nieregularnym obrysie i różnej wielkości
			const bp = xz.div(7).add(vec2(valueNoise(xz.div(5)), valueNoise(xz.div(5).add(3.3))).sub(0.5).mul(0.8));
			const bush = voronoi(bp);
			const bushZone = smoothstep(0.55, 0.75, valueNoise(xz.div(300).add(1.7)));
			const isBush = step(0.82, bush.z).mul(bushZone).mul(smoothstep(mix(float(0.12), float(0.38), bush.z.sub(0.82).mul(5.5)), float(0.45), bush.x).oneMinus());
			g.assign(mix(g, COL.pineYoung.mul(1.1), isBush.mul(float(1).sub(smoothstep(3, 10, footprint)).mul(0.7).add(0.05))));
			const shrub = mix(g, COL.pineYoung, 0.5);
			albedo.addAssign(g.mul(wGrass).add(shrub.mul(wShrub)));
		});

		// pola: pasy o różnych uprawach, miedze, ścieżki technologiczne i rzędy
		If(wCrop.greaterThan(0.002), () => {
			// kierunek pól stały w strefach ~5 km (obrót wokół środka strefy – bez wirów daleko od początku układu)
			const zone = floor(xz.div(5200).add(valueNoise(xz.div(1800)).mul(0.6)));
			const ang = hash12(zone.add(3.7)).sub(0.5).mul(1.9);
			const ca = cos(ang), sa = sin(ang);
			const r = vec2(xz.x.mul(ca).sub(xz.y.mul(sa)), xz.x.mul(sa).add(xz.y.mul(ca)));
			// lite (daleki teren otwartego świata): bloki pól bez podziału na pasy – z ~10 km i tak niewidoczne
			const { id, edgeM, across: acrossM } = src.lite
				? { id: hash12(floor(r.div(vec2(430, 330))).add(zone.mul(7.1))), edgeM: float(50), across: r.x }
				: fieldLayout(r, zone);
			const border = smoothstep(1.2, 2.6, edgeM.add(footprint.mul(0.5)));
			const headland = smoothstep(10, 14, edgeM).oneMinus().mul(float(1).sub(smoothstep(1.5, 6, footprint)));
			const crop = vec3(0).toVar();
			// koniec czerwca: przewaga zbóż, rzepak w łuszczynach, jęczmień żółknie, mało gołej ziemi
			If(id.lessThan(0.14), () => { crop.assign(COL.rapeseed); })
				.ElseIf(id.lessThan(0.48), () => { crop.assign(COL.cerealGreen); })
				.ElseIf(id.lessThan(0.66), () => { crop.assign(COL.wheatBlue); })
				.ElseIf(id.lessThan(0.78), () => { crop.assign(COL.ripening); })
				.ElseIf(id.lessThan(0.87), () => { crop.assign(COL.maize); })
				.ElseIf(id.lessThan(0.90), () => { crop.assign(COL.soil); })
				.Else(() => { crop.assign(COL.meadowB); });
			// odcień pola, wilgotność gleby i niejednorodność łanu w kilku skalach
			crop.mulAssign(mix(float(0.85), float(1.15), hash12(vec2(id.mul(91), 7))));
			const moist = src.lite ? valueNoise(xz.div(90).add(id.mul(50))) : fbm(xz.div(90).add(id.mul(50)), 3);
			const patchy = valueNoise(xz.div(14).add(id.mul(30))).mul(0.6).add(valueNoise(xz.div(3.5)).mul(0.4));
			crop.mulAssign(mix(float(0.72), float(1.22), moist).mul(mix(float(0.9), float(1.08), patchy)));
			// ścieżki technologiczne (dwa ślady kół co 18 m) i rzędy kukurydzy co 0,75 m – gasną z odległością
			const across = acrossM.add(id.mul(97));
			const fr = fract(across.div(18));
			const toLine = min(fr, float(1).sub(fr)).mul(18);
			const tram = smoothstep(0.08, 0.32, abs(toLine.sub(0.9))).oneMinus().mul(float(1).sub(smoothstep(0.4, 2.0, footprint)));
			const isMaize = step(0.78, id).mul(step(id, 0.87));
			const rows = sin(across.mul(2 * Math.PI / 0.75)).mul(0.5).add(0.5).mul(float(1).sub(smoothstep(0.1, 0.6, footprint)));
			crop.assign(mix(crop, COL.soil.mul(0.9), tram.mul(0.55)));
			crop.assign(mix(crop, mix(COL.soil, COL.cerealGreen, rows), isMaize.mul(0.55).mul(float(1).sub(smoothstep(0.1, 0.6, footprint)))));
			// uwrocia: pas przy granicy, gdzie zawraca ciągnik – łan rzadszy i jaśniejszy
			crop.assign(mix(crop, crop.mul(1.12).add(COL.soil.mul(0.12)), headland.mul(0.6)));
			// miedze: wąski pas trawy, gdzieniegdzie zadrzewienia
			const hedge = step(0.75, valueNoise(r.div(28).add(id.mul(13))));
			const margin = mix(COL.meadowB, COL.pineYoung, hedge.mul(0.8));
			albedo.addAssign(mix(margin, crop, border).mul(wCrop));
		});

		if (!src.isRing) {
		// bory: siatka oddziałów z duktami, prostokątne wydzielenia w różnym wieku, korony sosen
		If(wForest.greaterThan(0.002), () => {
			const { local, toEdge, sid, age, clear, young, leafy } = forestStand(xz, h);
			// dukt: pas ~4 m na granicy oddziału, z pokryciem zależnym od wielkości piksela (bez migotania z daleka)
			const laneW = float(2.0);
			const lane = src.hasOsm ? float(0) : smoothstep(laneW.sub(footprint.mul(0.5)), laneW.add(footprint.mul(0.5)), toEdge).oneMinus().mul(min(1, laneW.mul(2).div(footprint)));
			const crown = mix(mix(COL.pineOld, COL.pineYoung, young), COL.leafy, leafy).mul(mix(float(0.85), float(1.15), hash12(sid.add(7.7))));
			const size = mix(float(4.2), float(7.5), leafy).mul(mix(float(1), float(0.55), young));
			const detail = float(1).sub(smoothstep(size.mul(0.25), size.mul(0.9), footprint));
			// z daleka: zwarty łan koron z niejednorodnością (luki, kępy) zamiast płaskiego koloru
			const clump = valueNoise(xz.div(28)).mul(0.6).add(valueNoise(xz.div(9)).mul(0.4));
			const forest = crown.mul(mix(float(0.8), float(1.12), clump)).toVar();
			// z bliska: pojedyncze korony oświetlone od strony słońca (dwa przebiegi Woronoja – tylko gdy je widać)
			If(detail.greaterThan(0.01), () => {
				const cp = xz.div(size);
				const vc = voronoi(cp);
				const vs = voronoi(cp.sub(sunXZ.mul(0.38)));
				const cover = smoothstep(0.42, 0.78, vc.x).oneMinus();
				const sunny = smoothstep(0.0, 0.55, vs.x).oneMinus();
				const near = mix(COL.gap, crown.mul(mix(float(0.75), float(1.45), sunny)), cover).mul(mix(float(0.8), float(1.15), vc.z));
				forest.assign(mix(forest, near, detail));
			});
			// tam, gdzie stoją drzewa 3D, teren pokazuje dno lasu: cień pod koronami, ściółkę i podszyt
			const dCam = length(p.xz.sub(src.U.cam));
			const trees3d = float(1).sub(smoothstep(src.U.treesFar.mul(0.8), src.U.treesFar, dCam)).mul(step(1, src.U.treesFar));
			const floorCol = mix(COL.gap.mul(1.5), COL.pineYoung.mul(0.7), valueNoise(xz.div(3.5)).mul(0.6));
			// poza zasięgiem drzew 3D korony z tekstury – przyciemnione do jasności lasu z drzew (bez jasnego pierścienia)
			forest.mulAssign(mix(float(1), farForest, step(1, src.U.treesFar).mul(trees3d.oneMinus())));
			forest.assign(mix(forest, floorCol, trees3d.mul(mix(float(0.85), float(0.3), young))));
			const cutting = mix(mix(COL.sand.mul(0.55), COL.meadowB, valueNoise(xz.div(12))), COL.pineYoung, valueNoise(xz.div(5)).mul(0.5));
			forest.assign(mix(forest, cutting, clear));
			forest.assign(mix(forest, COL.sand.mul(0.5), lane.mul(float(1).sub(clear))));
			// pod niskim słońcem korony cienią się nawzajem
			lit.assign(mix(float(1), mix(float(0.72), float(1), smoothstep(0.05, 0.6, sun.y)), wForest.mul(float(1).sub(clear)).mul(float(1).sub(lane))));
			albedo.addAssign(forest.mul(wForest));
		});

		// zabudowa: kwartały z ulicami, działki, domy z dwuspadowymi dachami, ogrody z drzewami
		If(wBuilt.greaterThan(0.002), () => {
			const zone = floor(xz.div(1400));
			const ang = hash12(zone.add(1.3)).mul(Math.PI / 2);
			const ca = cos(ang), sa = sin(ang);
			const r = vec2(xz.x.mul(ca).sub(xz.y.mul(sa)), xz.x.mul(sa).add(xz.y.mul(ca)));
			const B = vec2(24, 32);
			const plot = floor(r.div(B));
			const lp = fract(r.div(B)).mul(B);
			const hp = hash22(plot);
			const hs = mix(vec2(9, 10), vec2(15, 13), hp); // wymiary domu
			const c = vec2(B.x.mul(0.5), float(9)).add(hp.sub(0.5).mul(vec2(5, 3)));
			const dHouse = abs(lp.sub(c)).sub(hs.mul(0.5));
			const aa = footprint.mul(0.5);
			const inHouse = src.hasOsm ? float(0) : smoothstep(aa.negate(), aa, max(dHouse.x, dHouse.y)).oneMinus().mul(step(0.12, hash12(plot.add(9.1))));
			// budynek gospodarczy w głębi działki
			const c2 = vec2(B.x.mul(hp.y.mul(0.5).add(0.25)), float(24));
			const d2 = abs(lp.sub(c2)).sub(vec2(5, 3.5));
			const inShed = src.hasOsm ? float(0) : smoothstep(aa.negate(), aa, max(d2.x, d2.y)).oneMinus().mul(step(0.55, hash12(plot.add(3.3))));
			const roofId = hash12(plot.add(17.0));
			const roof = select(roofId.lessThan(0.5), COL.roofRed, select(roofId.lessThan(0.8), COL.roofBrown, COL.roofGrey));
			// dach dwuspadowy: kalenica wzdłuż dłuższego boku, połacie inaczej oświetlone
			const along = step(hs.y, hs.x);
			const side = select(along.greaterThan(0.5), lp.y.sub(c.y), lp.x.sub(c.x)).sign();
			const across = select(along.greaterThan(0.5), vec2(sa.negate(), ca), vec2(ca, sa));
			const slope = side.mul(dot(across, sunXZ)).mul(float(1).sub(sun.y).mul(0.55));
			const roofLit = roof.mul(float(1).add(slope));
			// ulice co 4–5 działek, ogrody z koronami drzew
			const street = src.hasOsm ? float(0) : smoothstep(aa.negate().add(3), aa.add(3), min(fract(r.y.div(160)), float(1).sub(fract(r.y.div(160)))).mul(160)).oneMinus();
			const tv = voronoi(xz.div(6));
			const tree = smoothstep(0.25, 0.6, tv.x).oneMinus().mul(step(0.45, tv.z));
			const yard = mix(mix(COL.garden, COL.meadowB, valueNoise(xz.div(8))), COL.pineYoung.mul(1.1), tree);
			const near = mix(mix(mix(yard, COL.roofGrey.mul(0.8), inShed), roofLit, inHouse), COL.asphalt, street);
			const far = (src.hasOsm ? mix(COL.garden, COL.meadowB, 0.4) : mix(mix(COL.roofRed, COL.roofBrown, 0.5), COL.garden, 0.6)).mul(mix(float(0.85), float(1.1), valueNoise(xz.div(40))));
			albedo.addAssign(mix(far, near, float(1).sub(smoothstep(2, 8, footprint))).mul(wBuilt));
		});

		If(wBare.greaterThan(0.002), () => {
			albedo.addAssign(COL.sand.mul(mix(float(0.8), float(1.1), valueNoise(xz.div(25)))).mul(wBare));
		});
		If(wWet.greaterThan(0.002), () => {
			albedo.addAssign(mix(COL.wetland, COL.waterShallow, step(0.6, valueNoise(xz.div(20)))).mul(wWet));
		});
		} else {
			// świat za krawędzią widać tylko z daleka – las jako łan koron bez detalu
			If(wForest.greaterThan(0.002), () => {
				const clump = valueNoise(xz.div(28)).mul(0.6).add(valueNoise(xz.div(300)).mul(0.4));
				albedo.addAssign(mix(COL.pineOld, COL.pineYoung, clump).mul(wForest));
			});
		}

		// --- śnieg (pogoda): biel na płaskim, w plamach przy małej pokrywie; las – tylko prześwity między koronami ---
		{
			const patch = valueNoise(xz.div(40)).mul(0.6).add(valueNoise(xz.div(7)).mul(0.4));
			const flat = smoothstep(0.55, 0.85, N.y);
			const amt = clamp(snowCover.mul(1.4).sub(patch.mul(0.6)), 0, 1).mul(flat).mul(float(1).sub(wWater)).mul(mix(float(1), float(0.35), wForest));
			albedo.assign(mix(albedo, vec3(0.82, 0.84, 0.88), amt));
		}

		// --- światło ---
		const sunE = atmo.sunLight(h);
		const skyE = atmo.skyIrradiance();
		// cienie: rzeźba terenu + ściany lasu (las jako 17-metrowa warstwa nad gruntem)
		const shadow = float(1).toVar();
		if (src.rayShadow) shadow.assign(src.rayShadow(xz, h, wForest, footprint));
		const sunVis = smoothstep(-0.02, 0.02, sun.y);
		const ndl = max(0, dot(N, sun)).mul(sunVis);
		const cavity = src.cavity ? src.cavity(xz, h) : float(1);
		const skyTerm = skyE.mul(cavity).mul(N.y.mul(0.5).add(0.5));
		// światło odbite od okolicy (ciepłe, ~15% albedo krajobrazu) – rozjaśnia cienie, które inaczej byłyby tylko niebieskie
		const bounce = sunE.mul(max(0, sun.y)).mul(vec3(0.13, 0.14, 0.09)).mul(cavity);
		shadow.mulAssign(clouds.groundShadow(p));
		if (!src.isRing) shadow.mulAssign(plane.groundShadow(p));
		if (!src.isRing && worldShadow) shadow.mulAssign(worldShadow.visibility(p, 0.3));
		// reflektory samolotu (nocne lądowanie)
		const landing = src.isRing ? vec3(0) : plane.lights.landingLight(p, N).add(cityLight(p));
		const diffuse = albedo.div(Math.PI).mul(sunE.mul(ndl).mul(shadow).mul(lit).add(skyTerm.add(bounce).mul(mix(float(1), float(0.8), wForest))).add(landing));

		// --- woda: fale z mapy nachyleń (trzy skale, wiatr w plamach), Fresnel, odblask GGX, odbicie nieba i drzew
		// z brzegu, głębia z odległości od brzegu (pochłanianie czerwieni), piana na linii brzegu ---
		const color = diffuse.toVar();
		if (!src.isRing) If(wWater.greaterThan(0.002), () => {
			const tt = src.U.time;
			// poziom szczegółów fal z wielkości piksela – bez migotania z daleka
			const lvl = (tile) => max(0, footprint.mul(256 / tile).log2());
			const wave = (tile, vel, rot) => {
				const c = Math.cos(rot), s = Math.sin(rot);
				const q = vec2(xz.x.mul(c).sub(xz.y.mul(s)), xz.x.mul(s).add(xz.y.mul(c))).div(tile).add(vec2(vel[0], vel[1]).mul(tt));
				const g = wavesTex().sample(q).level(lvl(tile)).rg.mul(2).sub(1);
				return vec2(g.x.mul(c).add(g.y.mul(s)), g.y.mul(c).sub(g.x.mul(s)));
			};
			// wiatr w plamach: gładkie „lustra” i zmarszczone pasy („kocie łapy”)
			const gust = smoothstep(0.35, 0.75, valueNoise(xz.div(420).add(vec2(tt.mul(0.012), tt.mul(0.004)))));
			const amp = mix(float(0.25), float(1.15), gust);
			const slope = wave(46, [0.010, 0.004], 0).mul(0.09)
				.add(wave(13, [-0.022, 0.03], 1.1).mul(0.07))
				.add(wave(3.3, [0.08, -0.05], 2.3).mul(0.05).mul(float(1).sub(smoothstep(0.4, 3, footprint))))
				.mul(amp);
			const wn = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
			const V = normalize(cameraPosition.sub(p));
			const R = reflect(V.negate(), wn);
			const nv = max(dot(wn, V), 0.02);
			const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(nv), 5)));
			const sky = atmo.skyRadiance(vec3(R.x, max(0.01, R.y), R.z));
			// odbicie brzegu: promień odbity idzie w górę – jeśli zanim wzniesie się ponad las lub zbocze, napotka je,
			// widać w wodzie ciemną ścianę drzew
			const rh = R.xz.div(max(1e-4, length(R.xz)));
			const tanR = max(R.y, 0.005).div(max(1e-4, length(R.xz)));
			const occ = src.reflectOcc ? src.reflectOcc(xz, h, rh, tanR) : float(0);
			const treeLight = sunE.mul(max(0, sun.y).mul(0.5).add(0.1)).add(skyE).div(Math.PI);
			const reflected = mix(sky, COL.pineOld.mul(1.2).mul(treeLight), occ);
			// odblask słońca (GGX); szorstkość rośnie z wielkością piksela – z daleka szeroka smuga zamiast iskier
			const rough = clamp(float(0.06).add(footprint.mul(0.012)).add(gust.mul(0.05)), 0.05, 0.35);
			const a2 = rough.mul(rough).mul(rough).mul(rough);
			const H = normalize(V.add(sun));
			const nh = max(dot(wn, H), 0);
			const D = a2.div(float(Math.PI).mul(pow(nh.mul(nh).mul(a2.sub(1)).add(1), 2)));
			const Fs = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(V, H), 0)), 5)));
			const spec = sunE.mul(D.mul(Fs).div(nv.mul(4))).mul(shadow).mul(max(0, dot(wn, sun))).mul(float(1).sub(occ));
			// głębia ≈ odległość od brzegu (jeziora polodowcowe szybko się pogłębiają), pochłanianie czerwieni i zieleni
			const shoreM = src.shoreM ? src.shoreM(xz) : float(40);
			const depthM = clamp(shoreM.mul(0.16), 0, 14);
			const Tw = exp(vec3(0.45, 0.11, 0.08).mul(depthM).mul(-1.6));
			const light = sunE.mul(max(0, sun.y)).mul(shadow).add(skyE).div(Math.PI);
			const bottom = vec3(0.13, 0.11, 0.07).mul(Tw);
			const scatter = vec3(0.004, 0.011, 0.012).mul(vec3(1).sub(Tw));
			const body = bottom.add(scatter).mul(light);
			// piana i mokry pas na linii brzegu
			const foam = float(1).sub(smoothstep(0.4, 2.2, shoreM)).mul(smoothstep(0.45, 0.8, valueNoise(xz.div(2.2).add(tt.mul(0.3))))).mul(0.5);
			const water = body.mul(float(1).sub(F)).add(reflected.mul(F)).add(spec).add(vec3(0.6).mul(light).mul(foam));
			color.assign(mix(color, water, wWater));
		});
		return color;
		return color;
	})();
}

export function createTerrain(region, atmo, clouds, plane, worldShadow = null) {
	const hasOsm = !!region.osm; // prawdziwe drogi rysuje osobna warstwa – bez wymyślonych duktów i ulic
	const size = region.size;
	const nH = region.meta.height.res, nC = region.meta.cover.res;
	const U = {
		size: uniform(size),
		edgeH: uniform(region.edgeHeight),
		cam: uniform(new Vector2()),
		time: uniform(0),
		treeH: uniform(17),
		relief: uniform(1.0),
		treesFar: uniform(0), // zasięg drzew 3D (0 – brak); w nim zamiast tekstury koron widać ściółkę między drzewami
	};
	const hTex = texture(region.heightTex);
	const hBlur = texture(region.heightBlurTex);
	const shoreTex = texture(region.shoreTex);
	const forestTex = texture(region.forestTex);
	const coverTex = region.coverTex;
	const shoreScale = region.meta.shore.metersPerUnit;

	const regionUv = (xz) => xz.div(U.size).add(0.5);
	const edgeDist = (uvR) => min(min(uvR.x, float(1).sub(uvR.x)), min(uvR.y, float(1).sub(uvR.y))).mul(U.size);
	const heightAt = (xz) => {
		const uvR = regionUv(xz);
		const h = hTex.sample(uvR).level(0).r;
		const fade = smoothstep(0, 800, edgeDist(uvR));
		return mix(U.edgeH, U.edgeH.add(h.sub(U.edgeH).mul(U.relief)), fade);
	};

	// ---------- wierzchołki: wysokość jest w geometrii (liczona na CPU – wtedy wektory ruchu dla TAA są poprawne),
	// w shaderze dochodzi tylko krzywizna Ziemi względem kamery ----------
	const makePosition = () => {
		const flat = positionLocal;
		const d = flat.xz.sub(U.cam);
		const drop = dot(d, d).div(2 * EARTH_R);
		return { flat, curved: vec3(flat.x, flat.y.sub(drop), flat.z) };
	};

	// ---------- piksele ----------
	// źródło danych gruntu regionu: rastry pokrycia, gęstości lasu, wysokości, brzegów
	const regionSrc = (isRing) => ({
		U, isRing, hasOsm,
		cover(xz) {
			const uvR = regionUv(xz);
			const inside = isRing ? float(0) : smoothstep(0, 800, edgeDist(uvR));
			// --- pokrycie terenu: dwuliniowo z klas, z poszarpanym brzegiem ---
			const wA = vec4(0).toVar(), wB = vec4(0).toVar();
			if (!isRing) {
				const jitter = vec2(valueNoise(xz.div(38)), valueNoise(xz.div(38).add(71.3))).sub(0.5).mul(1.4)
					.add(vec2(valueNoise(xz.div(9)), valueNoise(xz.div(9).add(13.1))).sub(0.5).mul(0.5));
				const pc = uvR.mul(nC).sub(0.5).add(jitter);
				const i0 = floor(pc), f = fract(pc);
				const load = (o) => {
					const ij = clamp(i0.add(o), vec2(0), vec2(nC - 1));
					return floor(textureLoad(coverTex, ivec2(ij), 0).r.mul(255).add(0.5));
				};
				const c00 = load(vec2(0, 0)), c10 = load(vec2(1, 0)), c01 = load(vec2(0, 1)), c11 = load(vec2(1, 1));
				const k00 = float(1).sub(f.x).mul(float(1).sub(f.y)), k10 = f.x.mul(float(1).sub(f.y)), k01 = float(1).sub(f.x).mul(f.y), k11 = f.x.mul(f.y);
				wA.assign(oneHotA(c00).mul(k00).add(oneHotA(c10).mul(k10)).add(oneHotA(c01).mul(k01)).add(oneHotA(c11).mul(k11)));
				wB.assign(oneHotB(c00).mul(k00).add(oneHotB(c10).mul(k10)).add(oneHotB(c01).mul(k01)).add(oneHotB(c11).mul(k11)));
			}
			// świat zastępczy za krawędzią: lasy i pola z szumu
			const fOut = smoothstep(0.50, 0.56, fbm(xz.div(4200), 4));
			const gOut = smoothstep(0.62, 0.70, valueNoise(xz.div(1300))).mul(float(1).sub(fOut));
			const outA = vec4(gOut, fOut, 0, float(1).sub(fOut).sub(gOut));
			if (isRing) {
				wA.assign(outA);
				wB.assign(vec4(0));
			}
			// las z gładkiej mapy gęstości: nieregularny, ale bez schodków po pikselach danych
			if (!isRing) {
				const fw = forestCover(forestTex, uvR, xz);
				const others = max(1e-4, wA.x.add(wA.z).add(wA.w).add(dot(wB, vec4(1))));
				const rest = float(1).sub(fw).div(others);
				wA.assign(mix(outA, vec4(wA.x.mul(rest), fw, wA.z.mul(rest), wA.w.mul(rest)), inside));
				wB.assign(wB.mul(rest).mul(inside));
			}
			return { wA, wB };
		},
		ground(xz) {
			const cell = size / nH;
			const e = float(cell);
			const h = isRing ? U.edgeH : heightAt(xz);
			const hx = isRing ? float(0) : heightAt(xz.add(vec2(e, 0))).sub(heightAt(xz.sub(vec2(e, 0)))).div(e.mul(2));
			const hz = isRing ? float(0) : heightAt(xz.add(vec2(0, e))).sub(heightAt(xz.sub(vec2(0, e)))).div(e.mul(2));
			return { h, hx, hz };
		},
		rayShadow: isRing ? null : (xz, h, wForest, footprint) => {
			const sun = atmo.u.lightDir;
			const sunXZ = sun.xz.div(max(1e-4, length(sun.xz)));
			const shadow = float(1).toVar();
			const tanE = sun.y.div(max(1e-3, length(sun.xz)));
			const y0 = h.add(wForest.mul(U.treeH)).add(0.5);
			const t = float(3).toVar();
			If(sun.y.greaterThan(0.0).and(sun.y.lessThan(0.97)), () => {
				// daleko (duży piksel) wystarczy mniej kroków – cienie i tak giną w perspektywie powietrznej
				const steps = int(select(footprint.greaterThan(12), float(8), float(16)));
				Loop({ start: int(0), end: steps }, () => {
					const s = xz.add(sunXZ.mul(t));
					const dens = forestTex.sample(clamp(regionUv(s), 0, 1)).level(0).r;
					const canopy = smoothstep(0.2, 0.8, dens).mul(U.treeH);
					const surf = heightAt(s).add(canopy);
					const ray = y0.add(t.mul(tanE));
					shadow.assign(min(shadow, clamp(ray.sub(surf).div(t.mul(0.04).add(0.6)).add(0.5), 0, 1)));
					t.mulAssign(1.42);
				});
			});
			return shadow;
		},
		cavity: isRing ? null : (xz, h) => clamp(float(1).sub(hBlur.sample(regionUv(xz)).level(0).r.sub(h).div(22)), 0.55, 1.05),
		shoreM: isRing ? null : (xz) => shoreTex.sample(regionUv(xz)).level(0).r.mul(255).sub(128).mul(shoreScale).negate(),
		reflectOcc: isRing ? null : (xz, h, rh, tanR) => {
			const reach = min(float(420), float(32).div(tanR));
			const occ = float(0).toVar();
			for (let k = 1; k <= 8; k++) {
				const x = reach.mul(Math.pow(k / 8, 1.6));
				const s = xz.add(rh.mul(x));
				const dens = forestTex.sample(clamp(regionUv(s), 0, 1)).level(0).r;
				const surf = heightAt(s).sub(h).add(smoothstep(0.3, 0.7, dens).mul(U.treeH));
				occ.assign(max(occ, smoothstep(0, 3, surf.sub(x.mul(tanR)))));
			}
			return occ;
		},
	});

	const makeMaterial = (isRing) => {
		const m = new MeshBasicNodeMaterial();
		const { flat, curved } = makePosition();
		m.positionNode = curved;
		const vFlat = varying(flat, 'vFlat');
		m.colorNode = shadeGround(vFlat, regionSrc(isRing), atmo, clouds, plane, worldShadow);
		m.fog = false;
		return m;
	};

	const group = new Group();
	const geo = new PlaneGeometry(size, size, 1023, 1023);
	geo.rotateX(-Math.PI / 2);
	// wysokości jak w shaderze: dane regionu, przewyższenie, wygaszenie do średniej krawędzi na ostatnich 800 m
	const applyHeights = (relief) => {
		const pos = geo.attributes.position;
		const e = region.edgeHeight;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i), z = pos.getZ(i);
			const edge = Math.min(size / 2 - Math.abs(x), size / 2 - Math.abs(z));
			const f = Math.min(1, Math.max(0, edge / 800));
			const fade = f * f * (3 - 2 * f);
			pos.setY(i, e + (region.heightAt(x, z) - e) * relief * fade);
		}
		pos.needsUpdate = true;
	};
	applyHeights(1);
	const reliefListeners = [];
	const inner = new Mesh(geo, makeMaterial(false));
	inner.frustumCulled = false;
	const ringGeo = ringGeometry(size, 900000);
	ringGeo.translate(0, region.edgeHeight, 0);
	const ring = new Mesh(ringGeo, makeMaterial(true));
	ring.frustumCulled = false;
	group.add(inner, ring);

	return {
		object: group,
		uniforms: U,
		/** Przewyższenie rzeźby (1 = naturalnie): geometria na CPU i ten sam mnożnik w shaderze. */
		setRelief(v) {
			U.relief.value = v;
			applyHeights(v);
			for (const f of reliefListeners) f(v);
		},
		onRelief(f) { reliefListeners.push(f); },
		/**
		 * Wysokość dokładnie na siatce terenu (interpolacja po jej trójkątach, jak rysuje GPU) – na niej kładziemy
		 * drogi i tory, żeby nie chowały się pod garbami między wierzchołkami siatki.
		 */
		meshHeightAt(x, z) {
			const n = 1024, cell = size / (n - 1);
			const fx = Math.min(n - 1.001, Math.max(0, (x + size / 2) / cell)), fz = Math.min(n - 1.001, Math.max(0, (z + size / 2) / cell));
			const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
			const y = geo.attributes.position.array;
			const H = (i, j) => y[(j * n + i) * 3 + 1];
			// trójkąty PlaneGeometry: (a, b, d) dla u + v ≤ 1 i (b, c, d) dla reszty; a = (0,0), b = (0,1), c = (1,1), d = (1,0)
			if (u + v <= 1) return H(ix, iz) + (H(ix + 1, iz) - H(ix, iz)) * u + (H(ix, iz + 1) - H(ix, iz)) * v;
			return H(ix + 1, iz + 1) + (H(ix, iz + 1) - H(ix + 1, iz + 1)) * (1 - u) + (H(ix + 1, iz) - H(ix + 1, iz + 1)) * (1 - v);
		},
		update(camera, time) {
			U.cam.value.set(camera.position.x, camera.position.z);
			U.time.value = time;
		},
	};
}
