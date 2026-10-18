// Tryb „Otwarty świat (wersja rozwojowa)”: zamiast wczytanego regionu – kafle doczytywane wokół samolotu
// (WorldStreamer + ChunkView). Gra widzi go jak region: meta (nazwa, środek, miejsce startu), wysokość terenu,
// pokrycie; teren regionu zastępuje zaślepka (teren rysują kafle), las – drzewa 3D z okna gruntu wokół kamery.
import { Group } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createForest } from '../forest.js';
import { unpackNetwork } from '../traffic/graph.js';
import { GroundWindow, SIZE as WINDOW_SIZE } from './window.js';
import { COVER } from '../gen/terrain.js';
import { WorldStreamer, tilesAround } from './streamer.js';
import { ChunkView } from './chunkview.js';

const KEY = 'lot-world';
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
			center: { lon: s.lon, lat: s.lat }, size: WORLD_SIZE,
			places: [{ id: 'start', name: s.name, lon: s.lon, lat: s.lat, cls: 'town' }], labels: [],
			cover: { classes: COVER, res: 0 },
		},
		heightAt: () => 0,
	};
}

/** Doczytywanie i widok kafli, okno gruntu z drzewami 3D, zaślepka terenu regionu. */
export function createWorld(region, scene, atmo, clouds, plane, worldShadow) {
	const view = new ChunkView(scene, atmo, clouds, plane, worldShadow);
	let lowest = Infinity;
	let win = null;
	const streamer = new WorldStreamer(region.meta.center, {
		radius: 9000, objectRadius: 4000,
		onLoad: (ch) => { view.add(ch); win?.chunkLoaded(ch); if (ch.min < lowest) { lowest = ch.min; view.setFloor(lowest - 40); } },
		onUnload: (ch) => view.remove(ch),
		onObjects: (ch, on) => view.objects(ch, on),
	});
	region.heightAt = (x, z) => streamer.heightAt(x, z);
	const terrain = {
		object: new Group(),
		uniforms: { treesFar: { value: 0 } },
		meshHeightAt: (x, z) => streamer.heightAt(x, z),
		setRelief() {},
		update() {},
	};
	win = new GroundWindow(streamer);
	const base = uniform(0);
	const forest = createForest(region, atmo, clouds, terrain, null, worldShadow, plane, { tex: win.tex, size: WINDOW_SIZE, base });
	view.U.treesFar.value = forest.uniforms.far.value; // teren w zasięgu drzew 3D pokazuje dno lasu
	// sieć ruchu (drogi, tory, chodniki) z kafli wokół samolotu – przebudowa w osobnym wątku co ~2 km lotu
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
		streamer, view, terrain, forest, window: win, net,
		coverAt: (x, z) => streamer.coverAt(x, z),
		/**
		 * Sieć dla symulacji ruchu: drogi z kafli do 5 km (pojazdy jeżdżą do 2,5 km), tory i stacje do 9 km (pociągi
		 * do 6 km) – budowane w wątku; tu tylko podmiana: pojazdy i pociągi przepinane na nowy graf (bez znikania),
		 * chodniki i perony z wczytanych kafli do 3 km.
		 */
		updateNetwork(x, z, { traffic, trains, people }) {
			if (net.ready) {
				const t0 = performance.now(), d = net.ready;
				net.ready = null;
				if (traffic) {
					const c = unpackNetwork(d.cars);
					traffic.graph = c.graph;
					traffic.sim.rebind(c.graph, c.grid);
				}
				if (trains) trains.sim.rebind(null, d.stations, unpackNetwork(d.trains));
				if (people) {
					const ps = within(net.x, net.z, 3000);
					people.sim.setRoads(ps.flatMap((ch) => ch.osm.roads), ps.flatMap((ch) => ch.osm.platforms));
				}
				net.ms = d.ms;
				net.applyMs = performance.now() - t0;
				net.builds++;
				return true;
			}
			if (net.pending || (net.x !== null && Math.hypot(x - net.x, z - net.z) < 2000)) return false;
			net.x = x; net.z = z; net.pending = true;
			netWorker.postMessage({ type: 'net', req: ++net.req, roads: keys(x, z, 5000), rails: keys(x, z, 9000), origin: streamer.origin });
			return false;
		},
		/** Co klatkę: punkt doczytywania (samolot albo środek widoku) i kamera. */
		update(camera, focus, time) {
			streamer.update(focus.x, focus.z);
			view.update(camera, focus, time);
			win.update(camera.position.x, camera.position.z);
			base.value = win.base;
		},
		/** Czekanie na kafle wokół punktu (ekran wczytywania): progress(0..1). */
		async ready(x, z, r, progress, timeout = 30000) {
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
		},
	};
}
