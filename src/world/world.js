// Tryb „Otwarty świat (wersja rozwojowa)”: zamiast wczytanego regionu – kafle doczytywane wokół samolotu
// (WorldStreamer + ChunkView). Gra widzi go jak region: meta (nazwa, środek, miejsce startu), wysokość terenu,
// pokrycie; teren regionu zastępuje zaślepka (teren rysują kafle), las – drzewa 3D z okna gruntu wokół kamery.
import { Group } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createForest } from '../forest.js';
import { unpackNetwork, shiftGraph, shiftGrid } from '../traffic/graph.js';
import { worldOffset } from '../gfx/ground.js';
import { GroundWindow, SIZE as WINDOW_SIZE } from './window.js';
import { ReliefWindow, SIZE as RELIEF_SIZE, REACH as RELIEF_REACH } from './relief.js';
import { WorldMap } from './maptiles.js';
import { COVER } from '../gen/terrain.js';
import { WorldStreamer, tilesAround } from './streamer.js';
import { ChunkView, NearMask, FarView } from './chunkview.js';
import { FAR_Z } from './chunkdata.js';

const KEY = 'lot-world';
/**
 * Krok przesunięcia początku układu (m): wielokrotność boku okien gruntu i świateł (2816 m – ich piksele zostają
 * ważne), odstępu drzew (5 m – losowanie drzew bez zmian) i komórek siatek sieci ruchu (256 i 640 m).
 */
export const REBASE_STEP = 14080;
/** Odległość samolotu od początku układu (m), przy której początek przesuwa się pod samolot. */
export const REBASE_AT = 20000;
/** Pamięć kafli w przeglądarce (bajty): najwyżej 1 GB i 30% przydziału; przycinana co 10 minut lotu. */
export async function trimTileCache() {
	const { trimTiles, usage } = await import('../gen/store.js');
	const u = await usage();
	const max = Math.min(1e9, (u?.quota || 4e9) * 0.3);
	const r = await trimTiles(max);
	if (r.removed) console.info(`Lot: pamięć kafli ${(r.before / 1e6).toFixed(0)} → ${(r.after / 1e6).toFixed(0)} MB (usunięto ${r.removed})`);
	return r;
}
export const WORLD_ID = 'world';
/** Bok obszaru lotu (m) – bez przesuwania początku układu (etap 2b) dokładność i odwzorowanie wystarczają na ±150 km. */
export const WORLD_SIZE = 300000;

/** Zapamiętane miejsce startu otwartego świata ({ name, lon, lat }). */
export const worldStart = {
	get() { try { return JSON.parse(localStorage.getItem(KEY)) ?? null; } catch { return null; } },
	set(p) { try { localStorage.setItem(KEY, JSON.stringify({ name: p.name, lon: p.lon, lat: p.lat })); } catch { /* bez pamięci */ } },
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** „Region” otwartego świata dla reszty gry; heightAt / coverAt podpina createWorld. */
export function worldRegion(start) {
	const s = start ?? { name: 'Zabrze', lon: 18.7856, lat: 50.3249 };
	return {
		world: true,
		size: WORLD_SIZE,
		osm: null,
		meta: {
			id: `${WORLD_ID}-${slug(s.name)}`, name: `Otwarty świat · ${s.name}`, generated: true,
			// rzut Mercatora o skali z szerokości startu – przesunięcie początku układu to czyste przesunięcie
			center: { lon: s.lon, lat: s.lat, merc: { k: Math.cos((s.lat * Math.PI) / 180) } }, size: WORLD_SIZE,
			places: [{ id: 'start', name: s.name, lon: s.lon, lat: s.lat, cls: 'town' }], labels: [],
			cover: { classes: COVER, res: 0 },
		},
		heightAt: () => 0,
	};
}

/** Doczytywanie i widok kafli, okno gruntu z drzewami 3D, zaślepka terenu regionu. */
export function createWorld(region, scene, atmo, clouds, plane, worldShadow, lights = null) {
	const view = new ChunkView(scene, atmo, clouds, plane, worldShadow);
	let lowest = Infinity;
	let win = null, relief = null;
	// daleki teren (kafle z11 do 50 km) pod maską wczytanych kafli z14
	const mask = new NearMask();
	const farView = new FarView(scene, view.U, atmo, clouds, plane, mask);
	const farStreamer = new WorldStreamer(region.meta.center, {
		z: FAR_Z, radius: 50000, objectRadius: 0, workers: 2,
		onLoad: (ch) => { farView.add(ch); map.add(ch); relief?.chunkLoaded(ch); if (ch.min < lowest) { lowest = ch.min; view.setFloor(lowest - 60); } },
		onUnload: (ch) => farView.remove(ch),
	});
	const map = new WorldMap();
	const streamer = new WorldStreamer(region.meta.center, {
		radius: 9000, objectRadius: 4000,
		onLoad: (ch) => { view.add(ch); mask.set(ch, true); win?.chunkLoaded(ch); relief?.chunkLoaded(ch); map.add(ch); lights?.chunkLoaded(ch); if (ch.min < lowest) { lowest = ch.min; view.setFloor(lowest - 40); } },
		onUnload: (ch) => { view.remove(ch); mask.set(ch, false); lights?.chunkUnloaded(ch); },
		onObjects: (ch, on) => view.objects(ch, on),
	});
	view.streamer = streamer; // obiekty kafli liczone w wątkach kafli
	region.heightAt = (x, z) => streamer.heightAt(x, z);
	const terrain = {
		object: new Group(),
		uniforms: { treesFar: { value: 0 } },
		meshHeightAt: (x, z) => streamer.heightAt(x, z),
		setRelief() {},
		update() {},
	};
	win = new GroundWindow(streamer);
	// cienie rzeźby terenu: okno gruntu (z bliska) i zgrubne okno rzeźby (do ~14 km) – tekstury do materiałów kafli
	relief = new ReliefWindow(streamer, farStreamer);
	const R = view.U.relief;
	R.fine.value = win.tex; R.fineSize.value = WINDOW_SIZE; R.fineReach.value = WINDOW_SIZE / 2 - 128 - WINDOW_SIZE / 512;
	R.coarse.value = relief.tex; R.coarseSize.value = RELIEF_SIZE; R.coarseReach.value = RELIEF_REACH;
	const base = uniform(0);
	const forest = createForest(region, atmo, clouds, terrain, null, worldShadow, plane, { tex: win.tex, size: WINDOW_SIZE, base, relief: R });
	view.U.treesFar.value = forest.uniforms.far.value; // teren w zasięgu drzew 3D pokazuje dno lasu
	// sieć ruchu (drogi, tory, chodniki) z kafli wokół samolotu – przebudowa w osobnym wątku co ~2 km lotu
	let hold = null; // punkt doczytywania na czas wczytywania nowego miejsca
	const vel = { vx: 0, vz: 0 }; // prędkość punktu doczytywania (m/s) – kafle wyprzedzająco przed samolotem
	const net = { x: null, z: null, req: 0, pending: false, ms: 0, applyMs: 0, builds: 0, ready: null };
	const netWorker = new Worker(new URL('./networker.js', import.meta.url), { type: 'module' });
	netWorker.onmessage = (e) => {
		const d = e.data;
		if (d.req !== net.req) return;
		net.pending = false;
		if (d.type === 'error') { console.warn('Sieć ruchu:', d.message); net.x = null; return; }
		net.ready = d;
	};
	const within = (x, z, r) => [...streamer.chunks.values()].filter((ch) => Math.hypot(ch.frame.x0 + ch.frame.w / 2 - x, ch.frame.z0 + ch.frame.h / 2 - z) < r);
	const keys = (x, z, r) => tilesAround(x, z, r, streamer.origin).map((t) => [t.x, t.y]);
	return {
		streamer, view, terrain, forest, window: win, relief, net, map, farStreamer, farView, mask,
		coverAt: (x, z) => streamer.coverAt(x, z),
		/**
		 * Sieć dla symulacji ruchu: drogi z kafli do 5 km (pojazdy jeżdżą do 2,5 km), tory i stacje do 12 km (pociągi
		 * do 6 km) – budowane w wątku; tu tylko podmiana: pojazdy i pociągi przepinane na nowy graf (bez znikania),
		 * chodniki i perony z wczytanych kafli do 3 km.
		 */
		updateNetwork(x, z, { traffic, trains, people }) {
			// podmiana rozłożona na klatki: samochody (część od razu, reszta po 300 na krok), pociągi, piesi
			if (net.ready) {
				const t0 = performance.now(), d = net.ready;
				const stage = (d.stage = (d.stage ?? 0) + 1);
				if (stage === 1 && traffic) {
					const c = unpackNetwork(d.cars);
					traffic.graph = c.graph;
					traffic.sim.rebind(c.graph, c.grid, 300);
				}
				if (stage === 2 && trains) trains.sim.rebind(null, d.stations, unpackNetwork(d.trains));
				if (stage === 3) {
					if (people) {
						const ps = within(net.x, net.z, 3000);
						people.sim.setRoads(ps.flatMap((ch) => ch.osm.roads), ps.flatMap((ch) => ch.osm.platforms));
					}
					net.ready = null;
					net.ms = d.ms;
					net.builds++;
				}
				net.applyMs = Math.max(stage === 1 ? 0 : net.applyMs, performance.now() - t0);
				return true;
			}
			if (net.pending || (net.x !== null && Math.hypot(x - net.x, z - net.z) < 2000)) return false;
			net.x = x; net.z = z; net.pending = true;
			// tory do 12 km: pociągi jeżdżą do 6 km od samolotu, a przebudowa co 2 km – z zapasem nie dojeżdżają do sztucznego
			// końca sieci (tam zawracałyby jak na końcu toru)
			netWorker.postMessage({ type: 'net', req: ++net.req, roads: keys(x, z, 5000), rails: keys(x, z, 12000), origin: streamer.origin });
			return false;
		},
		/**
		 * Nowy początek układu w punkcie (dx, dz) obecnego (wielokrotności REBASE_STEP): wszystko, co świat trzyma
		 * w metrach, przesunięte w miejscu – kafle (ramy, obiekty, siatki w scenie), okna gruntu i świateł, mapa,
		 * sieci ruchu; wzory proceduralne zostają na miejscu (worldOffset). Bez ponownego wczytywania.
		 */
		rebase(dx, dz, { traffic, trains, people }) {
			const t0 = performance.now();
			if (vel.x !== undefined) { vel.x -= dx; vel.z -= dz; }
			view.shift(streamer.chunks.values(), dx, dz);
			streamer.rebase(dx, dz);
			farView.shift(farStreamer.chunks.values(), dx, dz);
			farStreamer.rebase(dx, dz);
			mask.shift(dx, dz);
			region.meta.center = streamer.origin;
			win.shift(dx, dz);
			relief.shift();
			lights?.shift(dx, dz);
			map.shift(dx, dz);
			worldOffset.value.x += dx;
			worldOffset.value.y += dz;
			// sieć w budowie (w starym układzie) – od nowa po przesunięciu
			net.req++; net.pending = false; net.ready = null; net.x = null;
			const graphs = new Set();
			if (traffic) {
				graphs.add(traffic.sim.g);
				for (const a of traffic.sim.agents) { graphs.add(a.g); a.x -= dx; a.z -= dz; }
				if (traffic.sim.grid.map.size) shiftGrid(traffic.sim.grid, dx, dz);
				traffic.sim.cellCache.clear();
				traffic.sim.lastCell = '';
			}
			if (trains) {
				graphs.add(trains.sim.g);
				if (trains.sim.grid.map.size) shiftGrid(trains.sim.grid, dx, dz);
			}
			if (people) {
				for (const a of people.sim.agents) { if (a.g) graphs.add(a.g); a.x -= dx; a.z -= dz; }
				const ps = within(0, 0, 3000);
				people.sim.setRoads(ps.flatMap((ch) => ch.osm.roads), ps.flatMap((ch) => ch.osm.platforms));
			}
			for (const g of graphs) if (g.edges.length) shiftGraph(g, dx, dz);
			return performance.now() - t0;
		},
		/** Co klatkę: punkt doczytywania (samolot albo środek widoku) i kamera. */
		update(camera, focus, time) {
			// w trakcie wczytywania nowego miejsca (ready) – doczytywanie wokół niego, nie wokół starego położenia samolotu
			if (hold) focus = hold;
			// prędkość punktu doczytywania (wygładzona; skok – przesunięcie początku albo teleport – pomijany)
			const now = performance.now(), dt = (now - (vel.t ?? now)) / 1000;
			if (dt > 0 && vel.x !== undefined) {
				const vx = (focus.x - vel.x) / dt, vz = (focus.z - vel.z) / dt;
				if (Math.hypot(vx, vz) < 400) { const k = Math.min(1, dt * 2); vel.vx += (vx - vel.vx) * k; vel.vz += (vz - vel.vz) * k; }
			}
			vel.x = focus.x; vel.z = focus.z; vel.t = now;
			streamer.update(focus.x, focus.z, vel.vx, vel.vz);
			farStreamer.update(focus.x, focus.z, vel.vx, vel.vz);
			view.update(camera, focus, time);
			win.update(camera.position.x, camera.position.z);
			relief.update(camera.position.x, camera.position.z);
			map.update(focus.x, focus.z);
			base.value = win.base;
			R.fineBase.value = win.base; R.fineC.value.set(win.ox + WINDOW_SIZE / 2, win.oz + WINDOW_SIZE / 2);
			R.coarseBase.value = relief.base; R.coarseC.value.set(relief.cx, relief.cz);
			R.on.value = win.ox === null || relief.ox === null ? 0 : 1;
			R.smooth.value = relief.smoothed ? 1 : 0;
		},
		/** Czekanie na kafle wokół punktu (ekran wczytywania): progress(0..1). */
		async ready(x, z, r, progress, timeout = 30000) {
			hold = { x, z };
			streamer.update(x, z);
			const total = Math.max(1, streamer.missing(x, z, r));
			const t0 = performance.now();
			while (performance.now() - t0 < timeout) {
				const left = streamer.missing(x, z, r);
				progress?.(1 - left / total, left);
				if (!left) break;
				await new Promise((res) => setTimeout(res, 50));
				streamer.update(x, z);
			}
			hold = null;
		},
	};
}
