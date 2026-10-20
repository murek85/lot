// Start gry: sprawdzenie WebGPU, wczytanie regionu, atmosfera, teren, kamera i pętla klatek.
import { WebGPURenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, Vector3, Matrix3, Timer, FloatType } from 'three/webgpu';
import { loadRegion } from './region.js';
import { Atmosphere } from './atmosphere/gpu.js';
import { createTerrain } from './terrain.js';
import { createForest } from './forest.js';
import { createRoads } from './roads.js';
import { createBuildings } from './buildings.js';
import { WorldShadow } from './shadows.js';
import { createRails } from './rails.js';
import { createRivers } from './rivers.js';
import { createBridges } from './bridges.js';
import { createDetails } from './details.js';
import { WORLD_ID, worldStart, worldRegion, createWorld, trimTileCache, REBASE_AT, REBASE_STEP } from './world/world.js';
import { WorldLights } from './world/lights.js';
import { setTerrainUniforms, setCityLights, snowCover, bareTrees } from './gfx/ground.js';
import { createCityLights } from './citylights.js';
import { createPost } from './post.js';
import { Clouds } from './clouds/clouds.js';
import { ViewCamera } from './camera.js';
import { Plane } from './plane/plane.js';
import { ChaseCamera } from './plane/chase.js';
import { CockpitCamera } from './plane/cockpitcam.js';
import { createFlight, stepFlight, propRpm } from './plane/flight.js';
import { GameAudio } from './audio/audio.js';
import { Precipitation } from './weather/precip.js';
import { buildRoadGraph, edgeGrid } from './traffic/graph.js';
import { TrafficSim, trafficByHour } from './traffic/sim.js';
import { createTrafficView } from './traffic/render.js';
import { TrainSim } from './traffic/trains.js';
import { createTrainView } from './traffic/trainview.js';
import { BirdSim, speciesWeights } from './fauna/birds.js';
import { createBirdView } from './fauna/birdview.js';
import { BirdDots } from './fauna/birddots.js';
import { PeopleSim, peopleByHour } from './fauna/people.js';
import { createPeopleView } from './fauna/peopleview.js';
import { weatherById, seasonWeather, effectiveWind, windVector, windFrom, turbulence, lightning, flashAt } from './weather/weather.js';
import { stallAmount } from './audio/mix.js';
import { aircraftById } from './plane/aircraft.js';
import { sunPosition, sunDirection, dayOfYear } from './sun.js';
import { nightSky, moonIllumination } from './moon.js';
import { lonLatToLocal, localToLonLat } from './geo.js';
import { formatLatLon, relativeWind, edgeWarning, windFromText, drawCompass, targetInfo } from './ui/nav.js';
import { BigMap } from './ui/bigmap.js';
import { buildBaseMap, regionBase, Minimap, SCALES } from './ui/minimap.js';
import { transmittance, ATMOSPHERE } from './atmosphere/model.js';
import { GameMenu, VERSION } from './ui/menu.js';
import { loadingScreen, nextFrames } from './ui/loading.js';
import { DEFAULT_REGION, REGIONS } from './regions.js';
import { isGenerated, generate as generateRegion, cancel as cancelGenerate, deleteRegion, getRegionMeta, geocode } from './gen/client.js';
import { parseCoords, pushRecent, coordName, distDir } from './ui/jump.js';
import { ownAreasOf, inOwnArea } from './world/start.js';
import { lotSource } from './world/lotsource.js';
import { TIME_SPEEDS, advanceClock, PLACES, TIMES, SEASONS, WEATHER, DEFAULT_PLAN, DEFAULT_SETTINGS, describePosition, headingDeg, load, loadRaw, save } from './ui/places.js';

const $ = (id) => document.getElementById(id);
// wybrany region (wbudowany albo wygenerowany w grze) – zmiana regionu przeładowuje stronę
const regionChoice = { get() { try { return localStorage.getItem('lot-region') || DEFAULT_REGION; } catch { return DEFAULT_REGION; } },
	set(id) { try { if (id === DEFAULT_REGION) localStorage.removeItem('lot-region'); else localStorage.setItem('lot-region', id); } catch { /* bez pamięci */ } } };
const PLACE_KIND = { city: 'miasto', town: 'miasteczko', village: 'wieś', suburb: 'dzielnica', hamlet: 'osada', centre: 'środek regionu' };
const UTC_OFFSET = 2; // czas letni w Polsce
const YEAR = 2026;
// światło księżyca w pełni (natężenie poza atmosferą; słońce = 12). Około 1/200 słońca – wielokrotnie więcej niż
// w naturze (1/400 000), żeby nocny krajobraz był czytelny jak w filmie; barwa chłodna (widzenie nocne).
const MOON_E = 0.06;
// niebo rozświetlone księżycem przygaszone względem światła na ziemi – noc ma pozostać nocą (aureola, nie zmierzch)
const MOON_SKY = 0.2;
const MOON_TINT = [0.72, 0.84, 1.0];

// szerokość geograficzna jak na mapie lotniczej: 53.64 → „53°38′ N”
const latText = (lat) => {
	const m = Math.round(Math.abs(lat) * 60);
	return `${Math.floor(m / 60)}°${String(m % 60).padStart(2, '0')}′ ${lat < 0 ? 'S' : 'N'}`;
};
// napis nad logo na ekranie startowym: znaki samolotu z planu lotu, region i jego szerokość geograficzna
const bootEyebrow = (meta) => {
	const reg = aircraftById(load('plan', DEFAULT_PLAN).aircraft).reg;
	document.querySelector('#boot .eyebrow').textContent = [reg, meta?.name, meta?.center && latText(meta.center.lat)].filter(Boolean).join(' · ');
};
// nazwa regionu do ekranów, zanim region zostanie wczytany (wygenerowane – z pamięci przeglądarki)
const regionMeta = (id) => (id === WORLD_ID ? Promise.resolve(worldRegion(worldStart.get()).meta) : isGenerated(id) ? getRegionMeta(id).catch(() => null) : fetch(`data/regions/${id}/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

function fail(title, text) {
	$('boot').hidden = true;
	$('nogpu-title').textContent = title;
	$('nogpu-text').textContent = text;
	$('nogpu').hidden = false;
}

async function start() {
	regionMeta(regionChoice.get()).then((meta) => { if (meta) bootEyebrow(meta); });
	if (!navigator.gpu) {
		return fail('Brak WebGPU', 'Ta przeglądarka nie obsługuje WebGPU. Użyj aktualnego Chrome lub Edge (Windows), Firefoksa 141+ albo Safari 26+.');
	}
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
	if (!adapter) {
		return fail('Karta graficzna niedostępna dla WebGPU', 'Włącz akcelerację sprzętową w ustawieniach przeglądarki i zaktualizuj sterowniki karty graficznej.');
	}

	const canvas = $('view');
	// ?prof – znaczniki czasu GPU (pomiar wydajności: __lot.gpuTime(n) – sam czas karty na klatkę, ms)
	const PROF = new URLSearchParams(location.search).has('prof');
	const renderer = new WebGPURenderer({ canvas, antialias: false, reversedDepthBuffer: true, powerPreference: 'high-performance', trackTimestamp: PROF });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
	await renderer.init();
	if (!renderer.backend.isWebGPUBackend) {
		return fail('Brak WebGPU', 'Przeglądarka przełączyła się na WebGL2, a ta gra wymaga WebGPU.');
	}

	let loaded = 0;
	$('boot-version').textContent = VERSION;
	const regionId = regionChoice.get();
	const bootBar = () => { $('boot-bar').style.width = `${(++loaded / 3) * 70}%`; };
	let region;
	try {
		region = regionId === WORLD_ID ? worldRegion(worldStart.get()) : await loadRegion(regionId, bootBar);
	} catch (e) {
		if (regionId === DEFAULT_REGION) throw e;
		console.warn('Region niedostępny, powrót do domyślnego:', e);
		regionChoice.set(DEFAULT_REGION);
		region = await loadRegion(DEFAULT_REGION, bootBar);
	}
	// region z kafli wektorowych (wbudowany albo wygenerowany w grze) – inne źródła danych niż Bory Tucholskie
	if (region.meta.generated) $('credits').textContent = 'Wysokości: AWS Terrain Tiles · Mapa: OpenFreeMap, © OpenMapTiles · Dane: © współtwórcy OpenStreetMap (ODbL)';
	if (region.world) $('credits').textContent = 'Wysokości: AWS Terrain Tiles · Mapa: OpenFreeMap, © OpenMapTiles i własne kafle · Pokrycie: ESA WorldCover 2021 (CC BY 4.0) · Dane: © współtwórcy OpenStreetMap (ODbL)';
	$('region-name').textContent = region.meta.name;
	bootEyebrow(region.meta);

	const scene = new Scene();
	const camera = new PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 1.2e6);
	const atmo = new Atmosphere(renderer);
	$('boot-stage').textContent = 'Chmury i atmosfera…';
	await new Promise((r) => setTimeout(r, 0));
	const clouds = new Clouds(renderer, atmo, camera);
	const sizeClouds = () => clouds.setSize(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
	sizeClouds();
	const plane = new Plane(renderer, scene, atmo);
	const worldShadow = new WorldShadow(renderer, scene);
	// nocne światła osad: przed materiałami (teren, drogi, budynki doliczają plamy światła latarni)
	// (otwarty świat: latarnie z doczytywanych kafli, plamy światła w oknie wokół kamery – src/world/lights.js)
	const worldLights = region.world ? new WorldLights() : null;
	const cityLights = worldLights ?? (region.osm ? createCityLights(region.osm, region) : null);
	setCityLights(cityLights);
	// otwarty świat (wersja rozwojowa): kafle doczytywane wokół samolotu zamiast terenu regionu
	const world = region.world ? createWorld(region, scene, atmo, clouds, plane, worldShadow, worldLights) : null;
	const terrain = world ? world.terrain : createTerrain(region, atmo, clouds, plane, worldShadow);
	if (!world) setTerrainUniforms(terrain.uniforms, region.heightTex, region.size);
	if (cityLights) scene.add(cityLights.createGlows(terrain, atmo.u.pixelAngle));
	scene.add(terrain.object);
	const rails = region.osm ? createRails(region.osm, region, terrain, atmo, clouds, plane, worldShadow) : null;
	if (rails) scene.add(...rails.objects);
	const rivers = region.osm ? createRivers(region.osm, region, terrain, atmo, clouds, plane, worldShadow) : null;
	if (rivers) scene.add(...rivers.objects);
	const roads = region.osm ? createRoads(region.osm, region, terrain, atmo, clouds, plane, worldShadow, [...rails.lines, ...rivers.lines]) : null;
	const bridges = region.osm ? createBridges(region.osm, region, terrain, atmo, clouds, plane, worldShadow) : null;
	if (bridges) scene.add(...bridges.objects, ...bridges.shadowCasters);
	const details = region.osm ? createDetails(region.osm, region, terrain, atmo, clouds, plane, worldShadow) : null;
	if (details) scene.add(...details.objects, ...details.shadowCasters);
	if (roads) scene.add(...roads.objects);
	const buildings = region.osm ? createBuildings(region.osm, region, terrain, atmo, clouds, plane, worldShadow) : null;
	if (buildings) scene.add(...buildings.shadowCasters);
	if (buildings) scene.add(...buildings.objects);
	// czerwone światła przeszkodowe na kominach i chłodniach (nocą)
	const beacons = buildings?.createBeacons(atmo.u.pixelAngle);
	if (beacons) scene.add(beacons);
	// ruch uliczny: graf dróg z danych regionu, pojazdy wokół kamery (src/traffic/)
	let traffic = null;
	// otwarty świat: sieci puste na starcie, wypełnia je world.updateNetwork z kafli wokół samolotu
	const simOsm = region.osm ?? (world ? { roads: [], rails: [], stations: [], platforms: [] } : null);
	if (simOsm) {
		$('boot-stage').textContent = 'Sieć dróg i ruch uliczny…';
		await new Promise((r) => setTimeout(r, 0));
		const graph = buildRoadGraph(simOsm.roads, { half: region.size / 2 - 50 });
		const sim = new TrafficSim(graph, edgeGrid(graph.edges), { heightAt: (x, z) => terrain.meshHeightAt(x, z), radius: 2500, max: 2500 });
		const view = createTrafficView(sim, atmo, clouds, plane, atmo.u.pixelAngle, 2500);
		scene.add(...view.objects);
		traffic = { graph, sim, view };
	}
	// ptaki: gatunek z pokrycia terenu (src/fauna/birds.js)
	const coverNames = Object.fromEntries(Object.entries(region.meta.cover.classes).map(([k, v]) => [v, k]));
	const coverData = region.coverTex?.image.data, coverRes = region.meta.cover.res;
	const coverAt = world ? (x, z) => coverNames[world.coverAt(x, z)] ?? 'crop' : (x, z) => {
		const i = Math.floor((x / region.size + 0.5) * coverRes), j = Math.floor((z / region.size + 0.5) * coverRes);
		return i < 0 || j < 0 || i >= coverRes || j >= coverRes ? 'crop' : coverNames[coverData[j * coverRes + i]];
	};
	const birdSim = new BirdSim({ groundAt: (x, z) => region.heightAt(x, z), coverAt, radius: 3000, maxGroups: 14 });
	const birds = { sim: birdSim, view: createBirdView(birdSim, atmo, clouds, plane, atmo.u.pixelAngle) };
	scene.add(...birds.view.objects);
	// piesi: chodniki, deptaki, perony – tylko z niska (src/fauna/people.js)
	let people = null;
	if (simOsm) {
		const sim = new PeopleSim(simOsm.roads, simOsm.platforms, { coverAt, heightAt: (x, z) => terrain.meshHeightAt(x, z), radius: 800, max: 1500 });
		const view = createPeopleView(sim, atmo, clouds, plane, atmo.u.pixelAngle);
		scene.add(...view.objects);
		people = { sim, view };
	}
	// ruch kolejowy: pociągi na torach regionu, postoje na stacjach (src/traffic/trains.js)
	let trains = null;
	if (simOsm?.rails?.length || world) {
		const sim = new TrainSim(simOsm.rails, simOsm.stations, { half: region.size / 2 - 50, heightAt: (x, z) => terrain.meshHeightAt(x, z), radius: 6000, max: 10 });
		const view = createTrainView(sim, atmo, clouds, plane, atmo.u.pixelAngle);
		scene.add(...view.objects);
		trains = { sim, view };
	}
	const forest = world ? world.forest : createForest(region, atmo, clouds, terrain, roads?.maskTex, worldShadow, plane);
	if (forest.objects.length) scene.add(...forest.shadowCasters, ...forest.objects);
	terrain.uniforms.treesFar.value = forest.uniforms.far.value;
	// opady i błyskawice: osobna scena dodawana po wygładzaniu (src/weather/precip.js)
	const precip = new Precipitation(atmo.u.pixelAngle);
	// odległe ptaki jako punkty – nakładka po wygładzaniu
	const birdDots = new BirdDots(birdSim, atmo, atmo.u.pixelAngle);
	// przebiegi z nakładkami czyszczone przezroczyście (krycie w kanale alfa); obraz końcowy i tak jest nieprzezroczysty
	renderer.setClearColor(0x000000, 0);
	const post = createPost(renderer, scene, camera, atmo, clouds, precip, birdDots);

	const view = new ViewCamera(camera, canvas, (x, z) => region.heightAt(x, z));
	// start nad pierwszym miejscem regionu (Tuchola), z widokiem na północny zachód
	const first = lonLatToLocal((region.meta.places ?? PLACES)[0].lon, (region.meta.places ?? PLACES)[0].lat, region.meta.center);
	view.goal.target.set(first.x - 3000, 0, first.z - 2000);
	view.target.copy(view.goal.target);
	view.goal.heading = view.heading = -0.6;
	view.active = false;

	// --- lot ---
	const groundAt = (x, z) => region.heightAt(x, z);
	// miejsca startu w układzie sceny; start 1,8 km na płd.-wsch. od miejsca, kursem na nie, 420 m nad terenem
	// regiony wygenerowane: miejscowości z mapy (bez odmiany nazw – opis położenia używa „nad miejscowością X”)
	const placeList = region.meta.places ? region.meta.places.map((p) => ({ ...p, note: PLACE_KIND[p.cls] ?? 'miejscowość' })) : PLACES;
	const places = placeList.map((p) => ({ ...p, ...lonLatToLocal(p.lon, p.lat, region.meta.center) }));
	// opis położenia: miejsca startu (z odmianą) i wszystkie miejscowości regionu (meta.labels – npm run bake:labels)
	const placeNames = new Set(places.map((p) => p.name));
	const positionPlaces = [...places, ...(region.meta.labels ?? []).filter((l) => !placeNames.has(l.name)).map((l) => ({ ...l, ...lonLatToLocal(l.lon, l.lat, region.meta.center) }))];
	const placeById = (id) => places.find((p) => p.id === id) ?? places[0];
	const startAt = (placeId, agl = 420) => {
		const p = placeById(placeId);
		const x = p.x + 1300, z = p.z + 1250;
		return createFlight({ x, z, y: Math.max(groundAt(x, z), groundAt(p.x, p.z)) + agl, heading: Math.atan2(p.x - x, -(p.z - z)) });
	};
	if (world) {
		$('boot-stage').textContent = 'Kafle mapy wokół miejsca startu…';
		const p = places[0];
		await world.ready(p.x, p.z, 2500, (f, left) => { $('boot-bar').style.width = `${10 + f * 70}%`; $('boot-stage').textContent = `Kafle mapy wokół miejsca startu… zostało ${left}`; });
	}
	let flight = startAt(places[0].id);
	const chase = new ChaseCamera(camera, canvas, groundAt);
	chase.snap(flight);
	const cockpitCam = new CockpitCamera(camera, canvas);
	let mode = 'plane';
	const MODE_NAMES = { plane: 'za samolotem', cockpit: 'kabina', free: 'swobodna' };
	const setMode = (next) => {
		const prev = mode;
		mode = next;
		view.active = mode === 'free';
		chase.active = mode === 'plane';
		cockpitCam.active = mode === 'cockpit';
		if (mode === 'free') {
			if (prev !== 'plane') chase.snap(flight);
			view.takeOver(camera, chase.look);
		}
		if (mode === 'plane') chase.snap(flight);
		// kabina: bliska płaszczyzna przycięcia (rama okna kilkadziesiąt cm od oka), szersze pole widzenia
		camera.near = mode === 'cockpit' ? 0.04 : 0.5;
		camera.fov = mode === 'cockpit' ? cockpitCam.fov : 40;
		camera.updateProjectionMatrix();
		$('mode').textContent = MODE_NAMES[mode];
	};
	const controls = { roll: 0, pitch: 0, yaw: 0 };
	const keys = new Set();
	window.addEventListener('keydown', (e) => {
		// duża mapa: Tab – otwórz / zamknij (w locie), Esc – zamknij
		if (bigMap?.open && (e.code === 'Escape' || e.code === 'Tab')) { e.preventDefault(); closeMap(); return; }
		if (e.code === 'Tab' && !e.target.closest?.('input')) {
			e.preventDefault();
			if (game === 'flying' && bigMap) openMap(null);
			return;
		}
		if (e.code === 'Escape') {
			e.preventDefault();
			if (menu.open) menu.escape();
			else if (game === 'flying') pause();
			return;
		}
		// N – skala minimapy, Shift+N – północ / kurs u góry
		if (e.code === 'KeyN' && !e.target.closest?.('input') && !e.repeat && game === 'flying' && minimap) {
			const txt = e.shiftKey ? (minimap.toggleRotate() ? 'Minimapa: kurs u góry' : 'Minimapa: północ u góry') : `Minimapa: ${minimap.nextScale().km} km`;
			save('minimap', { scale: minimap.scale, rotate: minimap.rotate });
			$('esc-hint').textContent = `${txt} · N / Shift+N`;
			escHintUntil = performance.now() + 1600;
			return;
		}
		// T – czas stop / start, Shift+T – następne przyspieszenie (×1 → ×10 → ×60)
		if (e.code === 'KeyT' && !e.target.closest?.('input') && !e.repeat && game === 'flying') {
			const running = ['x1', 'x10', 'x60'];
			const next = e.shiftKey ? running[(running.indexOf(env.timeSpeed === 'stop' ? lastRunning : env.timeSpeed) + 1) % 3]
				: env.timeSpeed === 'stop' ? lastRunning : 'stop';
			setEnvironment('timeSpeed', next);
			const sp = TIME_SPEEDS.find((s) => s.id === next);
			$('esc-hint').textContent = next === 'stop' ? 'Czas zatrzymany · T' : `Czas: ${sp.name.toLowerCase()} · T / Shift+T`;
			escHintUntil = performance.now() + 1800;
			return;
		}
		// M – dźwięk wł./wył. (w menu i w locie; nie w polach tekstowych)
		if (e.code === 'KeyM' && !e.target.closest?.('input') && !e.repeat) {
			applySetting('sound', !settings.sound);
			save('settings', settings);
			$('esc-hint').textContent = settings.sound ? 'Dźwięk włączony · M' : 'Dźwięk wyłączony · M';
			escHintUntil = performance.now() + 1800;
			if (menu.screen === 'settings') menu.show('settings');
			return;
		}
		if (menu.open) {
			// Enter na przycisku klika go sam; poza przyciskiem – start (strona główna, plan) lub ponowny lot
			if (e.code === 'Enter' && !e.target.closest?.('button, input')) menu.enter();
			return;
		}
		if (e.target.closest?.('input')) return;
		keys.add(e.code);
		if (game !== 'flying') return;
		if (e.code === 'KeyR') restart();
		if (e.code === 'KeyC') setMode({ plane: 'cockpit', cockpit: 'free', free: 'plane' }[mode]);
		if (e.code === 'KeyV') setMode(mode === 'cockpit' ? 'plane' : 'cockpit');
		if (e.code === 'KeyX') { if (mode === 'plane') chase.reset(); else if (mode === 'cockpit') cockpitCam.reset(); }
		if (e.code === 'KeyL') plane.lights.landing = !plane.lights.landing;
		if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
	});
	window.addEventListener('keyup', (e) => keys.delete(e.code));
	window.addEventListener('blur', () => keys.clear());
	const axis = (pos, neg) => (pos.some((k) => keys.has(k)) ? 1 : 0) - (neg.some((k) => keys.has(k)) ? 1 : 0);

	// --- panel ---
	const state = { hour: 7.25, day: dayOfYear(6, 29, YEAR), haze: 6, exposure: 1, relief: 1, cover: 0.42, mini: 1 };
	const settings = load('settings', DEFAULT_SETTINGS);
	// dźwięk: kontekst powstaje przy pierwszym geście (ekran startowy wymaga kliknięcia lub klawisza)
	const audio = new GameAudio();
	audio.setSettings(settings);
	const unlockAudio = () => audio.unlock();
	window.addEventListener('pointerdown', unlockAudio, true);
	window.addEventListener('keydown', unlockAudio, true);
	document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
	let plan = load('plan', DEFAULT_PLAN);
	if (!places.some((p) => p.id === plan.place)) plan.place = places[0].id;
	const bind = (id, key, fmt, apply) => {
		const el = $(id), out = $(`${id}-v`);
		el.value = state[key];
		const set = () => { state[key] = +el.value; out.textContent = fmt(state[key]); apply?.(state[key]); };
		el.addEventListener('input', set);
		set();
	};
	const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
	bind('hour', 'hour', hhmm);
	const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
	bind('day', 'day', (d) => { const t = new Date(Date.UTC(YEAR, 0, d)); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; });
	bind('haze', 'haze', (v) => (v < 4 ? 'krystalicznie' : v < 12 ? 'lekka mgiełka' : v < 25 ? 'zamglenie' : 'mgła'), (v) => atmo.setHaze(v));
	bind('exposure', 'exposure', (v) => v.toFixed(2));
	bind('cover', 'cover', (v) => (v < 0.05 ? 'bezchmurnie' : v < 0.3 ? 'pojedyncze' : v < 0.55 ? 'umiarkowane' : v < 0.75 ? 'duże' : 'pochmurno'), (v) => (clouds.u.coverage.value = v));
	bind('mini', 'mini', (v) => (v < 0.05 ? 'wyłączona' : v < 0.8 ? 'lekka' : v < 1.5 ? 'makieta' : 'mocna'));
	bind('relief', 'relief', (v) => `×${v.toFixed(1)}`, (v) => terrain.setRelief(v));
	let playing = false;
	$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; });
	$('hud-toggle').addEventListener('click', () => document.body.classList.toggle('hud-hidden'));
	window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && settings.dev && !e.target.closest?.('input')) document.body.classList.toggle('hud-hidden'); });
	const syncPanel = () => {
		for (const k of ['hour', 'day', 'haze', 'cover', 'mini', 'exposure', 'relief']) { $(k).value = state[k]; $(k).dispatchEvent(new Event('input')); }
	};

	const resize = () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.renderScale);
		renderer.setSize(window.innerWidth, window.innerHeight);
		sizeClouds();
	};
	window.addEventListener('resize', resize);

	// ================= stan gry i menu =================
	// menu – samolot krąży na autopilocie, kamera kinowo go okrąża; flying – lot; paused – symulacja stoi; crashed
	let game = 'menu';
	let lastStart = null; // do „Leć ponownie” i klawisza R: plan albo zapis
	let autosaveAt = 0, crashAt = 0, escHintUntil = 0;
	const timeName = () => TIMES.reduce((a, b) => (Math.abs(b.hour - state.hour) < Math.abs(a.hour - state.hour) ? b : a));
	const env = { time: plan.time, season: plan.season, weather: plan.weather, wind: plan.wind ?? 'light', timeSpeed: plan.timeSpeed ?? 'x1' };
	// upływ czasu w locie: ostatnie tempo „w ruchu” (do wznowienia klawiszem T)
	let lastRunning = env.timeSpeed !== 'stop' ? env.timeSpeed : 'x1';
	// pogoda w locie: śnieg na ziemi narasta powoli (cel), burza – harmonogram błyskawic, bieżące uderzenie
	const wx = { snowTarget: 0, storm: lightning(), strike: null, thunder: [], wind: { x: 0, z: 0, speed: 0 } };
	const setEnvironment = (kind, id, instant = false) => {
		env[kind] = id;
		if (kind === 'time') state.hour = (TIMES.find((t) => t.id === id) ?? TIMES[1]).hour;
		if (kind === 'season') {
			state.day = (SEASONS.find((t) => t.id === id) ?? SEASONS[1]).day;
			bareTrees.value = id === 'winter' ? 1 : 0;
		}
		if (kind === 'timeSpeed' && id !== 'stop') lastRunning = id;
		if (kind === 'weather' || kind === 'season') {
			const w = seasonWeather(weatherById(env.weather), env.season);
			state.cover = w.cover;
			state.haze = w.haze;
			const c = w.clouds ?? { base: 1500, thickness: 1600, extinction: 0.12 };
			clouds.u.base.value = c.base;
			clouds.u.thickness.value = c.thickness;
			clouds.u.extinction.value = c.extinction;
			clouds.u.history.value = 0; // inna warstwa – bez starej historii
			wx.snowTarget = w.snow ?? 0;
			if (instant) snowCover.value = wx.snowTarget;
		}
		syncPanel();
	};
	const applyPlanEnv = (p) => {
		setEnvironment('time', p.time); setEnvironment('season', p.season); setEnvironment('weather', p.weather, true); setEnvironment('wind', p.wind ?? 'light');
		setEnvironment('timeSpeed', p.timeSpeed ?? 'x1');
	};
	const applySetting = (k, v) => {
		settings[k] = v;
		const b = document.body.classList;
		if (k === 'mini' || k === 'exposure' || k === 'relief') { state[k] = v; syncPanel(); }
		if (k === 'renderScale') resize();
		if (k === 'fps') b.toggle('no-fps', !v);
		if (k === 'hud') b.toggle('no-hud', !v);
		if (k === 'minimap') b.toggle('no-minimap', !v);
		if (k === 'dev') b.toggle('dev', v);
		if (k === 'reducedMotion') b.toggle('reduced-motion', v);
		if (k === 'mouseSens') cockpitCam.sens = chase.sens = v;
		if (k === 'chaseReturn') chase.autoReturn = v;
		if (['sound', 'volume', 'engineVolume', 'ambientVolume', 'uiSounds'].includes(k)) audio.setSettings(settings);
		if (k === 'cockpitFov') { cockpitCam.fov = v; if (mode === 'cockpit') { camera.fov = v; camera.updateProjectionMatrix(); } }
	};
	const flightTitle = (f) => describePosition(f.x, f.z, positionPlaces);
	const dateText = (d) => { const t = new Date(Date.UTC(YEAR, 0, d)); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
	const snapshot = () => ({ v: 1, saved: Date.now(), origin: world ? { ...region.meta.center } : undefined, aircraft: plane.type, flight: { ...flight }, env: { ...env }, state: { hour: state.hour, day: state.day, cover: state.cover, haze: state.haze }, mode, landing: plane.lights.landing, target });
	const enterFlight = (view) => {
		game = 'flying';
		document.body.classList.add('flying');
		menu.hide();
		if (mode !== view) setMode(view === 'cockpit' || view === 'free' ? view : 'plane');
		$('esc-hint').textContent = world ? 'Otwarty świat (beta) – mapa doczytuje się w locie · Tab – mapa · Esc – pauza i menu' : 'Esc – pauza i menu';
		escHintUntil = performance.now() + (world ? 8000 : 5000);
		autosaveAt = performance.now() + 30000;
	};
	// --- wczytywanie z ekranem (jak w Maszyniście): praca rozłożona na klatki, potem rozgrzewka za kartą ---
	// (kompilacja shaderów nowej maszyny i nowego widoku, ustalenie chmur i wygładzania TAA)
	let busy = false;
	const nightAt = (h) => (h < 4.3 || h >= 22.2 ? 0.9 : h < 5.6 || h >= 21.2 ? 0.5 : 0.08);
	const warmUp = async (ls, from, to, n, label) => {
		for (let i = 1; i <= n; i++) { await nextFrames(1); ls.progress(from + ((to - from) * i) / n, i === 1 ? label : undefined); }
	};
	const loadInto = async (info, work) => {
		if (busy) return;
		busy = true;
		const ls = loadingScreen(info);
		await nextFrames(2); // karta i tło pokazane, zanim wątek zajmie budowa
		menu.hide();
		game = 'loading';
		document.body.classList.remove('flying');
		keys.clear();
		try {
			const view = await work(ls);
			await warmUp(ls, 0.6, 0.97, 30, 'Kompilacja shaderów, chmury i światło…');
			ls.done('Gotowe do startu', () => { busy = false; });
			audio.ui('done');
			enterFlight(view);
		} catch (e) {
			ls.close();
			busy = false;
			game = 'menu';
			menu.show('home');
			throw e;
		}
	};
	const prepareAircraft = async (ls, id, at = 0.12) => {
		const spec = aircraftById(id);
		ls.progress(at, plane.models.has(spec.id) ? `${spec.short} czeka w hangarze` : `Budowa maszyny: ${spec.name}…`);
		await nextFrames(1);
		plane.setAircraft(id);
	};
	const startFlight = (p) => {
		const spec = aircraftById(p.aircraft), place = placeById(p.place);
		const t = TIMES.find((x) => x.id === p.time) ?? TIMES[1], se = SEASONS.find((x) => x.id === p.season) ?? SEASONS[1], w = WEATHER.find((x) => x.id === p.weather) ?? WEATHER[2];
		return loadInto({
			eyebrow: `NOWY LOT · ${spec.reg} · ${spec.name}`, title: place.name,
			sub: `${t.name} ${hhmm(t.hour)} · ${dateText(se.day)} · ${w.name} · start 420 m nad terenem`,
			night: nightAt(t.hour), stage: 'Odprawa przed startem…',
		}, async (ls) => {
			plan = { ...p };
			save('plan', plan);
			await prepareAircraft(ls, plan.aircraft);
			ls.progress(0.3, 'Pogoda i pora dnia…');
			await nextFrames(1);
			applyPlanEnv(plan);
			ls.progress(0.45, `Podejście nad ${place.instr ?? place.name}…`);
			await nextFrames(1);
			if (world) await world.ready(place.x, place.z, 2500, (f) => ls.progress(0.45 + f * 0.12, 'Kafle mapy wokół miejsca startu…'));
			flight = startAt(plan.place);
			flight.speed = plane.spec.flight.cruise;
			lastStart = { plan: { ...plan } };
			setMode(plan.view === 'cockpit' ? 'cockpit' : 'plane');
			return plan.view;
		});
	};
	const restoreSnapshot = (s, slotLabel) => {
		const spec = aircraftById(s.aircraft);
		return loadInto({
			eyebrow: `${slotLabel ?? 'WCZYTYWANIE ZAPISU'} · ${spec.reg} · ${spec.name}`, title: flightTitle(s.flight),
			sub: `${hhmm(s.state.hour)} · ${dateText(s.state.day)} · ${Math.round(s.flight.y)} m n.p.m. · ${Math.round(s.flight.speed * 3.6)} km/h`,
			night: nightAt(s.state.hour), stage: 'Odczyt dziennika pokładowego…',
		}, async (ls) => {
			await prepareAircraft(ls, s.aircraft ?? 'dromader');
			ls.progress(0.3, 'Pogoda i pora dnia…');
			await nextFrames(1);
			Object.assign(state, s.state);
			Object.assign(env, { wind: 'light' }, s.env);
			setEnvironment('weather', env.weather, true);
			Object.assign(state, s.state);
			syncPanel();
			ls.progress(0.45, 'Odtwarzanie położenia maszyny…');
			await nextFrames(1);
			if (world) await world.ready(s.flight.x, s.flight.z, 2500, (f) => ls.progress(0.45 + f * 0.12, 'Kafle mapy wokół samolotu…'));
			flight = { ...s.flight, crashed: false, onGround: false };
			// otwarty świat: położenie zapisane względem ówczesnego początku układu – przeliczenie na obecny
			if (world && s.origin) {
				const re = (p) => { const ll = localToLonLat(p.x, p.z, s.origin), q = lonLatToLocal(ll.lon, ll.lat, region.meta.center); return { ...p, x: q.x, z: q.z }; };
				flight = re(flight);
				if (s.target) s = { ...s, target: re(s.target) };
			}
			plane.lights.landing = s.landing ?? true;
			setTarget(s.target ?? null, true);
			lastStart = { snapshot: s };
			const view = s.mode === 'cockpit' || s.mode === 'free' ? s.mode : 'plane';
			setMode(view);
			return view;
		});
	};
	const restart = () => (lastStart?.snapshot ? restoreSnapshot(lastStart.snapshot, 'PONOWNY START') : startFlight(lastStart?.plan ?? plan));
	// mała karta nad menu (zapis, przygotowanie maszyny)
	const saveWithCard = async (id) => {
		const where = flightTitle(flight);
		const ls = loadingScreen({ compact: true, eyebrow: 'DZIENNIK POKŁADOWY', title: 'Zapisywanie lotu…', sub: `${id === 'auto' ? 'autozapis' : `slot ${id}`} · ${where}`, stage: 'Zapis położenia, pory i pogody…', minTime: 0.7 });
		await nextFrames(2);
		ls.progress(0.6);
		const ok = save(slotKey(id), snapshot());
		ls.root.querySelector('h1').textContent = ok ? 'Lot zapisany' : 'Nie udało się zapisać';
		ls.done(ok ? `Zapisano w ${id === 'auto' ? 'autozapisie' : `slocie ${id}`}` : 'Pamięć przeglądarki niedostępna');
		return ok;
	};
	const switchAircraftInMenu = async (id) => {
		const spec = aircraftById(id);
		if (plane.models.has(spec.id)) { plane.setAircraft(id); flight.speed = spec.flight.cruise; return; }
		const ls = loadingScreen({ compact: true, eyebrow: `HANGAR · ${spec.reg}`, title: spec.name, sub: spec.note, stage: 'Budowa modelu…', minTime: 0.8 });
		await nextFrames(2);
		ls.progress(0.35, 'Budowa modelu i kabiny…');
		await nextFrames(1);
		plane.setAircraft(id);
		flight.speed = spec.flight.cruise;
		await warmUp(ls, 0.5, 0.95, 10, 'Kompilacja materiałów…');
		ls.done('Maszyna gotowa');
	};
	// --- regiony: zmiana (zapis i przeładowanie strony) i generator z ekranem postępu ---
	const switchRegion = async (id) => {
		if (busy) return;
		busy = true;
		if (game === 'flying' || game === 'paused') save(slotKey('auto'), snapshot());
		const name = (await regionMeta(id))?.name ?? 'Nowy region';
		const ls = loadingScreen({ eyebrow: 'ZMIANA REGIONU', title: name, sub: 'Przelot na nowe lotnisko – gra wczyta mapę od nowa', stage: 'Zapis stanu…', minTime: 0.6 });
		regionChoice.set(id);
		await nextFrames(2);
		ls.progress(0.3, 'Przeładowanie…');
		location.reload();
	};
	const generateWithScreen = async (params) => {
		if (busy) return null;
		busy = true;
		const ls = loadingScreen({
			eyebrow: 'GENERATOR REGIONÓW · OPENSTREETMAP', title: params.name,
			sub: `${Math.round(params.size / 1000)} × ${Math.round(params.size / 1000)} km · ${params.terrain === 'detailed' ? 'rzeźba szczegółowa' : 'rzeźba standardowa'} · kafle wektorowe z14`,
			night: 0.08, stage: 'Łączenie z serwerem kafli…', minTime: 0.5,
		});
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'scr-cancel';
		cancelBtn.textContent = 'Przerwij';
		cancelBtn.onclick = () => { cancelBtn.disabled = true; cancelBtn.textContent = 'Przerywanie…'; cancelGenerate(); };
		ls.root.querySelector('.scr-card').append(cancelBtn);
		try {
			const meta = await generateRegion(params, (p, label) => ls.progress(p, label));
			cancelBtn.remove();
			await new Promise((r) => ls.done(`Region gotowy · ${meta.osm.counts.buildings.toLocaleString('pl')} budynków`, r));
			return meta;
		} catch (e) {
			ls.close();
			if (!e.cancelled) throw e;
			return null;
		} finally {
			busy = false;
		}
	};
	const pause = () => { if (game !== 'flying') return; game = 'paused'; keys.clear(); menu.show('pause'); };
	const toMenu = () => {
		if (busy) return;
		if (game === 'flying' || game === 'paused') save(slotKey('auto'), snapshot());
		game = 'menu';
		document.body.classList.remove('flying');
		keys.clear();
		if (plane.models.has(plan.aircraft)) plane.setAircraft(plan.aircraft);
		else switchAircraftInMenu(plan.aircraft);
		flight = startAt(plan.place, 380);
		flight.speed = plane.spec.flight.cruise;
		applyPlanEnv(plan);
		setMode('plane');
		menu.from = {};
		menu.show('home');
	};
	// zapisy osobno dla każdego regionu (Bory Tucholskie – klucze sprzed generatora)
	const slotKey = (id) => (region.meta.id === 'bory-tucholskie' ? `slot-${id}` : `slot-${region.meta.id}-${id}`);
	const menuApi = {
		get plan() { return plan; },
		settings,
		regionName: region.meta.name,
		region: region.meta,
		places: placeList,
		switchRegion,
		// otwarty świat (wersja rozwojowa): miejsce startu zapamiętane, przeładowanie jak przy zmianie regionu
		openWorld: (p) => { worldStart.set(p); return switchRegion(WORLD_ID); },
		worldStart: worldStart.get(),
		ownAreas: () => ownAreas,
		inWorld: !!region.world,
		uiSound: (name) => audio.ui(name),
		builtinRegions: Object.values(REGIONS),
		generateRegion: generateWithScreen,
		deleteRegion: (id) => deleteRegion(id).then(() => { if (id === region.meta.id) switchRegion(DEFAULT_REGION); }),
		inFlight: () => game !== 'menu',
		startFlight,
		restart,
		resume: () => { if (game === 'paused') { game = 'flying'; menu.hide(); } },
		toMenu,
		setPlan: (p) => {
			const placeChanged = p.place !== plan.place;
			plan = { ...p };
			save('plan', plan);
			if (game === 'menu') {
				applyPlanEnv(plan);
				if (plan.aircraft !== plane.type) switchAircraftInMenu(plan.aircraft);
				if (placeChanged) { flight = startAt(plan.place, 380); flight.speed = plane.spec.flight.cruise; }
			}
		},
		environment: () => ({ ...env, time: timeName().id }),
		setEnvironment,
		setSetting: (k, v) => { applySetting(k, v); save('settings', settings); },
		saveSlot: (id) => saveWithCard(id),
		deleteSlot: (id) => save(slotKey(id), null),
		openMap: () => openMap('pause'),
		loadSlot: (id) => { const s = loadRaw(slotKey(id)); if (s?.flight) restoreSnapshot(s, id === 'auto' ? 'AUTOZAPIS' : `SLOT ${id}`); },
		slotInfo: (id) => {
			const s = loadRaw(slotKey(id));
			if (!s?.flight) return null;
			const d = new Date(s.saved);
			const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
			return { title: flightTitle(s.flight), meta: `${aircraftById(s.aircraft).short} · ${hhmm(s.state.hour)} · ${dateText(s.state.day)} · ${Math.round(s.flight.y)} m n.p.m. · zapisano ${when}` };
		},
		report: () => {
			const w = WEATHER.find((t) => t.id === env.weather) ?? WEATHER[2];
			return {
				where: flightTitle(flight), speed: Math.round(flight.speed * 3.6), alt: Math.round(flight.y),
				agl: Math.max(0, Math.round(flight.y - 1.75 - groundAt(flight.x, flight.z))), heading: headingDeg(flight.heading),
				throttle: Math.round(flight.throttle * 100), time: `${hhmm(state.hour)} · ${dateText(state.day)}`, weather: w.name,
				wind: wx.wind.speed < 0.5 ? 'cisza' : `${Math.round(wx.wind.speed * 3.6)} km/h z ${windFrom(wx.wind.x, wx.wind.z)}`,
				lights: !plane.lights.hasLanding ? 'BEZ REFLEKTORÓW' : plane.lights.landing ? 'REFLEKTORY WŁĄCZONE · L' : 'REFLEKTORY WYŁĄCZONE · L',
				aircraft: `${plane.spec.name} · ${plane.spec.reg}`,
			};
		},
	};
	// obszary własnych kafli gry (pełna jakość mapy) – do znaczków w menu i podpowiedzi w locie
	const ownAreas = lotSource().then((s) => ownAreasOf(s.raw)).catch(() => []);
	let areas = [];
	ownAreas.then((a) => { areas = a; });
	const menu = new GameMenu($('menu'), menuApi);
	for (const [k, v] of Object.entries(settings)) applySetting(k, v);
	applyPlanEnv(plan);
	plane.setAircraft(plan.aircraft);
	flight = startAt(plan.place, 380);
	flight.speed = plane.spec.flight.cruise;

	const sun = new Vector3(), moon = new Vector3(), key = new Vector3(), keyLight = new Vector3(), skyToEq = new Matrix3();
	let keyE = ATMOSPHERE.sunIlluminance, keyTint = [1, 1, 1];
	// Automatyczna ekspozycja jak w aparacie: od natężenia światła na ziemi (słońce po atmosferze + niebo, w przybliżeniu),
	// tylko częściowo (wykładnik 0,42) – południe zostaje jaśniejsze od wieczoru, ale nie wypala barw.
	const exposureCache = new Map();
	// Nocą oko się adaptuje: górna granica rośnie od 2,4 o zmierzchu do 5 w pełnej nocy (widać gwiazdy i krajobraz w księżycu).
	const autoExposure = (sy) => {
		const key = Math.round(sy * 200);
		if (!exposureCache.has(key)) {
			const T = transmittance(0.15, Math.max(-0.05, sy));
			const illum = ATMOSPHERE.sunIlluminance * (0.2126 * T[0] + 0.7152 * T[1] + 0.0722 * T[2]) * Math.max(0, sy) + 0.9 * Math.max(0.02, Math.min(1, sy * 3 + 0.15));
			const dark = Math.min(1, Math.max(0, (-0.03 - sy) / 0.12));
			exposureCache.set(key, Math.min(2.4 + 3.6 * dark, Math.pow(4.2 / illum, 0.42)));
		}
		return exposureCache.get(key);
	};
	// kamera menu: powolny przelot dookoła krążącego samolotu; samolot w prawej części kadru (menu jest po lewej)
	const camOff = new Vector3(), camLook = new Vector3(), camRight = new Vector3();
	const menuCamera = (t) => {
		const az = t * 0.07, el = 0.1 + 0.06 * Math.sin(t * 0.11), d = 36 + 5 * Math.sin(t * 0.05);
		const p = plane.model.position;
		camOff.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
		camera.position.copy(p).add(camOff);
		camRight.set(Math.cos(az), 0, -Math.sin(az));
		camLook.copy(p).addScaledVector(camRight, -d * 0.2);
		camera.up.set(0, 1, 0);
		camera.lookAt(camLook);
		if (camera.fov !== 40 || camera.near !== 0.5) { camera.fov = 40; camera.near = 0.5; camera.updateProjectionMatrix(); }
	};
	const timer = new Timer();
	let frames = 0, fpsTime = 0;
	const compassCanvas = $('compass-c'), compassCtx = compassCanvas.getContext('2d');
	// nazwy miast nad krajobrazem (opcja): miasta i miasteczka 0,8–15 km od kamery, rzutowane na ekran
	const labelEls = [];
	const labelPick = positionPlaces.filter((p) => p.cls === 'city' || p.cls === 'town' || !p.cls);
	// otwarty świat: miejscowości z doczytanych kafli – do opisu położenia i podpisów w krajobrazie
	if (world) {
		world.map.onPlaces = (list) => {
			const ps = list.filter((p) => !placeNames.has(p.name));
			positionPlaces.push(...ps);
			labelPick.push(...ps.filter((p) => p.cls === 'city' || p.cls === 'town'));
			// miejsca startu: miasta i miasteczka z mapy (do 40 km, najwyżej 10, nie bliżej siebie niż 4 km)
			for (const p of ps) {
				if (places.length >= 10 || (p.cls !== 'city' && p.cls !== 'town')) continue;
				const d = Math.hypot(p.x - places[0].x, p.z - places[0].z);
				if (d > 40000 || places.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 4000)) continue;
				const ang = (Math.atan2(p.x - places[0].x, -(p.z - places[0].z)) + 2 * Math.PI) % (2 * Math.PI);
				const dir = ['płn.', 'płn.-wsch.', 'wsch.', 'płd.-wsch.', 'płd.', 'płd.-zach.', 'zach.', 'płn.-zach.'][Math.round(ang / (Math.PI / 4)) % 8];
				const place = { id: `w-${p.name}`, name: p.name, cls: p.cls, note: `${PLACE_KIND[p.cls]} · ${Math.round(d / 1000)} km na ${dir} od startu`, x: p.x, z: p.z };
				places.push(place);
				placeList.push(place);
				placeNames.add(p.name);
			}
		};
		world.map.onPlaces([...world.map.labels]); // kafle wczytane przed startem
	}
	const lv = new Vector3();
	const updateLabels3d = () => {
		const cp = camera.position, W = innerWidth, Hh = innerHeight;
		const vis = [];
		for (const p of labelPick) {
			const d = Math.hypot(p.x - cp.x, p.z - cp.z);
			if (d < 800 || d > 15000) continue;
			// tylko przed kamerą (przy odwróconym buforze głębi rzut punktów za kamerą też trafia w ekran – odbity)
			lv.set(p.x, groundAt(p.x, p.z) + 40 - (d * d) / 12742000, p.z);
			if (lv.clone().applyMatrix4(camera.matrixWorldInverse).z > -1) continue;
			lv.project(camera);
			if (Math.abs(lv.x) > 1 || Math.abs(lv.y) > 1) continue;
			vis.push({ p, x: (lv.x + 1) / 2 * W, y: (1 - lv.y) / 2 * Hh, d });
		}
		vis.sort((a, b) => a.d - b.d);
		vis.length = Math.min(vis.length, 12);
		while (labelEls.length < vis.length) { const el = document.createElement('span'); $('labels3d').append(el); labelEls.push(el); }
		labelEls.forEach((el, i) => {
			const v = vis[i];
			el.hidden = !v;
			if (!v) return;
			if (el.textContent !== v.p.name) el.textContent = v.p.name;
			el.className = v.p.cls === 'city' ? 'city' : 'town';
			el.style.left = `${v.x}px`; el.style.top = `${v.y}px`;
			el.style.opacity = String(Math.min(1, (15000 - v.d) / 3000));
		});
	};
	// cel lotu (duża mapa): { name, gen, x, z } albo null; prowadzenie w panelu, na pasku kursu i minimapie
	let target = null, targetReached = false;
	const setTarget = (t, quiet = false) => {
		target = t ? { name: t.name ?? null, gen: t.gen ?? null, x: t.x, z: t.z } : null;
		targetReached = false;
		if (minimap) minimap.target = target;
		if (!quiet) {
			$('esc-hint').textContent = target ? `Cel lotu: ${target.name ?? 'punkt na mapie'}` : 'Bez celu lotu';
			escHintUntil = performance.now() + 1800;
		}
	};
	// duża mapa: w locie wstrzymuje symulację (jak pauza); z menu pauzy – powrót do pauzy
	let bigMap = null, mapFrom = null;
	const openMap = (from) => {
		if (!bigMap || bigMap.open) return;
		mapFrom = from ?? game;
		if (game === 'flying') game = 'paused';
		menu.hide();
		document.body.classList.add('paused');
		bigMap.show({ x: flight.x, z: flight.z, heading: flight.heading }, target);
	};
	const closeMap = () => {
		if (!bigMap?.open) return;
		bigMap.hide();
		if (mapFrom === 'pause') menu.show('pause');
		else { game = 'flying'; document.body.classList.remove('paused'); keys.clear(); }
		mapFrom = null;
	};
	// minimapa: mapa bazowa budowana po pierwszej klatce (nie wydłuża wczytywania), płótno w rozdzielczości ekranu
	let minimap = null;
	const mmCanvas = $('minimap');
	mmCanvas.width = mmCanvas.height = Math.round(208 * Math.min(2, window.devicePixelRatio || 1));
	setTimeout(async () => {
		const t0 = performance.now();
		// otwarty świat: płytki mapy i nazwy miejscowości z kafli (lista rośnie z doczytywaniem)
		const base = world ? world.map : regionBase(await buildBaseMap(region, region.osm, 4096), region.size);
		const labels = world ? world.map.labels : positionPlaces.map((p) => ({ name: p.name, cls: p.cls ?? 'town', x: p.x, z: p.z }));
		minimap = new Minimap(mmCanvas, base, region.size, labels, places);
		const st = load('minimap', { scale: 1, rotate: true });
		minimap.scale = st.scale; minimap.rotate = st.rotate;
		minimap.target = target;
		bigMap = new BigMap($('bigmap'), base, region.size, labels, places, (t) => setTarget(t));
		// tryb deweloperski: Shift+klik na dużej mapie – skok samolotu w to miejsce
		bigMap.onJump = (p) => { if (!settings.dev) return false; closeMap(); jumpTo(p); return true; };
		console.info(`Lot: mapa bazowa ${Math.round(performance.now() - t0)} ms`);
	}, 300);
	// środek układu (otwarty świat przesuwa go razem z początkiem układu – region.meta.center)
	let center = region.meta.center;
	const worldFocus = { x: 0, z: 0 };
	let sunDirNow = null; // kierunek słońca z ostatniej klatki (pomiar GPU)
	// otwarty świat: pamięć kafli przycinana minutę po starcie i co 10 minut (najdawniej używane kafle)
	if (world) {
		const trim = () => trimTileCache().catch((e) => console.warn('Pamięć kafli:', e));
		setTimeout(trim, 60e3);
		setInterval(trim, 600e3);
	}
	const shiftOrigin = (dx, dz) => {
		const ms = world.rebase(dx, dz, { traffic, trains, people });
		center = region.meta.center;
		flight.x -= dx; flight.z -= dz;
		for (const v of [camera.position, chase.look, chase._goal, view.target, view.goal.target]) { v.x -= dx; v.z -= dz; }
		camera.updateMatrixWorld();
		for (const p of places) { p.x -= dx; p.z -= dz; } // miejsca startu (też w opisie położenia)
		if (target) { target.x -= dx; target.z -= dz; }
		for (const g of birds.sim.groups) {
			g.x -= dx; g.z -= dz; g.tx -= dx; g.tz -= dz;
			if (g.thermal) { g.thermal.x -= dx; g.thermal.z -= dz; }
			for (const b of g.birds) { b.x -= dx; b.z -= dz; }
		}
		precip.camPrev.x -= dx; precip.camPrev.z -= dz;
		clouds.shiftOrigin(dx, dz);
		forest.shiftOrigin?.(dx, dz);
		post.resetHistory(); // wygładzanie bez historii z poprzedniego układu (bez smug i mignięcia)
		console.info(`Lot: początek układu przesunięty o ${(dx / 1000).toFixed(1)}, ${(dz / 1000).toFixed(1)} km (${ms.toFixed(1)} ms)`);
	};

	// --- skok w dowolne miejsce (narzędzie deweloperskie: panel H – pole „Skok do”, duża mapa – Shift+klik) ---
	const JUMP_KEY = 'lot-jumps';
	let jumps = (() => { try { return JSON.parse(localStorage.getItem(JUMP_KEY)) ?? []; } catch { return []; } })();
	const hint = (text, ms = 3500) => { $('esc-hint').textContent = text; escHintUntil = performance.now() + ms; };
	let jumping = false;
	/**
	 * Samolot w punkt { lon, lat } albo { x, z } (układ gry), z nazwą: wysokość 400 m nad terenem, kurs i prędkość bez
	 * zmian. Otwarty świat: do 150 km – na miejscu (przesunięcie początku układu, doczytanie okolicy pod kartą), dalej –
	 * otwarty świat od nowa w tym miejscu (rzut Mercatora ma skalę z szerokości startu); region – tylko w jego granicach,
	 * poza nimi – otwarty świat w tym miejscu.
	 */
	const jumpTo = async (p) => {
		if (jumping || busy) { hint(jumping ? 'Poczekaj – trwa poprzedni skok' : 'Poczekaj – trwa wczytywanie'); return; }
		const ll = p.lon != null ? { lon: p.lon, lat: p.lat } : localToLonLat(p.x, p.z, region.meta.center);
		const name = p.name ?? coordName(ll);
		let { x, z } = p.lon != null ? lonLatToLocal(p.lon, p.lat, region.meta.center) : p;
		const far = world ? Math.hypot(x - flight.x, z - flight.z) > 150000 : Math.max(Math.abs(x), Math.abs(z)) > region.size / 2 - 300;
		jumps = pushRecent(jumps, { name, lon: ll.lon, lat: ll.lat });
		try { localStorage.setItem(JUMP_KEY, JSON.stringify(jumps)); } catch { /* bez pamięci */ }
		renderJumps();
		if (far) {
			// daleko (albo poza regionem) – otwarty świat od nowa w tym miejscu
			hint(world ? `${name}: ponad 150 km – otwarty świat od nowa` : `${name}: poza regionem – otwarty świat`);
			worldStart.set({ name, lon: ll.lon, lat: ll.lat });
			return switchRegion(WORLD_ID);
		}
		jumping = true;
		try {
			if (world) {
				// początek układu pod nowe miejsce (czyste przesunięcie), potem kafle wokół
				if (Math.hypot(x, z) > REBASE_AT) {
					const dx = Math.round(x / REBASE_STEP) * REBASE_STEP, dz = Math.round(z / REBASE_STEP) * REBASE_STEP;
					shiftOrigin(dx, dz);
					x -= dx; z -= dz;
				}
				if (world.streamer.missing(x, z, 2500)) {
					const ls = loadingScreen({ compact: true, eyebrow: 'SKOK · TRYB DEWELOPERSKI', title: name, sub: coordName(ll), stage: 'Wczytywanie okolicy…', minTime: 0.3 });
					await nextFrames(1);
					await world.ready(x, z, 2500, (f) => ls.progress(f * 0.95, 'Wczytywanie okolicy…'));
					ls.done('Na miejscu');
				}
			}
			flight.x = x; flight.z = z;
			flight.y = groundAt(x, z) + 400;
			flight.crashed = false; flight.onGround = false;
			if (mode === 'free') { view.goal.target.set(x, groundAt(x, z), z); view.target.copy(view.goal.target); }
			chase.snap(flight);
			post.resetHistory();
			hint(`Skok: ${name}`);
		} finally {
			jumping = false;
		}
	};
	// otwarty świat w locie (co sekundę): wlot i wylot z obszaru własnych kafli, kafle, które nie dochodzą (brak sieci)
	let worldCheckAt = 0, ownHere = null, tileErrors = 0;
	const worldCheck = () => {
		worldCheckAt = performance.now() + 1000;
		const own = areas.length ? inOwnArea(areas, localToLonLat(flight.x, flight.z, region.meta.center)) : null;
		if (own !== null && ownHere !== null && own !== ownHere) {
			hint(own ? 'Obszar pełnej jakości mapy – własne kafle gry' : 'Koniec obszaru pełnej jakości – dalej mapa podstawowa (OpenFreeMap)', 5000);
		}
		ownHere = own;
		const errors = world.streamer.stats.errors;
		if (errors > tileErrors && world.streamer.missing(flight.x, flight.z, 2500)) {
			hint(navigator.onLine === false ? 'Brak połączenia z internetem – mapa doczyta się po powrocie sieci' : 'Mapa nie doczytuje się – serwer kafli nie odpowiada, ponawiam…', 4000);
		}
		tileErrors = errors;
	};
	// panel H: pole „Skok do” (miejscowość z wyszukiwarki albo współrzędne), przyciski: start, +10 km, ostatnie
	const jumpInput = $('jump-q'), jumpList = $('jump-list');
	const jumpButton = (label, title, fn) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = label;
		b.title = title;
		b.onclick = fn;
		return b;
	};
	function renderJumps(results = null) {
		jumpList.replaceChildren(...(results
			? results.map((r) => {
				// wynik wyszukiwania: nazwa, a pod nią rodzaj, położenie (powiat, województwo) i odległość od samolotu
				const { x, z } = lonLatToLocal(r.lon, r.lat, region.meta.center);
				const b = jumpButton('', r.label ?? r.name, () => { jumpInput.value = ''; jumpTo(r); renderJumps(); });
				b.className = 'result';
				const sub = [r.kind, r.area, distDir(x - flight.x, z - flight.z)].filter(Boolean).join(' · ');
				b.append(Object.assign(document.createElement('b'), { textContent: r.name }), Object.assign(document.createElement('small'), { textContent: sub }));
				return b;
			})
			: [
				jumpButton('Start', 'Miejsce startu tego świata', () => jumpTo({ ...places[0], name: places[0].name })),
				jumpButton('+10 km', '10 km dalej w kierunku lotu', () => jumpTo({ x: flight.x + Math.sin(flight.heading) * 10000, z: flight.z - Math.cos(flight.heading) * 10000 })),
				...jumps.map((j) => jumpButton(j.name, coordName(j), () => jumpTo(j))),
			]));
	}
	const jumpQuery = async () => {
		const q = jumpInput.value.trim();
		if (!q) return renderJumps();
		const c = parseCoords(q);
		if (c) { jumpInput.value = ''; return jumpTo({ ...c, name: coordName(c) }); }
		jumpList.replaceChildren(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Szukanie…' }));
		let found = [];
		try { found = await geocode(q); } catch (e) { console.warn(e); }
		if (!found.length) { jumpList.replaceChildren(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Nic nie znaleziono' })); return; }
		if (found.length === 1) { jumpInput.value = ''; renderJumps(); return jumpTo(found[0]); }
		renderJumps(found);
	};
	jumpInput.addEventListener('keydown', (e) => {
		e.stopPropagation(); // klawisze lotu (W, A, S, D…) nie sterują samolotem podczas pisania
		if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); jumpQuery(); }
		if (e.code === 'Escape') { jumpInput.value = ''; jumpInput.blur(); renderJumps(); }
	});
	$('jump-go').onclick = jumpQuery;
	renderJumps();

	/**
	 * Kompilacja shaderów i potoków obiektów sceny z góry (jak w Maszyniście) – ekran wczytywania żyje i pokazuje postęp:
	 * progress('shaders' | 'pipes', gotowe, wszystkie). compileAsync Three buduje shadery obiekt po obiekcie z oddaniem
	 * sterowania przeglądarce, ale na każdy potok karty czeka osobno (szeregowo, kilka razy dłużej niż pierwsza klatka) –
	 * obietnice potoków zbieramy tu i czekamy na komplet na końcu (karta kompiluje je równolegle). Ten sam bufor (format
	 * jak po pierwszym rysowaniu) i te same wyjścia (kolor, wektory ruchu) co przebieg sceny w efektach końcowych –
	 * inaczej powstałyby inne warianty, a pierwsza klatka i tak kompilowałaby swoje. Zwraca { shaders, pipes }.
	 */
	const precompile = async (progress) => {
		const sp = post.scenePass, t = sp.renderTarget, rt = renderer.getRenderTarget(), m = renderer.getMRT();
		// to, co PassNode.setup ustawia przy pierwszym rysowaniu (format koloru i głębi, próbki)
		t.samples = sp.options?.samples ?? renderer.samples;
		t.texture.type = renderer.getOutputBufferType();
		if (renderer.reversedDepthBuffer && t.depthTexture) t.depthTexture.type = FloatType;
		const P = renderer._pipelines, get = P.getForRender, pipes = [];
		let pipesDone = 0, shaders = 0;
		P.getForRender = function (ro, promises) {
			if (!promises) return get.call(this, ro, promises);
			const q = [], r = get.call(this, ro, q);
			for (const p of q) pipes.push(p.finally(() => { pipesDone++; progress?.('pipes', pipesDone, pipes.length); }));
			return r; // compileAsync dostaje pustą listę – nie czeka na ten potok
		};
		// compileAsync oddaje sterowanie (scheduler.yield) po każdym kroku budowy shadera i po każdym obiekcie – setki
		// przerw kilka razy wydłużały kompilację; na jej czas przerwa najwyżej co 100 ms (postęp na ekranie odświeżany 10 razy na sekundę)
		const S = globalThis.scheduler, yieldReal = S?.yield;
		let lastYield = performance.now();
		if (yieldReal) S.yield = () => (performance.now() - lastYield < 100 ? Promise.resolve() : yieldReal.call(S).then(() => { lastYield = performance.now(); }));
		renderer.setRenderTarget(t);
		renderer.setMRT(sp.getMRT());
		try {
			await renderer.compileAsync(scene, camera, null, (e) => { shaders = e.total; progress?.('shaders', e.loaded, e.total); });
		} catch (e) {
			console.warn('Lot: kompilacja shaderów z góry –', e);
		} finally {
			if (yieldReal) S.yield = yieldReal;
			P.getForRender = get;
			renderer.setRenderTarget(rt);
			renderer.setMRT(m);
		}
		if (pipes.length) progress?.('pipes', pipesDone, pipes.length);
		await Promise.allSettled(pipes);
		return { shaders, pipes: pipes.length };
	};
	const frame = () => {
		timer.update();
		const dt = Math.min(0.1, timer.getDelta());
		const t = timer.getElapsed();
		// zegar gry: w locie płynie z wybranym tempem (pauza, menu i wczytywanie – stoi)
		const rate = (TIME_SPEEDS.find((s) => s.id === env.timeSpeed) ?? TIME_SPEEDS[1]).rate;
		if (game === 'flying' && rate > 0 && !playing) {
			const c = advanceClock(state.hour, state.day, dt, rate);
			state.hour = c.hour;
			state.day = c.day;
		}
		if (playing) {
			state.hour = (state.hour + dt * 0.25) % 24;
			$('hour').value = state.hour;
			$('hour-v').textContent = hhmm(state.hour);
		}
		const p = sunPosition(state.day, state.hour - UTC_OFFSET, center.lat, center.lon);
		sun.set(...sunDirection(p.azimuth, p.elevation));
		// księżyc i niebo gwiazdowe; nocą (słońce pod horyzontem) główne światło sceny przechodzi na księżyc
		const ns = nightSky(YEAR, state.day, state.hour - UTC_OFFSET, center.lat, center.lon);
		moon.set(...ns.moonDir);
		const moonLux = MOON_E * Math.pow(moonIllumination(sun.toArray(), ns.moonDir), 1.5);
		const moonKey = Math.min(1, Math.max(0, (-0.02 - sun.y) / 0.1));
		const useMoon = sun.y < -0.02;
		key.copy(useMoon ? moon : sun);
		keyTint = useMoon ? MOON_TINT : [1, 1, 1];
		keyE = useMoon ? moonLux * moonKey : ATMOSPHERE.sunIlluminance;
		// srebrne obrzeża chmur pod księżyc przy filmowo wzmocnionym świetle księżyca byłyby jaśniejsze od nieba – przygaszamy
		clouds.u.sunGain.value = useMoon ? 0.6 : 2.0;
		const m = ns.matrix;
		skyToEq.set(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]);
		atmo.setNight({
			moonDir: moon, moonE: moonLux * MOON_SKY, lightDir: key, lightE: keyLight.set(keyE * keyTint[0], keyE * keyTint[1], keyE * keyTint[2]),
			skyToEq, pixelAngle: (2 * Math.tan((camera.fov * Math.PI) / 360)) / renderer.domElement.height,
		});
		let input = { roll: 0, pitch: 0, throttle: 0 };
		if (game === 'flying' && mode !== 'free') {
			input = {
				roll: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
				pitch: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * (settings.invertPitch ? -1 : 1),
				throttle: axis(['KeyE', 'ShiftLeft', 'ShiftRight'], ['KeyQ']),
			};
		} else if (game === 'menu') {
			// autopilot pokazowy: łagodny krąg w lewo ~400 m nad terenem, stały gaz
			const agl = flight.y - groundAt(flight.x, flight.z);
			// przechył: zwykły samolot – stałe wychylenie lotek (lotki ustalają docelowy przechył, do którego samolot
			// dochodzi sam); regulator ze sprzężeniem przeskakiwał cel co klatkę i skrzydła drżały. Akrobacyjny (lotki
			// obracają bez ograniczeń) – łagodny regulator: krok k·rollRate·dt ≪ 1, bez przeregulowania
			const P = plane.spec.flight, BANK = -0.34;
			const roll = P.aerobatic ? Math.max(-1, Math.min(1, (BANK - flight.bank) * 0.6)) : BANK / P.maxBank;
			input = { roll, pitch: Math.max(-1, Math.min(1, (380 - agl) / 120)), throttle: 0 };
			flight.throttle = 0.62;
		}
		const sinkBefore = -Math.sin(flight.gamma) * flight.speed;
		const ev = game !== 'paused' && game !== 'loading' ? stepFlight(flight, input, dt, groundAt, plane.spec.flight) : null;
		if (ev && game === 'flying') audio.event(ev, Math.min(1, Math.max(0, sinkBefore / 4.5)));
		if (ev === 'crash' && game === 'flying') {
			game = 'crashed';
			crashAt = performance.now() + 1400;
		}
		if (game === 'crashed' && crashAt && performance.now() > crashAt) { crashAt = 0; keys.clear(); menu.show('crash'); }
		if (game === 'flying' && performance.now() > autosaveAt) { autosaveAt = performance.now() + 30000; save(slotKey('auto'), snapshot()); }
		$('esc-hint').style.opacity = performance.now() < escHintUntil ? 1 : 0;
		const ease = 1 - Math.exp(-dt * 7);
		controls.roll += (input.roll - controls.roll) * ease;
		controls.pitch += (input.pitch - controls.pitch) * ease;
		controls.yaw += (input.roll * 0.4 - controls.yaw) * ease;
		// --- pogoda: wiatr (znoszenie, turbulencja, chmury), śnieg na ziemi, burza ---
		const W = seasonWeather(weatherById(env.weather), env.season); // zimą opady śniegu zamiast deszczu
		const windNow = windVector(effectiveWind(env.weather, env.wind).speed, t);
		wx.wind = windNow;
		clouds.windVelocity.set(1 + windNow.x * 1.2, 0.4 + windNow.z * 1.2);
		const live = game !== 'paused' && game !== 'loading';
		if (live && !flight.onGround && !flight.crashed) {
			if (game === 'flying') { flight.x += windNow.x * dt; flight.z += windNow.z * dt; }
			const tb = turbulence(t, windNow.speed, !!W.storm, flight.y - groundAt(flight.x, flight.z));
			const k = game === 'menu' ? 0.4 : 1;
			flight.bank += tb.roll * 0.45 * k * dt;
			flight.y += tb.lift * 3 * k * dt;
			flight.heading += tb.yaw * 0.06 * k * dt;
		}
		snowCover.value += (wx.snowTarget - snowCover.value) * (1 - Math.exp(-dt / 12));
		let flash = 0, bolt = 0;
		if (W.storm && live) {
			const ev = wx.storm.next(dt);
			if (ev) {
				const sx = camera.position.x + Math.sin(ev.bearing) * ev.distance, sz = camera.position.z - Math.cos(ev.bearing) * ev.distance;
				precip.strike(sx, sz, groundAt(sx, sz), groundAt(sx, sz) + clouds.u.base.value, camera.position);
				wx.strike = { ...ev, t: 0 };
				wx.thunder.push({ at: t + ev.delay, distance: ev.distance });
			}
		}
		if (wx.strike) {
			if (live) wx.strike.t += dt;
			flash = flashAt(wx.strike.t, wx.strike.flickers, wx.strike.distance);
			bolt = flashAt(wx.strike.t, wx.strike.flickers, 3500);
			if (wx.strike.t > 1.2) wx.strike = null;
		}
		while (wx.thunder.length && wx.thunder[0].at <= t) audio.event('thunder', wx.thunder.shift().distance);
		const exposureNow = renderer.toneMappingExposure;
		// błysk: jasność stała na ekranie niezależnie od ekspozycji (nocą nie oślepia bielą)
		post.flash.value = (flash * 0.45) / exposureNow;
		clouds.u.ambient.value = 0.5 + flash * 1.2;
		const daylight = Math.min(1, Math.max(0.03, sun.y * 3 + 0.2)) * (W.storm ? 0.55 : W.precip ? 0.8 : 1);
		const pr = W.precip;
		post.veil.value = pr ? pr.rate * (pr.type === 'snow' ? 0.4 : W.storm ? 0.45 : 0.3) : 0;
		post.veilColor.value.setRGB(0.42 * daylight, 0.44 * daylight, 0.48 * daylight);
		precip.update(game === 'paused' ? 0 : dt, camera, {
			type: pr?.type ?? null, rate: pr?.rate ?? 0, wind: windNow, flash, bolt,
			light: [0.5 * daylight, 0.53 * daylight, 0.58 * daylight].map((v) => v * (pr?.type === 'snow' ? 1.6 : 1)),
		});

		// ruch uliczny: gęstość z ustawień, godziny i pogody; wokół samolotu (w widoku swobodnym – wokół celu kamery)
		if (traffic) {
			const level = [0, 0.5, 1, 1.7][settings.traffic ?? 2];
			const on = level > 0;
			for (const o of traffic.view.objects) if (!on) o.visible = false;
			if (on) {
				traffic.sim.density = level * trafficByHour(state.hour) * (pr ? (pr.type === 'snow' ? 0.55 : 0.8) : 1);
				const c = mode === 'free' && game !== 'menu' ? view.target : plane.model.position;
				if (game !== 'paused' && game !== 'loading') traffic.sim.step(dt, { x: c.x, z: c.z });
				traffic.view.update(camera, cityLights ? cityLights.uniforms.street.value : 0);
			}
		}

		// pociągi: wokół samolotu (w widoku swobodnym – celu kamery); dźwięk – najbliższy wagon i sygnały przy odjeździe
		let trainNear = 0, trainSpeed = 0;
		if (trains) {
			const on = settings.trains !== false;
			for (const o of trains.view.objects) if (!on) o.visible = false;
			if (on) {
				const c = mode === 'free' && game !== 'menu' ? view.target : plane.model.position;
				if (game !== 'paused' && game !== 'loading') trains.sim.step(dt, { x: c.x, z: c.z });
				trains.view.update(camera);
				const cp = camera.position;
				let best = Infinity;
				for (const tr of trains.sim.trains) for (const car of tr.cars) {
					const d = Math.hypot(car.x - cp.x, car.y - cp.y, car.z - cp.z);
					if (d < best) { best = d; trainSpeed = tr.v; }
				}
				trainNear = best < 1500 ? Math.min(1, 120 / (best + 60)) : 0;
				for (const ev of trains.sim.events) {
					const h = ev.train.cars[0];
					const d = Math.hypot(h.x - cp.x, h.y - cp.y, h.z - cp.z);
					if (d < 3000) audio.event('horn', d);
				}
			}
		}
		// ptaki: gatunki z pory dnia, roku i pogody; płoszy je samolot, zderzenie – dźwięk i komunikat
		if (settings.birds !== false) {
			birds.sim.weights = speciesWeights({ sunY: sun.y, day: state.day, hour: state.hour, weather: W });
			birds.sim.density = 1;
			const pp = plane.model.position;
			const fwd = game === 'flying' || game === 'menu' ? { x: pp.x, y: pp.y, z: pp.z } : null;
			if (game !== 'paused' && game !== 'loading') birds.sim.step(dt, { x: pp.x, z: pp.z, hx: Math.sin(flight.heading), hz: -Math.cos(flight.heading) }, fwd);
			birds.view.update(camera);
			birdDots.update(camera);
			const cp = camera.position;
			for (const ev of birds.sim.events) {
				if (ev.type === 'strike' && game !== 'flying') continue;
				audio.bird(ev.type, ev.species, Math.hypot(ev.x - cp.x, ev.y - cp.y, ev.z - cp.z), mode === 'cockpit');
				if (ev.type === 'strike') {
					$('esc-hint').textContent = 'Zderzenie z ptakiem!';
					escHintUntil = performance.now() + 2200;
				}
			}
		} else { birds.view.objects.forEach((o) => (o.visible = false)); if (birdDots.sprite) birdDots.sprite.visible = false; }
		// piesi: gdy kamera nisko (poniżej ~350 m nad ziemią); gwar w pobliżu
		let crowd = 0;
		if (people) {
			const cp = camera.position;
			const agl = cp.y - groundAt(cp.x, cp.z);
			const low = settings.people === false ? 0 : Math.min(1, Math.max(0, (350 - agl) / 250));
			people.sim.density = peopleByHour(state.hour) * (pr ? (pr.type === 'snow' ? 0.4 : W.storm ? 0.15 : 0.6) : 1);
			if (low > 0 || people.sim.agents.length) {
				if (game !== 'paused' && game !== 'loading') people.sim.step(dt, { x: cp.x, z: cp.z }, low);
				people.view.update(camera, pr?.type === 'rain');
				for (const a of people.sim.agents) {
					const d2 = (a.x - cp.x) ** 2 + (a.y - cp.y) ** 2 + (a.z - cp.z) ** 2;
					if (d2 < 6400) crowd += 400 / (d2 + 400);
				}
				crowd = Math.min(1, crowd / 8);
			} else people.view.objects.forEach((o) => (o.visible = false));
		}
		// bliskość ruchu do dźwięku: pojazdy w promieniu ~400 m od kamery, ważone odległością
		const trafficNoise = () => {
			if (!traffic || !(settings.traffic > 0)) return 0;
			let s = 0;
			const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
			for (const a of traffic.sim.agents) {
				const d2 = (a.x - cx) ** 2 + (a.y - cy) ** 2 + (a.z - cz) ** 2;
				if (d2 < 160000) s += 2500 / (d2 + 2500);
			}
			return Math.min(1, s / 6);
		};
		const rpm = propRpm(flight, plane.spec.flight);
		if (audio.type !== plane.type) { audio.type = plane.type; audio.setAircraft(plane.type); }
		audio.update(dt, {
			rpm, throttle: flight.throttle, speed: flight.speed, onGround: flight.onGround, crashed: flight.crashed,
			stall: stallAmount(flight.speed, plane.spec.flight), P: plane.spec.flight, game,
			view: game === 'menu' ? 'menu' : mode === 'cockpit' ? 'cockpit' : mode === 'plane' ? 'chase' : 'free',
			distance: camera.position.distanceTo(plane.model.position),
			weather: { rain: pr?.type === 'rain' ? pr.rate : 0, snow: pr?.type === 'snow' ? pr.rate : 0, wind: windNow.speed },
			traffic: trafficNoise(),
			train: trainNear, trainSpeed, crowd,
		});
		const simDt = game === 'paused' || game === 'loading' ? 0 : dt;
		plane.update(flight, simDt, key, state.haze, rpm, controls, keyE, keyTint);
		if (game === 'menu') menuCamera(t);
		else if (mode === 'plane') chase.update(flight, dt);
		else if (mode === 'cockpit') cockpitCam.update(plane.model, flight, dt, t, rpm);
		else view.update(dt);
		const night = Math.min(1, Math.max(0, (0.06 - sun.y) / 0.16));
		cityLights?.update(state.hour, sun.y, Math.min(1, 2.4 / renderer.toneMappingExposure), camera);
		plane.updateAfterCamera(camera, flight, t, dt, { rpm, hour: state.hour, night, cockpit: game !== 'menu' && mode === 'cockpit', controls, viewportH: renderer.domElement.height, exposure: renderer.toneMappingExposure });
		// tilt-shift: ostry pas na samolocie (albo na środku kadru w widoku swobodnym)
		const ts = post.tiltShift.uniforms;
		if (game === 'menu' || mode === 'plane') {
			camera.updateMatrixWorld();
			const ndc = plane.model.position.clone().project(camera);
			ts.focus.value = 0.5 - ndc.y * 0.5;
			ts.strength.value = state.mini * (game === 'menu' ? 1.1 : Math.min(1.4, 0.5 + 200 / chase.distance));
		} else if (mode === 'cockpit') {
			ts.strength.value = 0;
		} else {
			ts.focus.value = 0.55;
			ts.strength.value = state.mini * 0.6;
		}
		atmo.update(sun, camera.position.y);
		renderer.toneMappingExposure = state.exposure * autoExposure(sun.y);
		terrain.update(camera, t);
		// otwarty świat: daleko od początku układu – początek pod samolot (czyste przesunięcie, bez wczytywania); nie w trakcie
		// skoku – początek jest już pod celem, a samolot do końca doczytywania został w starym miejscu (cofnięcie przesunięcia
		// postawiłoby go po skoku w złym miejscu)
		if (world && !jumping && Math.hypot(flight.x, flight.z) > REBASE_AT) {
			const dx = Math.round(flight.x / REBASE_STEP) * REBASE_STEP, dz = Math.round(flight.z / REBASE_STEP) * REBASE_STEP;
			shiftOrigin(dx, dz);
		}
		if (world && game === 'flying' && !jumping && performance.now() > worldCheckAt) worldCheck();
		if (world) {
			// doczytywanie wokół samolotu (w widoku swobodnym – wokół środka widoku)
			const f = mode === 'free' && game !== 'menu' ? view.target : flight;
			worldFocus.x = f.x; worldFocus.z = f.z;
			world.update(camera, worldFocus, t);
			world.updateNetwork(worldFocus.x, worldFocus.z, { traffic, trains, people });
		}
		clouds.update(game === 'paused' ? 0 : dt);
		forest.update(camera);
		roads?.update(camera);
		rails?.update(camera);
		rivers?.update(camera);
		bridges?.update(camera);
		details?.update(camera);
		buildings?.update(camera);
		// cienie wokół miejsca, na które patrzymy (samolot albo środek widoku swobodnego)
		sunDirNow = key;
		worldShadow.update(mode !== 'free' ? plane.model.position : view.target, key);
		post.render();

		// pasek kursu (co klatkę – płynnie); przy granicy mapy znacznik kursu powrotu; minimapa
		if (game === 'flying' && minimap && settings.minimap !== false) {
			minimap.draw(flight.x, flight.z, flight.heading);
			$('minimap-scale').textContent = `${SCALES[minimap.scale].km} km · ${minimap.rotate ? 'kurs' : 'N'}↑`;
		}
		if (game === 'flying') {
			const hdg = ((flight.heading * 180) / Math.PI + 360) % 360;
			const back = edgeWarning(flight.x, flight.z, region.size / 2);
			const tgt = target ? targetInfo(flight.x, flight.z, flight.heading, flight.speed, target.x, target.z).bearing : null;
			drawCompass(compassCtx, compassCanvas.width, compassCanvas.height, hdg, back ? back.deg : null, tgt);
			if (settings.labels3d) updateLabels3d(); else if (labelEls.length) { for (const el of labelEls) el.remove(); labelEls.length = 0; }
			$('compass-hdg').textContent = `${String(Math.round(hdg) % 360).padStart(3, '0')}°`;
		}
		frames++;
		fpsTime += dt;
		if (fpsTime > 0.5) {
			$('fps').textContent = `${Math.round(frames / fpsTime)} kl./s · słońce ${(p.elevation * 180 / Math.PI).toFixed(1)}°`;
			const agl = flight.y - 1.75 - groundAt(flight.x, flight.z);
			$('speed').textContent = Math.round(flight.speed * 3.6);
			$('alt').textContent = Math.round(flight.y);
			$('agl').textContent = Math.max(0, Math.round(agl));
			$('thr').textContent = Math.round(flight.throttle * 100);
			$('clock').textContent = `${hhmm(state.hour)} · ${dateText(state.day)}`;
			// panel położenia: miejsce, współrzędne, wiatr względem samolotu, granica mapy
			$('nav-where').textContent = flightTitle(flight);
			const ll = localToLonLat(flight.x, flight.z, center);
			$('nav-coords').textContent = `${formatLatLon(ll.lat, ll.lon)} · ${region.meta.name}`;
			const rw = relativeWind(wx.wind.x, wx.wind.z, flight.heading);
			$('wind-arrow').style.transform = `rotate(${rw.arrow}rad)`;
			$('wind-arrow').style.visibility = rw.speed ? 'visible' : 'hidden';
			$('wind-text').textContent = rw.speed ? `Wiatr ${rw.text} · z ${windFromText(wx.wind.x, wx.wind.z)}` : 'Wiatr: cisza';
			// cel lotu: odległość, czas dolotu, skręt; przy celu – komunikat raz
			$('nav-target').hidden = !target;
			if (target) {
				const ti = targetInfo(flight.x, flight.z, flight.heading, flight.speed, target.x, target.z);
				$('nav-target').textContent = `Cel: ${target.name ?? 'punkt'} · ${ti.text}`;
				if (ti.dist < 600 && !targetReached) {
					targetReached = true;
					$('esc-hint').textContent = `Cel osiągnięty${target.name ? `: ${target.name}` : ''} · Tab – nowy cel`;
					escHintUntil = performance.now() + 3000;
				}
			}
			const edge = edgeWarning(flight.x, flight.z, region.size / 2);
			$('nav-edge').hidden = !edge;
			if (edge) $('nav-edge').textContent = edge.text;
			$('clock-rate').textContent = rate === 0 ? '❚❚ stop' : `▶ ×${rate}`;
			$('clock').parentElement.classList.toggle('stopped', rate === 0);
			$('clock').parentElement.classList.toggle('fast', rate > 1);
			frames = 0;
			fpsTime = 0;
		}
	};

	// shadery obiektów sceny z góry, z postępem „X z Y” (jak w Maszyniście); resztę (efekty końcowe, cienie, chmury)
	// kompiluje pierwsza klatka – dopiero potem zdejmujemy ekran ładowania
	$('boot-bar').style.width = '85%';
	$('boot-stage').textContent = 'Kompilacja shaderów…';
	await new Promise((r) => setTimeout(r, 0));
	const tc = performance.now();
	const pc = await precompile((stage, done, total) => {
		$('boot-stage').textContent = stage === 'shaders' ? `Kompilacja shaderów… ${done} z ${total}` : `Kompilacja potoków karty graficznej… ${done} z ${total}`;
		$('boot-bar').style.width = `${85 + (stage === 'shaders' ? 0 : 6) + (done / total) * 6}%`;
	});
	const tf = performance.now();
	$('boot-stage').textContent = 'Kompilacja efektów obrazu…';
	await new Promise((r) => setTimeout(r, 0));
	frame();
	console.info(`Lot: shadery ${pc.shaders} obiektów, ${pc.pipes} potoków – ${Math.round(tf - tc)} ms, pierwsza klatka ${Math.round(performance.now() - tf)} ms`);
	$('boot-bar').style.width = '100%';
	$('boot-stage').textContent = 'Gotowy do startu';
	renderer.setAnimationLoop(frame);
	// „Kliknij lub naciśnij dowolny klawisz” – potem menu nad żywą sceną
	$('boot').classList.add('ready');
	await new Promise((r) => {
		const go = (e) => { if (e.type === 'keydown') e.preventDefault(); window.removeEventListener('keydown', go, true); window.removeEventListener('pointerdown', go, true); r(); };
		window.addEventListener('keydown', go, true);
		window.addEventListener('pointerdown', go, true);
	});
	$('boot').classList.add('done');
	setTimeout(() => ($('boot').hidden = true), 550);
	menu.show('home');
	// pomiar czasu klatki niezależny od odświeżania ekranu (np. w ukrytej karcie): await __lot.bench(30) → ms
	const bench = async (n = 30) => {
		const queue = renderer.backend.device.queue;
		post.render();
		await queue.onSubmittedWorkDone();
		const t0 = performance.now();
		for (let i = 0; i < n; i++) { post.render(); await queue.onSubmittedWorkDone(); }
		return (performance.now() - t0) / n;
	};
	/** Czas GPU na klatkę (ms) ze znaczników czasu – tylko z ?prof; mediana z n klatek (cienie świata + scena + obraz). */
	const gpuTime = async (n = 20) => {
		if (!PROF) return null;
		const out = [];
		for (let i = 0; i < n; i++) {
			if (sunDirNow) worldShadow.update(mode !== 'free' ? plane.model.position : view.target, sunDirNow);
			post.render();
			await renderer.backend.device.queue.onSubmittedWorkDone();
			await renderer.resolveTimestampsAsync('render');
			out.push(renderer.info.render.timestamp);
		}
		out.sort((a, b) => a - b);
		return out[n >> 1];
	};
	window.__lot = { gpuTime, jumpTo, get jumpState() { return { jumping, busy }; }, world, shiftOrigin: world ? shiftOrigin : null, birdDots, get minimap() { return minimap; }, people, birds, trains, traffic, audio, precip, renderer, camera, view, atmo, terrain, region, state, post, bench, clouds, frame, plane, chase, forest, roads, buildings, worldShadow, rails, rivers, bridges, details, cityLights, get moon() { return moon; }, cockpitCam, setMode, get mode() { return mode; }, menu, get game() { return game; }, get flight() { return flight; } };
}

start().catch((e) => {
	console.error(e);
	fail('Błąd uruchomienia', String(e?.message || e));
});
