// Start gry: sprawdzenie WebGPU, wczytanie regionu, atmosfera, teren, kamera i pętla klatek.
import { WebGPURenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, Vector3, Matrix3, Timer } from 'three/webgpu';
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
import { setTerrainUniforms, setCityLights, snowCover } from './gfx/ground.js';
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
import { weatherById, effectiveWind, windVector, windFrom, turbulence, lightning, flashAt } from './weather/weather.js';
import { stallAmount } from './audio/mix.js';
import { aircraftById } from './plane/aircraft.js';
import { sunPosition, sunDirection, dayOfYear } from './sun.js';
import { nightSky, moonIllumination } from './moon.js';
import { lonLatToLocal } from './geo.js';
import { transmittance, ATMOSPHERE } from './atmosphere/model.js';
import { GameMenu, VERSION } from './ui/menu.js';
import { loadingScreen, nextFrames } from './ui/loading.js';
import { DEFAULT_REGION, REGIONS } from './regions.js';
import { isGenerated, generate as generateRegion, cancel as cancelGenerate, deleteRegion, getRegionMeta } from './gen/client.js';
import { PLACES, TIMES, SEASONS, WEATHER, DEFAULT_PLAN, DEFAULT_SETTINGS, describePosition, headingDeg, load, loadRaw, save } from './ui/places.js';

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
const regionMeta = (id) => (isGenerated(id) ? getRegionMeta(id).catch(() => null) : fetch(`data/regions/${id}/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

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
	const renderer = new WebGPURenderer({ canvas, antialias: false, reversedDepthBuffer: true, powerPreference: 'high-performance' });
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
		region = await loadRegion(regionId, bootBar);
	} catch (e) {
		if (regionId === DEFAULT_REGION) throw e;
		console.warn('Region niedostępny, powrót do domyślnego:', e);
		regionChoice.set(DEFAULT_REGION);
		region = await loadRegion(DEFAULT_REGION, bootBar);
	}
	// region z kafli wektorowych (wbudowany albo wygenerowany w grze) – inne źródła danych niż Bory Tucholskie
	if (region.meta.generated) $('credits').textContent = 'Wysokości: AWS Terrain Tiles · Mapa: OpenFreeMap, © OpenMapTiles · Dane: © współtwórcy OpenStreetMap (ODbL)';
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
	const cityLights = region.osm ? createCityLights(region.osm, region) : null;
	setCityLights(cityLights);
	const terrain = createTerrain(region, atmo, clouds, plane, worldShadow);
	setTerrainUniforms(terrain.uniforms, region.heightTex, region.size);
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
	const forest = createForest(region, atmo, clouds, terrain, roads?.maskTex, worldShadow, plane);
	scene.add(...forest.shadowCasters);
	scene.add(...forest.objects);
	terrain.uniforms.treesFar.value = forest.uniforms.far.value;
	// opady i błyskawice: osobna scena dodawana po wygładzaniu (src/weather/precip.js)
	const precip = new Precipitation(atmo.u.pixelAngle);
	const post = createPost(renderer, scene, camera, atmo, clouds, precip);

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
	const placeById = (id) => places.find((p) => p.id === id) ?? places[0];
	const startAt = (placeId, agl = 420) => {
		const p = placeById(placeId);
		const x = p.x + 1300, z = p.z + 1250;
		return createFlight({ x, z, y: Math.max(groundAt(x, z), groundAt(p.x, p.z)) + agl, heading: Math.atan2(p.x - x, -(p.z - z)) });
	};
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
		if (e.code === 'Escape') {
			e.preventDefault();
			if (menu.open) menu.escape();
			else if (game === 'flying') pause();
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
	const env = { time: plan.time, season: plan.season, weather: plan.weather, wind: plan.wind ?? 'light' };
	// pogoda w locie: śnieg na ziemi narasta powoli (cel), burza – harmonogram błyskawic, bieżące uderzenie
	const wx = { snowTarget: 0, storm: lightning(), strike: null, thunder: [], wind: { x: 0, z: 0, speed: 0 } };
	const setEnvironment = (kind, id, instant = false) => {
		env[kind] = id;
		if (kind === 'time') state.hour = (TIMES.find((t) => t.id === id) ?? TIMES[1]).hour;
		if (kind === 'season') state.day = (SEASONS.find((t) => t.id === id) ?? SEASONS[1]).day;
		if (kind === 'weather') {
			const w = WEATHER.find((t) => t.id === id) ?? WEATHER[2];
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
	};
	const applySetting = (k, v) => {
		settings[k] = v;
		const b = document.body.classList;
		if (k === 'mini' || k === 'exposure' || k === 'relief') { state[k] = v; syncPanel(); }
		if (k === 'renderScale') resize();
		if (k === 'fps') b.toggle('no-fps', !v);
		if (k === 'hud') b.toggle('no-hud', !v);
		if (k === 'dev') b.toggle('dev', v);
		if (k === 'reducedMotion') b.toggle('reduced-motion', v);
		if (k === 'mouseSens') cockpitCam.sens = chase.sens = v;
		if (k === 'chaseReturn') chase.autoReturn = v;
		if (['sound', 'volume', 'engineVolume', 'ambientVolume', 'uiSounds'].includes(k)) audio.setSettings(settings);
		if (k === 'cockpitFov') { cockpitCam.fov = v; if (mode === 'cockpit') { camera.fov = v; camera.updateProjectionMatrix(); } }
	};
	const flightTitle = (f) => describePosition(f.x, f.z, places);
	const dateText = (d) => { const t = new Date(Date.UTC(YEAR, 0, d)); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
	const snapshot = () => ({ v: 1, saved: Date.now(), aircraft: plane.type, flight: { ...flight }, env: { ...env }, state: { hour: state.hour, day: state.day, cover: state.cover, haze: state.haze }, mode, landing: plane.lights.landing });
	const enterFlight = (view) => {
		game = 'flying';
		document.body.classList.add('flying');
		menu.hide();
		if (mode !== view) setMode(view === 'cockpit' || view === 'free' ? view : 'plane');
		$('esc-hint').textContent = 'Esc – pauza i menu';
		escHintUntil = performance.now() + 5000;
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
			flight = { ...s.flight, crashed: false, onGround: false };
			plane.lights.landing = s.landing ?? true;
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
				lights: plane.lights.landing ? 'REFLEKTORY WŁĄCZONE · L' : 'REFLEKTORY WYŁĄCZONE · L',
				aircraft: `${plane.spec.name} · ${plane.spec.reg}`,
			};
		},
	};
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
	const { center } = region.meta;

	const frame = () => {
		timer.update();
		const dt = Math.min(0.1, timer.getDelta());
		const t = timer.getElapsed();
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
		const W = weatherById(env.weather);
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

		const rpm = propRpm(flight, plane.spec.flight);
		if (audio.type !== plane.type) { audio.type = plane.type; audio.setAircraft(plane.type); }
		audio.update(dt, {
			rpm, throttle: flight.throttle, speed: flight.speed, onGround: flight.onGround, crashed: flight.crashed,
			stall: stallAmount(flight.speed, plane.spec.flight), P: plane.spec.flight, game,
			view: game === 'menu' ? 'menu' : mode === 'cockpit' ? 'cockpit' : mode === 'plane' ? 'chase' : 'free',
			distance: camera.position.distanceTo(plane.model.position),
			weather: { rain: pr?.type === 'rain' ? pr.rate : 0, snow: pr?.type === 'snow' ? pr.rate : 0, wind: windNow.speed },
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
		clouds.update(game === 'paused' ? 0 : dt);
		forest.update(camera);
		roads?.update(camera);
		rails?.update(camera);
		rivers?.update(camera);
		bridges?.update(camera);
		details?.update(camera);
		buildings?.update(camera);
		// cienie wokół miejsca, na które patrzymy (samolot albo środek widoku swobodnego)
		worldShadow.update(mode !== 'free' ? plane.model.position : view.target, key);
		post.render();

		frames++;
		fpsTime += dt;
		if (fpsTime > 0.5) {
			$('fps').textContent = `${Math.round(frames / fpsTime)} kl./s · słońce ${(p.elevation * 180 / Math.PI).toFixed(1)}°`;
			const agl = flight.y - 1.75 - groundAt(flight.x, flight.z);
			$('speed').textContent = Math.round(flight.speed * 3.6);
			$('alt').textContent = Math.round(flight.y);
			$('agl').textContent = Math.max(0, Math.round(agl));
			$('thr').textContent = Math.round(flight.throttle * 100);
			frames = 0;
			fpsTime = 0;
		}
	};

	// pierwsza klatka kompiluje shadery – dopiero potem zdejmujemy ekran ładowania
	$('boot-bar').style.width = '85%';
	$('boot-stage').textContent = 'Kompilacja shaderów…';
	await new Promise((r) => setTimeout(r, 0));
	const tc = performance.now();
	frame();
	console.info(`Lot: pierwsza klatka i shadery ${Math.round(performance.now() - tc)} ms`);
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
	window.__lot = { audio, precip, renderer, camera, view, atmo, terrain, region, state, post, bench, clouds, frame, plane, chase, forest, roads, buildings, worldShadow, rails, rivers, bridges, details, cityLights, get moon() { return moon; }, cockpitCam, setMode, get mode() { return mode; }, menu, get game() { return game; }, get flight() { return flight; } };
}

start().catch((e) => {
	console.error(e);
	fail('Błąd uruchomienia', String(e?.message || e));
});
