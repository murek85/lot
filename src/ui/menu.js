// Menu gry: ekrany składane z szablonów (jak w Pograniczu Galaktyki), nad żywą sceną 3D (jak w Maszyniście).
// Ekrany: home (dowództwo lotu), newflight (plan lotu: miejsce, pora roku i dnia, pogoda, widok), slots (zapis /
// odczyt), settings (zakładki), help, news, pause, pauseEnv (pogoda i pora w trakcie lotu), crash, regions (lista
// regionów: wbudowany i wygenerowane), generator (nowy region z kafli OpenStreetMap).
// Esc cofa o jeden poziom; w locie otwiera pauzę, na pauzie wznawia. Gra dostarcza obiekt `game` z akcjami.
import { TIMES, SEASONS, WEATHER, WINDS, TIME_SPEEDS } from './places.js';
import { listRegions, estimate, geocode, usage, PRESETS } from '../gen/client.js';
import { AIRCRAFT, aircraftById } from '../plane/aircraft.js';

export const VERSION = 'PROTOTYP 0.21'; // zgodnie z CHANGELOG.md i NEWS

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
<path fill="currentColor" d="M32 5c1.8 0 2.9 2 2.9 5.2V22l24.6 2.6v6.2L34.9 33v13.6l7.6 2.6v4.2L32 52.2l-10.5 1.2v-4.2l7.6-2.6V33L4.5 30.8v-6.2L29.1 22V10.2C29.1 7 30.2 5 32 5z"/>
<path fill="#8fd0ff" d="M30.2 13h3.6v4.2h-3.6z" opacity=".9"/></svg>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const EYEBROWS = {
	home: '',
	newflight: 'PLAN LOTU / ODPRAWA PRZED STARTEM',
	slots: 'DZIENNIK POKŁADOWY / PAMIĘĆ LOKALNA',
	settings: 'KONFIGURACJA MASZYNY I OBRAZU',
	help: 'INSTRUKCJA PILOTA',
	news: 'DZIENNIK ZMIAN',
	pause: 'LOT WSTRZYMANY · CZAS STOI',
	pauseEnv: 'METEO / ZMIANA WARUNKÓW W LOCIE',
	crash: 'ZDARZENIE LOTNICZE',
	regions: 'MAPY / REGIONY LOTÓW',
	generator: 'GENERATOR REGIONÓW / OPENSTREETMAP',
};

const SIZES = [
	{ id: '20000', name: '20 × 20 km', note: 'jedno miasto z okolicą' },
	{ id: '30000', name: '30 × 30 km', note: 'aglomeracja albo pasmo gór' },
	{ id: '46000', name: '46 × 46 km', note: 'jak Bory Tucholskie' },
	{ id: '60000', name: '60 × 60 km', note: 'największy – dłuższe wczytywanie' },
];
const TERRAINS = [
	{ id: 'standard', name: 'Standardowa', note: 'siatka 2048², ok. 25 m' },
	{ id: 'detailed', name: 'Szczegółowa', note: 'siatka 4096², ok. 12 m – góry' },
];
const BUILDINGS = [
	{ id: 'all', name: 'Wszystkie', note: 'pełna zabudowa z mapy' },
	{ id: 'large', name: 'Bez małych', note: 'bez szop i garaży – lżej' },
	{ id: 'none', name: 'Bez budynków', note: 'sam teren, drogi i woda' },
];
const LOAD = { low: ['płynnie', 'ok'], medium: ['umiarkowane', 'mid'], high: ['duże – może zwalniać', 'hi'] };
const num = (v) => Math.round(v).toLocaleString('pl');

// „Co nowego” – skrót pliku CHANGELOG.md (wersje 0.1–0.6 nadane wstecz kolejnym etapom prac)
export const NEWS = [
	{ v: '0.21', title: 'Ptaki z daleka', items: [
		['Stada', 'z wysokości – ruchome chmury migoczących kropek; z bliska – pełne modele w naturalnej wielkości.'],
		['Obraz', 'poprawne wektory ruchu ptaków – wygładzanie nie zostawia smug.'],
	] },
	{ v: '0.20', title: 'Ptaki z bliska', items: [
		['Modele', 'osobne sylwetki gatunków – bocian z szyją i nogami, myszołów i wrona z lotkami, mewa w „W”, szpak.'],
		['Lot', 'skrzydła zginane w barku i nadgarstku, szybowanie w „V”, rytm gatunku, przechył w zakrętach.'],
	] },
	{ v: '0.19', title: 'Duża mapa i cel lotu', items: [
		['Mapa', 'Tab albo menu pauzy: cały region, przesuwanie i powiększanie, nazwy miejscowości.'],
		['Cel lotu', 'kliknięcie na mapie – odległość, czas dolotu i skręt w panelu, znaczniki na pasku kursu i minimapie.'],
		['Opcja', 'nazwy miast nad krajobrazem.'],
	] },
	{ v: '0.18', title: 'Minimapa', items: [
		['Mapa', 'okrągła minimapa w rogu: lasy, pola, woda, zabudowa, rzeźba, drogi, tory i nazwy miejscowości.'],
		['Sterowanie', 'N – skala 2 / 5 / 15 km, Shift+N – kurs albo północ u góry; wyłączenie w ustawieniach.'],
	] },
	{ v: '0.17', title: 'Nawigacja w locie', items: [
		['Kurs', 'pasek kompasu u góry ekranu.'],
		['Położenie', 'miejscowość z dzielnicą albo odległość i kierunek od miasta, współrzędne, wiatr względem samolotu.'],
		['Granica mapy', 'ostrzeżenie poniżej 3 km z kursem powrotu; setki nazw miejscowości w każdym regionie.'],
	] },
	{ v: '0.16', title: 'Upływ czasu', items: [
		['Zegar', 'czas w locie płynie – zatrzymany, rzeczywisty, ×10 albo ×60; przez północ do następnego dnia.'],
		['Sterowanie', 'T – stop / start, Shift+T – przyspieszenie; wybór także w planie lotu i na pauzie; zegar w panelu lotu.'],
	] },
	{ v: '0.15', title: 'Piesi', items: [
		['Ludzie', 'na chodnikach, deptakach i peronach – widoczni z niska; krok, różne ubrania, w deszczu parasole.'],
		['Rytm dnia', 'więcej w południe i po południu, nocą i w burzy prawie nikt; gwar w dźwięku; przełącznik „Piesi”.'],
	] },
	{ v: '0.14', title: 'Ptaki', items: [
		['Gatunki', 'stada szpaków, bociany, myszołowy w kominach termicznych, mewy nad wodą, wrony nad miastami – zależnie od miejsca, pory i pogody.'],
		['Zachowanie', 'stado ucieka przed samolotem; zderzenie z ptakiem.'],
		['Dźwięk', 'świergot, klekot, krzyk mew, krakanie i trzepot; przełącznik „Ptaki”.'],
	] },
	{ v: '0.13', title: 'Kolej', items: [
		['Pociągi', 'regionalne, Intercity, towarowe z węglarkami i wąskotorowe – postoje na stacjach, zmiana kierunku na końcu toru.'],
		['Wygląd', 'wagony wyginają się na łukach; nocą oświetlone okna, reflektory i światła końca składu.'],
		['Dźwięk', 'dudnienie, stukot wózków i sygnał przy odjeździe; przełącznik „Ruch kolejowy”.'],
	] },
	{ v: '0.12', title: 'Ruch uliczny', items: [
		['Pojazdy', 'samochody, ciężarówki i autobusy na drogach – prędkość i gęstość z klasy drogi, pory dnia i pogody.'],
		['Noc', 'reflektory i czerwone światła tylne – strumienie świateł na głównych drogach.'],
		['Ustawienia', 'suwak „Ruch uliczny” (wyłączony … duży); szum ruchu w dźwięku.'],
	] },
	{ v: '0.11', title: 'Kominy i chłodnie', items: [
		['Budowle', 'kominy, chłodnie kominowe i zbiorniki rozpoznawane z kształtu – bez okien, nocą nie świecą jak bloki.'],
		['Wygląd', 'chłodnie jak hiperboloidy, wysokie kominy w biało-czerwone pasy, nocą czerwone światła przeszkodowe.'],
	] },
	{ v: '0.10', title: 'Pogoda', items: [
		['Opady', 'deszcz, śnieg i burza – krople i płatki wokół samolotu, zasłona opadu, niska warstwa chmur.'],
		['Śnieg', 'pola i korony drzew stopniowo bieleją.'],
		['Burza', 'błyskawice, rozświetlone niebo i chmury, grzmot opóźniony o odległość.'],
		['Wiatr', 'od ciszy po wichurę: znoszenie, porywy, turbulencja; wiatr w raporcie lotu.'],
	] },
	{ v: '0.9', title: 'Dźwięk', items: [
		['Silnik', 'syntezowany warkot zależny od obrotów i maszyny – gwiazdowy Dromadera i Wilgi, bokser Extry; świst śmigła.'],
		['Lot', 'wiatr rosnący z prędkością, brzęczyk przeciągnięcia, przyziemienie z piskiem opon, kraksa.'],
		['Widok', 'inne brzmienie w kabinie i z zewnątrz, cichy silnik w menu, przytłumienie na pauzie.'],
		['Ustawienia', 'zakładka Dźwięk z głośnościami i dźwiękami menu; klawisz M – wyciszenie.'],
	] },
	{ v: '0.8', title: 'Generator regionów, Zabrze i Beskid Śląski', items: [
		['Nowe regiony', 'Zabrze z Gliwicami i Katowicami (teraz na start) oraz Beskid Śląski ze Szczyrkiem i Wisłą – po 46 × 46 km.'],
		['Generator', 'nowy region w grze: miejscowość z wyszukiwarki albo propozycja (Katowice, Beskid Śląski, Jura…), 20–60 km, rzeźba standardowa lub szczegółowa.'],
		['Dane', 'kafle wektorowe OpenStreetMap (OpenFreeMap, z14) – drogi, budynki, tory, woda i pokrycie terenu; rzeźba z AWS Terrain Tiles.'],
		['Pamięć', 'kafle i gotowe regiony w przeglądarce (IndexedDB) – latanie bez sieci, szybsze generowanie w tej samej okolicy.'],
		['Regiony', 'lista regionów z przełączaniem i usuwaniem, szacunek wielkości i obciążenia przed generowaniem, osobne zapisy lotów.'],
	] },
	{ v: '0.7', title: 'Menu, samoloty do wyboru, wczytywanie', items: [
		['Menu', 'ekran startowy i menu nad żywą sceną, plan lotu z miejscem, porą dnia i roku, pogodą i widokiem.'],
		['Pauza i zapisy', 'raport lotu, zmiana pogody w locie, 5 slotów i autozapis, „Kontynuuj lot”, okno kraksy.'],
		['Samoloty', 'PZL-104 Wilga 35 (górnopłat STOL) i Extra 330LX (beczki, lot na plecach) – własne kabiny i model lotu.'],
		['Wczytywanie', 'ekrany jak w Maszyniście: przelot nad polami, plan lotu, etapy i wskazówki.'],
		['Ustawienia', 'zakładki Obraz, Sterowanie, Interfejs; wspólny pasek przewijania; poprawka drżenia skrzydeł w menu.'],
	] },
	{ v: '0.6', title: 'Samolot z bliska, kabina, noc', items: [
		['Dromader', 'nowy model: przeszklona kabina, silnik gwiazdowy, ruchome stery, znaki SP-DRB.'],
		['Światła', 'pozycyjne, stroboskopy, błyskacz, reflektory oświetlające teren i osady.'],
		['Kabina', 'działające przyrządy, lampki i listwa LED, drążek i przepustnica; widok pilota.'],
		['Noc', 'księżyc z fazą z efemerydy, gwiazdy i Droga Mleczna, latarnie i okna w osadach.'],
	] },
	{ v: '0.5', title: 'Świat z OpenStreetMap', items: [
		['Osady', 'drogi i dukty, budynki z dachami i oknami, kościoły; mapa cieni świata.'],
		['Kolej i woda', 'tory, stacje, perony, mosty; rzeki z wyciętym lasem wzdłuż koryt.'],
		['Detale', 'aleje przydrożne, linie energetyczne ze słupami i przewodami.'],
	] },
	{ v: '0.4', title: 'Woda i las', items: [
		['Jeziora', 'fale, odbicia nieba i brzegu, odblask słońca, głębia i piana.'],
		['Las', 'pojedyncze drzewa 3D – sosny, młodniki i liściaste.'],
	] },
	{ v: '0.3', title: 'Samolot', items: [
		['Lot', 'Dromader, zręcznościowy model lotu, przeciągnięcie, przyziemienie i kraksa.'],
		['Obraz', 'kamera pościgowa, cień samolotu, wygładzanie TAA, efekt miniatury.'],
	] },
	{ v: '0.2', title: 'Chmury', items: [['Chmury', 'wolumetryczne, z cieniem na ziemi i zmienną pokrywą.']] },
	{ v: '0.1', title: 'Teren i atmosfera', items: [
		['Region', 'Bory Tucholskie 46 × 46 km z rzeczywistej rzeźby i pokrycia terenu.'],
		['Atmosfera', 'fizyczne niebo, słońce i perspektywa powietrzna, pora dnia.'],
	] },
];

const KEYS = [
	['A / D  ← / →', 'przechył i skręt (puszczone – samolot sam się poziomuje); w Extrze – beczki bez ograniczeń'],
	['W / S  ↑ / ↓', 'wznoszenie i opadanie (odwrócenie w ustawieniach)'],
	['E, Shift / Q', 'więcej / mniej gazu'],
	['C', 'kamera: za samolotem → kabina → swobodna'],
	['V', 'kabina i z powrotem'],
	['L', 'reflektory do lądowania'],
	['N / Shift+N', 'minimapa: skala 2 → 5 → 15 km / północ albo kurs u góry'],
	['Tab', 'duża mapa: kliknięcie – cel lotu, prawy przycisk – bez celu'],
	['T / Shift+T', 'czas: zatrzymaj i wznów / przyspieszenie ×1 → ×10 → ×60'],
	['Kółko', 'odległość kamery; w kabinie – pole widzenia'],
	['Przeciąganie myszą', 'obrót kamery wokół samolotu; w kabinie – rozglądanie się'],
	['Dwuklik / X', 'kamera z powrotem za ogon; w kabinie – na wprost'],
	['Esc', 'pauza i wznowienie, w menu – wstecz'],
	['R', 'start od nowa z tego samego miejsca'],
	['M', 'dźwięk – włącz / wycisz'],
	['H', 'panel deweloperski (gdy włączony w ustawieniach)'],
];

export class GameMenu {
	constructor(root, game) {
		this.root = root;
		this.game = game;
		this.screen = null;
		this.from = {}; // skąd otwarto ekran (powrót klawiszem Esc i przyciskiem „Wróć”)
		this.settingsTab = 0;
		this.slotMode = 'load';
		this.plan = { ...game.plan };
		root.addEventListener('click', (e) => this.onClick(e));
		// dźwięk wskazania: przy wejściu kursora na inny przycisk
		root.addEventListener('pointerover', (e) => {
			const b = e.target.closest('button');
			if (b && b !== this.hovered && !b.disabled) this.game.uiSound?.('hover');
			this.hovered = b;
		});
		root.addEventListener('input', (e) => this.onInput(e));
		root.addEventListener('keydown', (e) => { if (e.code === 'Enter' && e.target.dataset?.gen === 'query') { e.preventDefault(); this.search(); } });
		this.gen = { name: PRESETS[0].name, lon: PRESETS[0].lon, lat: PRESETS[0].lat, size: '46000', terrain: 'standard', buildings: 'all', query: '' };
		this.genResults = null;
		this.est = null;
	}

	get open() { return !this.root.hidden; }

	show(screen, from) {
		if (from !== undefined) this.from[screen] = from;
		this.screen = screen;
		this.root.hidden = false;
		const inGame = ['pause', 'pauseEnv'].includes(screen) || (this.from[screen] && this.from[screen] !== 'home');
		document.body.classList.toggle('paused', this.game.inFlight());
		const content = this[`render_${screen}`]();
		const card = this[`card_${screen}`]?.() ?? '';
		this.root.innerHTML = `<div class="menu-hud"></div>
			<header class="menu-brand">${LOGO}<div><b>LOT</b> · NAD POLSKĄ<small>${esc(this.game.regionName.toUpperCase())} · ZAPIS LOKALNY</small></div></header>
			<div class="menu-layout">${content}${card}</div>
			<footer class="menu-footer"><span>${VERSION}</span><span>${inGame ? 'ESC – WSTECZ' : 'ENTER – START · ESC – WSTECZ'}</span><span class="grow"></span>
			<button data-go="news">Co nowego</button><button data-go="help">Sterowanie</button></footer>`;
		this.root.querySelectorAll('input[type=range]').forEach((r) => this.fill(r));
		// cieniowanie krawędzi przewijanej zawartości: tylko tam, gdzie jest coś ukrytego
		this.root.querySelectorAll('.menu-scroll').forEach((el) => {
			const edges = () => {
				el.classList.toggle('scrolled-top', el.scrollTop > 2);
				el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
			};
			el.addEventListener('scroll', edges, { passive: true });
			edges();
		});
		// fokus: na pierwszy przycisk ekranu (klawiatura od razu działa), bez przewijania
		const first = this.root.querySelector('.menu-content .menu-action, .menu-content button');
		first?.focus({ preventScroll: true });
		if (screen === 'regions') this.fillRegions();
		if (screen === 'generator') this.requestEstimate();
	}

	hide() {
		this.root.hidden = true;
		this.screen = null;
		document.body.classList.remove('paused');
	}

	// ---------- ekrany ----------

	head(title, lead = '', screen = this.screen) {
		const brow = screen === 'home' ? `${aircraftById(this.plan.aircraft).reg} · ${aircraftById(this.plan.aircraft).name.toUpperCase()} · GOTOWY` : EYEBROWS[screen] ?? '';
		return `<div class="eyebrow">${brow}</div><h1 tabindex="-1">${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}`;
	}

	btn(id, label, { prominent = false, hint = '↗', subtle = false, disabled = false } = {}) {
		return `<button class="menu-action${prominent ? ' prominent' : ''}${subtle ? ' subtle' : ''}" data-act="${id}"${disabled ? ' disabled' : ''}><span>${label}</span><span aria-hidden="true">${hint}</span></button>`;
	}

	render_home() {
		const cont = this.game.slotInfo('auto');
		const r = this.game.region;
		const lead = r?.places ? `${esc(r.name)} z wysokości kilkuset metrów: ${Math.round(r.size / 1000)} × ${Math.round(r.size / 1000)} km rzeźby terenu, dróg i zabudowy z OpenStreetMap.`
			: 'Bory Tucholskie z wysokości kilkuset metrów: jeziora rynnowe, Brda, lasy i miasteczka z prawdziwej mapy.';
		return `<section class="menu-content">${this.head('Gotowy do startu.', lead)}
			<div class="menu-actions">
				${cont ? this.btn('continue', `Kontynuuj lot <small style="opacity:.7;font-weight:400">· ${esc(cont.title)}</small>`, { prominent: true }) : ''}
				${this.btn('quick', 'Szybki start', { prominent: !cont, hint: '<kbd>ENTER</kbd>' })}
				${this.btn('new', 'Nowy lot — plan lotu')}
				${this.btn('load', 'Wczytaj lot — sloty')}
				${this.btn('regions', 'Regiony i generator map')}
				${this.btn('settings', 'Ustawienia')}
				${this.btn('help', 'Sterowanie i pomoc')}
				${globalThis.desktop?.quit ? this.btn('quit', 'Wyjdź z gry', { subtle: true }) : ''}
			</div></section>`;
	}

	card_home() {
		const p = this.planInfo(this.plan);
		return `<aside class="menu-card"><div class="eyebrow">PLAN LOTU</div><h2>${esc(p.place.name)}</h2>
			<dl><dt>Pora</dt><dd>${esc(p.time.name)} · ${esc(p.season.note)}</dd><dt>Pogoda</dt><dd>${esc(p.weather.name)} · wiatr ${esc(p.wind.name.toLowerCase())}</dd>
			<dt>Maszyna</dt><dd>${esc(aircraftById(this.plan.aircraft).name)} · ${aircraftById(this.plan.aircraft).reg}</dd><dt>Widok</dt><dd>${this.plan.view === 'cockpit' ? 'kabina' : 'za samolotem'}</dd></dl>
			<span class="tag">${this.game.slotInfo('auto') ? 'ZAPIS GOTOWY DO WZNOWIENIA' : 'OCZEKIWANIE NA ZGODĘ NA START'}</span></aside>`;
	}

	render_newflight() {
		const tiles = (list, key, wide = false) => `<div class="tiles${wide ? ' wide' : ''}">${list.map((o, i) =>
			`<button class="tile${this.plan[key] === o.id ? ' sel' : ''}" data-pick="${key}:${o.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(o.name)}</b><small>${esc(o.note)}</small></button>`).join('')}</div>`;
		return `<section class="menu-content menu-window">${this.head('Plan lotu.', '')}
			<div class="menu-scroll">
				<h2>Samolot</h2>${tiles(Object.values(AIRCRAFT).map((a) => ({ id: a.id, name: a.name, note: `${a.note} · ${a.specs}` })), 'aircraft', true)}
				<h2>Miejsce startu · ${esc(this.game.regionName)}</h2>${tiles(this.game.places, 'place', true)}
				<h2>Pora dnia</h2>${tiles(TIMES, 'time')}
				<h2>Upływ czasu</h2>${tiles(TIME_SPEEDS, 'timeSpeed')}
				<h2>Pora roku</h2>${tiles(SEASONS, 'season')}
				<h2>Pogoda</h2>${tiles(WEATHER, 'weather')}
				<h2>Wiatr</h2>${tiles(WINDS, 'wind')}
				<h2>Widok na starcie</h2>${tiles([{ id: 'plane', name: 'Za samolotem', note: 'kamera pościgowa' }, { id: 'cockpit', name: 'Kabina', note: 'przyrządy i widok pilota' }], 'view')}
			</div>
			<div class="menu-window-actions">${this.btn('start', 'Startuj', { prominent: true, hint: '<kbd>ENTER</kbd>' })}${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}</div></section>`;
	}

	render_slots() {
		const saving = this.slotMode === 'save';
		const row = (id, label) => {
			const s = this.game.slotInfo(id);
			const disabled = !saving && !s;
			return `<button class="menu-action slot${s ? '' : ' empty'}" data-slot="${id}"${disabled || (saving && id === 'auto') ? ' disabled' : ''}>
				<span class="slot-no">${label}</span><span><b>${s ? esc(s.title) : 'pusty slot'}</b><span class="meta">${s ? esc(s.meta) : saving ? 'zapisz tutaj bieżący lot' : '—'}</span></span>
				<span aria-hidden="true">${saving ? 'ZAPISZ' : 'WCZYTAJ'}</span></button>`;
		};
		return `<section class="menu-content menu-window">${this.head(saving ? 'Zapisz lot.' : 'Wczytaj lot.', '')}
			<div class="menu-scroll"><div class="slots">${row('auto', '<small>AUTO</small>A')}${[1, 2, 3, 4, 5].map((n) => row(n, `<small>SLOT</small>${n}`)).join('')}</div></div>
			<div class="menu-window-actions">${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}<span class="spacer"></span>
			<small style="color:var(--m-muted)">${saving ? 'Autozapis powstaje przy wyjściu do menu.' : 'Zapis obejmuje położenie, porę i pogodę.'}</small></div></section>`;
	}

	render_settings() {
		const s = this.game.settings;
		const tabs = [['Obraz', 'obraz'], ['Sterowanie', 'ster'], ['Interfejs', 'ui'], ['Dźwięk', 'dzwiek']];
		const range = (key, label, min, max, step, fmt, note = '') => `<label class="setting"><span>${label}<output>${fmt(s[key])}</output></span>
			<input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-fmt="${key}">${note ? `<small>${note}</small>` : ''}</label>`;
		const check = (key, label, note = '') => `<label class="setting check"${note ? ` title="${esc(note)}"` : ''}><input type="checkbox" data-set="${key}"${s[key] ? ' checked' : ''}><span>${label}</span>${note ? `<small>${note}</small>` : ''}</label>`;
		const panels = [
			range('mini', 'Efekt miniatury', 0, 2, 0.05, FMT.mini, 'rozmycie góry i dołu kadru – krajobraz jak makieta') +
			range('exposure', 'Ekspozycja', 0.4, 2.5, 0.01, FMT.exposure, 'mnożnik automatycznej ekspozycji') +
			range('renderScale', 'Rozdzielczość obrazu', 0.5, 1, 0.05, FMT.renderScale, 'mniej – płynniej na słabszych kartach') +
			range('relief', 'Przewyższenie rzeźby', 1, 4, 0.1, FMT.relief, 'pagórki morenowe wyraźniejsze z góry') +
			range('traffic', 'Ruch uliczny', 0, 3, 1, FMT.traffic, 'samochody, ciężarówki i autobusy na drogach; nocą światła – więcej to więcej pracy procesora') +
			check('trains', 'Ruch kolejowy', 'pociągi osobowe, Intercity, towarowe i wąskotorowe, postoje na stacjach') +
			check('birds', 'Ptaki', 'stada szpaków, bociany, myszołowy, mewy i wrony – zależnie od miejsca, pory i pogody') +
			check('people', 'Piesi', 'ludzie na chodnikach, deptakach i peronach – widoczni z niska (poniżej ~350 m)'),
			check('invertPitch', 'Odwróć oś wznoszenia', 'W / ↑ – nos w dół, jak drążkiem') +
			range('mouseSens', 'Czułość myszy', 0.4, 2, 0.05, FMT.mouseSens, 'obrót kamery za samolotem i rozglądanie się w kabinie') +
			check('chaseReturn', 'Kamera wraca za ogon', 'po puszczeniu myszy kamera za samolotem łagodnie wraca do domyślnego ujęcia') +
			range('cockpitFov', 'Pole widzenia w kabinie', 45, 90, 1, FMT.cockpitFov),
			check('hud', 'Panel lotu', 'prędkość, wysokość, gaz, kurs i położenie') +
			check('minimap', 'Minimapa', 'mapa okolicy w rogu ekranu; N – skala, Shift+N – obrót') +
			check('labels3d', 'Nazwy miast w krajobrazie', 'podpisy miast i miasteczek 0,8–15 km przed samolotem') +
			check('fps', 'Licznik klatek') +
			check('reducedMotion', 'Ogranicz animacje menu') +
			check('dev', 'Panel deweloperski', 'suwaki godziny, daty, chmur i powietrza; klawisz H'),
			check('sound', 'Dźwięk', 'klawisz M – szybkie wyciszenie') +
			range('volume', 'Głośność', 0, 1, 0.01, FMT.volume) +
			range('engineVolume', 'Silnik i śmigło', 0, 1.5, 0.01, FMT.volume, 'warkot silnika, świst śmigła, brzęczyk przeciągnięcia') +
			range('ambientVolume', 'Wiatr i otoczenie', 0, 1.5, 0.01, FMT.volume, 'opływ powietrza, toczenie po ziemi, przyziemienie i kraksa') +
			check('uiSounds', 'Dźwięki menu', 'kliknięcia i wskazania przycisków'),
		];
		return `<section class="menu-content menu-window">${this.head('Ustawienia.', '')}
			<div class="menu-tabs" role="tablist">${tabs.map(([t], i) => `<button role="tab" data-tab="${i}" aria-selected="${i === this.settingsTab}"><small>0${i + 1}</small>${t}</button>`).join('')}</div>
			<div class="menu-scroll"><div class="tab-panel" role="tabpanel">${panels[this.settingsTab]}</div></div>
			<div class="menu-window-actions">${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}<span class="spacer"></span><small style="color:var(--m-muted)">Zmiany działają od razu i są zapamiętywane.</small></div></section>`;
	}

	render_regions() {
		return `<section class="menu-content menu-window">${this.head('Regiony.', 'Regiony wbudowane w grę i wygenerowane w generatorze – zapisane w przeglądarce, działają bez sieci.')}
			<div class="menu-scroll"><div class="slots" id="region-list"><p class="lead">Odczyt pamięci przeglądarki…</p></div></div>
			<div class="menu-window-actions">${this.btn('generator', 'Nowy region — generator', { prominent: true })}${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}
			<span class="spacer"></span><small style="color:var(--m-muted)" id="region-usage"></small></div></section>`;
	}

	async fillRegions() {
		const el = this.root.querySelector('#region-list');
		let list = [];
		try { list = await listRegions(); } catch (e) { console.warn(e); }
		// wbudowane: opis z meta.json (liczba budynków, źródła)
		const builtin = await Promise.all(this.game.builtinRegions.map((r) => fetch(`data/regions/${r.id}/meta.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null)
			.then((m) => ({ r, m }))));
		if (this.screen !== 'regions' || !el.isConnected) return;
		const cur = this.game.region?.id;
		list.sort((a, b) => (b.baked > a.baked ? 1 : -1));
		const row = (id, name, meta, del) => `<div class="region-row"><button class="menu-action slot${id === cur ? ' current' : ''}" data-region="${esc(id)}"${id === cur ? ' disabled' : ''}>
				<span class="slot-no"><small>${id === cur ? 'TERAZ' : del ? 'GEN' : 'WBUD'}</small>${id === cur ? '●' : '◇'}</span><span><b>${esc(name)}</b><span class="meta">${esc(meta)}</span></span>
				<span aria-hidden="true">${id === cur ? 'WCZYTANY' : 'LEĆ TUTAJ'}</span></button>${del ? `<button class="region-del" data-del="${esc(id)}" title="Usuń region z pamięci przeglądarki" aria-label="Usuń ${esc(name)}">✕</button>` : ''}</div>`;
		const date = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
		const km = (m) => `${Math.round(m.size / 1000)} × ${Math.round(m.size / 1000)} km`;
		el.innerHTML = builtin.map(({ r, m }) => row(r.id, r.name, `${km(r)}${m?.osm ? ` · ${num(m.osm.counts.buildings)} budynków` : ''} · ${r.gen ? 'kafle OpenStreetMap' : 'ESA WorldCover i OpenStreetMap'} · wbudowany`, false)).join('') +
			list.map((m) => row(m.id, m.name, `${Math.round(m.size / 1000)} × ${Math.round(m.size / 1000)} km · ${num(m.osm.counts.buildings)} budynków · ${(m.bytes / 1e6).toFixed(0)} MB · ${date(m.baked)}`, true)).join('') +
			(list.length ? '' : '<p class="lead" style="margin-top:14px">Nie ma jeszcze wygenerowanych regionów – zacznij od generatora, np. Katowice albo Beskid Śląski.</p>');
		const u = await usage();
		const ue = this.root.querySelector('#region-usage');
		if (u && ue) ue.textContent = `Pamięć przeglądarki: ${(u.used / 1e6).toFixed(0)} MB${u.quota ? ` z ${(u.quota / 1e9).toFixed(0)} GB` : ''}`;
	}

	render_generator() {
		const g = this.gen;
		const tiles = (list, key) => `<div class="tiles">${list.map((o, i) =>
			`<button class="tile${g[key] === o.id ? ' sel' : ''}" data-genopt="${key}:${o.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(o.name)}</b><small>${esc(o.note)}</small></button>`).join('')}</div>`;
		return `<section class="menu-content menu-window">${this.head('Generator regionów.', '')}
			<div class="menu-scroll">
				<h2>Środek regionu</h2>
				<div class="gen-search"><input type="search" class="menu-input" data-gen="query" value="${esc(g.query)}" placeholder="Szukaj miejscowości, np. Szczyrk, Rybnik, Ustroń…" autocomplete="off" spellcheck="false">
				${this.btn('geo', 'Szukaj', { hint: '⌕' })}</div>
				<div class="tiles wide" id="gen-results">${this.resultTiles()}</div>
				<h2>Nazwa</h2><input type="text" class="menu-input" data-gen="name" value="${esc(g.name)}" maxlength="40">
				<h2>Wielkość</h2>${tiles(SIZES, 'size')}
				<h2>Rzeźba terenu</h2>${tiles(TERRAINS, 'terrain')}
				<h2>Budynki</h2>${tiles(BUILDINGS, 'buildings')}
				<p class="gen-note">Dane: kafle wektorowe OpenFreeMap (© OpenMapTiles, © współtwórcy OpenStreetMap) i rzeźba AWS Terrain Tiles. Pobrane kafle zostają w pamięci przeglądarki – drugi region w tej samej okolicy powstaje szybciej.</p>
			</div>
			<div class="menu-window-actions">${this.btn('generate', 'Generuj region', { prominent: true })}${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}</div></section>`;
	}

	resultTiles() {
		const g = this.gen;
		const list = this.genResults ?? PRESETS.map((p) => ({ ...p, label: `${p.lat.toFixed(2)}° N, ${p.lon.toFixed(2)}° E` }));
		if (!list.length) return '<p class="gen-note">Nic nie znaleziono – spróbuj innej nazwy.</p>';
		return list.map((p, i) => `<button class="tile${Math.abs(p.lon - g.lon) < 1e-6 && Math.abs(p.lat - g.lat) < 1e-6 ? ' sel' : ''}" data-genplace="${i}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(p.name)}</b><small>${esc(p.label)}</small></button>`).join('');
	}

	card_generator() {
		return `<aside class="menu-card" id="gen-card">${this.estimateCard()}</aside>`;
	}

	estimateCard() {
		const g = this.gen, e = this.est;
		const km = Math.round(+g.size / 1000);
		const head = `<div class="eyebrow">SZACUNEK</div><h2>${esc(g.name || 'Region')}</h2>
			<dl><dt>Środek</dt><dd>${g.lat.toFixed(3)}° N · ${g.lon.toFixed(3)}° E</dd><dt>Obszar</dt><dd>${km} × ${km} km</dd>`;
		if (this.estError) return `${head}</dl><span class="tag hi">${esc(this.estError)}</span>`;
		if (!e) return `${head}<dt>Kafle</dt><dd>liczenie…</dd></dl><span class="tag">PRÓBKOWANIE MAPY</span>`;
		const [loadName, cls] = LOAD[e.load];
		return `${head}<dt>Kafle</dt><dd>${num(e.mapTiles)} mapy · ${num(e.heightTiles)} rzeźby</dd>
			<dt>Pobranie</dt><dd>ok. ${e.downloadMB < 10 ? e.downloadMB.toFixed(1) : num(e.downloadMB)} MB</dd>
			<dt>Budynki</dt><dd>ok. ${num(e.buildings)}</dd><dt>Drogi</dt><dd>ok. ${num(e.roads)} odcinków</dd>
			<dt>Obciążenie</dt><dd>${loadName}</dd></dl><span class="tag ${cls}">${e.load === 'high' ? 'ROZWAŻ MNIEJSZY OBSZAR LUB „BEZ MAŁYCH”' : 'GOTOWY DO GENEROWANIA'}</span>`;
	}

	/** Szacunek po zmianie parametrów (z opóźnieniem – kliknięcia po kolei nie pobierają próbek wielokrotnie). */
	requestEstimate() {
		this.est = null;
		this.estError = null;
		const card = () => this.root.querySelector('#gen-card');
		if (card()) card().innerHTML = this.estimateCard();
		clearTimeout(this.estTimer);
		const g = this.gen, key = `${g.lon},${g.lat},${g.size},${g.buildings},${g.terrain}`;
		this.estTimer = setTimeout(async () => {
			try {
				const e = await estimate({ center: { lon: g.lon, lat: g.lat }, size: +g.size, buildings: g.buildings, terrain: g.terrain });
				if (key !== `${this.gen.lon},${this.gen.lat},${this.gen.size},${this.gen.buildings},${this.gen.terrain}`) return;
				this.est = e;
			} catch (err) {
				this.estError = navigator.onLine === false ? 'BRAK POŁĄCZENIA Z SIECIĄ' : `BŁĄD: ${err.message}`;
			}
			if (this.screen === 'generator' && card()) card().innerHTML = this.estimateCard();
		}, 450);
	}

	async search() {
		const q = this.gen.query.trim();
		const box = this.root.querySelector('#gen-results');
		if (!q) { this.genResults = null; if (box) box.innerHTML = this.resultTiles(); return; }
		if (box) box.innerHTML = '<p class="gen-note">Szukanie…</p>';
		try { this.genResults = await geocode(q); } catch (e) { this.genResults = []; console.warn(e); }
		if (this.screen === 'generator') this.root.querySelector('#gen-results').innerHTML = this.resultTiles();
	}

	async startGenerate() {
		const g = this.gen;
		const name = (g.name || '').trim() || 'Region';
		try {
			const meta = await this.game.generateRegion({ name, center: { lon: g.lon, lat: g.lat }, size: +g.size, terrain: g.terrain, buildings: g.buildings });
			if (meta) this.show('regions', 'home');
		} catch (e) {
			this.estError = `NIE UDAŁO SIĘ: ${e.message}`;
			const card = this.root.querySelector('#gen-card');
			if (card) card.innerHTML = this.estimateCard();
		}
	}

	render_help() {
		return `<section class="menu-content menu-window">${this.head('Sterowanie.', '')}
			<div class="menu-scroll"><h2>Klawiatura i mysz</h2><dl class="keys">${KEYS.map(([k, d]) => `<dt>${k}</dt><dd>${d}</dd>`).join('')}</dl>
			<h2>Wskazówki</h2><ul class="news"><li>Poniżej ~110 km/h samolot traci siłę nośną – opuść nos i dodaj gazu.</li>
			<li>Przyziemienie: skrzydła poziomo, opadanie wolniejsze niż ~4 m/s – wariometr w kabinie pokaże, ile.</li>
			<li>Nocą włącz reflektory (L) – oświetlają teren, drzewa i domy przed samolotem.</li></ul></div>
			<div class="menu-window-actions">${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}</div></section>`;
	}

	render_news() {
		return `<section class="menu-content menu-window">${this.head('Co nowego.', '')}
			<div class="menu-scroll">${NEWS.map((r, i) => `<h2>Wersja ${r.v} · ${esc(r.title)}${i === 0 ? ' <span class="news-now">bieżąca</span>' : ''}</h2>
				<ul class="news">${r.items.map(([t, d]) => `<li><b>${t}</b> – ${d}</li>`).join('')}</ul>`).join('')}</div>
			<div class="menu-window-actions">${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}</div></section>`;
	}

	render_pause() {
		return `<section class="menu-content">${this.head('<span class="pause-mark">Ⅱ</span>Lot wstrzymany.', 'Symulacja stoi – samolot zawisł w powietrzu do czasu wznowienia.')}
			<div class="menu-actions">
				${this.btn('resume', 'Wznów lot', { prominent: true, hint: '<kbd>ESC</kbd>' })}
				${this.btn('map', 'Mapa i cel lotu', { hint: '<kbd>TAB</kbd>' })}
				${this.btn('env', 'Pogoda i pora dnia')}
				${this.btn('save', 'Zapisz lot — sloty')}
				${this.btn('load', 'Wczytaj lot — sloty')}
				${this.btn('settings', 'Ustawienia')}
				${this.btn('help', 'Sterowanie i pomoc')}
				${this.btn('menu', 'Menu główne')}
			</div></section>`;
	}

	card_pause() {
		const r = this.game.report();
		return `<aside class="menu-card gold"><div class="eyebrow">RAPORT LOTU</div><h2>${esc(r.where)}</h2>
			<dl><dt>Maszyna</dt><dd>${esc(r.aircraft)}</dd><dt>Prędkość</dt><dd>${r.speed} km/h</dd><dt>Wysokość</dt><dd>${r.alt} m n.p.m. · ${r.agl} m nad ziemią</dd>
			<dt>Kurs</dt><dd>${r.heading}°</dd><dt>Gaz</dt><dd>${r.throttle}%</dd><dt>Czas</dt><dd>${esc(r.time)}</dd><dt>Pogoda</dt><dd>${esc(r.weather)}</dd><dt>Wiatr</dt><dd>${esc(r.wind)}</dd></dl>
			<span class="tag">${r.lights}</span></aside>`;
	}

	render_pauseEnv() {
		const cur = this.game.environment();
		const tiles = (list, kind) => `<div class="tiles">${list.map((o, i) =>
			`<button class="tile${cur[kind] === o.id ? ' sel' : ''}" data-env="${kind}:${o.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(o.name)}</b><small>${esc(o.note)}</small></button>`).join('')}</div>`;
		return `<section class="menu-content menu-window">${this.head('Pogoda i pora.', '')}
			<div class="menu-scroll"><h2>Pora dnia</h2>${tiles(TIMES, 'time')}<h2>Upływ czasu</h2>${tiles(TIME_SPEEDS, 'timeSpeed')}<h2>Pora roku</h2>${tiles(SEASONS, 'season')}<h2>Pogoda</h2>${tiles(WEATHER, 'weather')}<h2>Wiatr</h2>${tiles(WINDS, 'wind')}</div>
			<div class="menu-window-actions">${this.btn('resume', 'Wznów lot', { prominent: true })}${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}</div></section>`;
	}

	render_crash() {
		const r = this.game.report();
		return `<section class="menu-content menu-window menu-dialog danger">${this.head('Kraksa.', `Dromader nie przetrwał spotkania z ziemią ${esc(r.where)}. Pilot cały – maszyna wymaga przeglądu.`)}
			<div class="menu-window-actions">${this.btn('restart', 'Leć ponownie', { prominent: true, hint: '<kbd>ENTER</kbd>' })}${this.btn('load', 'Wczytaj lot')}${this.btn('menu', 'Menu główne')}</div></section>`;
	}

	// ---------- zdarzenia ----------

	onClick(e) {
		const t = e.target.closest('button');
		if (!t || t.disabled) return;
		const g = this.game;
		const d = t.dataset;
		if (d.act !== 'back') g.uiSound?.(d.pick || d.env || d.tab || d.genopt || d.genplace || d.del ? 'select' : 'click'); // „Wróć” – dźwięk w escape()
		if (t.dataset.go) return this.show(t.dataset.go, this.screen);
		if (t.dataset.tab) { this.settingsTab = +t.dataset.tab; return this.show('settings'); }
		if (t.dataset.pick) {
			const [k, v] = t.dataset.pick.split(':');
			this.plan[k] = v;
			g.setPlan(this.plan);
			this.root.querySelectorAll(`[data-pick^="${k}:"]`).forEach((b) => b.classList.toggle('sel', b === t));
			return;
		}
		if (t.dataset.env) {
			const [k, v] = t.dataset.env.split(':');
			g.setEnvironment(k, v);
			this.root.querySelectorAll(`[data-env^="${k}:"]`).forEach((b) => b.classList.toggle('sel', b === t));
			return;
		}
		if (t.dataset.genopt) {
			const [k, v] = t.dataset.genopt.split(':');
			this.gen[k] = v;
			this.root.querySelectorAll(`[data-genopt^="${k}:"]`).forEach((b) => b.classList.toggle('sel', b === t));
			return this.requestEstimate();
		}
		if (t.dataset.genplace) {
			const list = this.genResults ?? PRESETS;
			const p = list[+t.dataset.genplace];
			Object.assign(this.gen, { lon: p.lon, lat: p.lat, name: p.name });
			const nameEl = this.root.querySelector('[data-gen="name"]');
			if (nameEl) nameEl.value = p.name;
			this.root.querySelectorAll('[data-genplace]').forEach((b) => b.classList.toggle('sel', b === t));
			return this.requestEstimate();
		}
		if (t.dataset.region) return g.switchRegion(t.dataset.region);
		if (t.dataset.del) {
			const row = t.closest('.region-row');
			if (!t.classList.contains('armed')) { t.classList.add('armed'); t.textContent = 'Usuń?'; return; }
			row.style.opacity = 0.4;
			return Promise.resolve(g.deleteRegion(t.dataset.del)).then(() => this.screen === 'regions' && this.fillRegions());
		}
		if (t.dataset.slot) {
			const id = t.dataset.slot === 'auto' ? 'auto' : +t.dataset.slot;
			if (this.slotMode === 'save') { Promise.resolve(g.saveSlot(id)).then(() => this.screen === 'slots' && this.show('slots')); return; }
			return g.loadSlot(id);
		}
		switch (t.dataset.act) {
			case 'continue': return g.loadSlot('auto');
			case 'quick': return g.startFlight(this.plan);
			case 'start': return g.startFlight(this.plan);
			case 'new': return this.show('newflight', this.screen);
			case 'load': this.slotMode = 'load'; return this.show('slots', this.screen);
			case 'save': this.slotMode = 'save'; return this.show('slots', this.screen);
			case 'settings': return this.show('settings', this.screen);
			case 'help': return this.show('help', this.screen);
			case 'regions': return this.show('regions', this.screen);
			case 'generator': return this.show('generator', 'regions');
			case 'geo': return this.search();
			case 'generate': return this.startGenerate();
			case 'env': return this.show('pauseEnv', 'pause');
			case 'map': return g.openMap?.();
			case 'resume': return g.resume();
			case 'restart': return g.restart();
			case 'menu': return g.toMenu();
			case 'back': return this.escape();
			case 'quit': return globalThis.desktop?.quit(); // tylko aplikacja desktopowa (electron/preload.cjs)
		}
	}

	onInput(e) {
		const el = e.target;
		if (el.dataset.gen) {
			this.gen[el.dataset.gen] = el.value;
			if (el.dataset.gen === 'name') { const h = this.root.querySelector('#gen-card h2'); if (h) h.textContent = el.value || 'Region'; }
			return;
		}
		const key = el.dataset.set;
		if (!key) return;
		const v = el.type === 'checkbox' ? el.checked : +el.value;
		this.game.setSetting(key, v);
		if (el.type === 'checkbox') this.game.uiSound?.('toggle');
		if (el.type === 'range') {
			this.fill(el);
			const out = el.closest('.setting')?.querySelector('output');
			if (out) out.textContent = (FMT[key] ?? String)(v); // brak formatu nie może zatrzymać podpisu
		}
	}

	fill(r) {
		r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
	}

	/** Esc / „Wróć”: o poziom wyżej. Zwraca true, gdy menu obsłużyło klawisz. */
	escape() {
		const s = this.screen;
		if (!s) return false;
		if (s !== 'home' && s !== 'crash') this.game.uiSound?.('back');
		if (s === 'pause') { this.game.resume(); return true; }
		if (s === 'crash' || s === 'home') return true;
		this.show(this.from[s] || (this.game.inFlight() ? 'pause' : 'home'));
		return true;
	}

	/** Enter: start z planu (strona główna, plan lotu) albo ponowny lot po kraksie. */
	enter() {
		if (this.screen === 'home' || this.screen === 'newflight') { this.game.startFlight(this.plan); return true; }
		if (this.screen === 'crash') { this.game.restart(); return true; }
		return false;
	}

	planInfo(plan) {
		return {
			place: this.game.places.find((p) => p.id === plan.place) ?? this.game.places[0],
			time: TIMES.find((p) => p.id === plan.time) ?? TIMES[1],
			season: SEASONS.find((p) => p.id === plan.season) ?? SEASONS[1],
			weather: WEATHER.find((p) => p.id === plan.weather) ?? WEATHER[2],
			wind: WINDS.find((p) => p.id === plan.wind) ?? WINDS[1],
		};
	}
}

const FMT = {
	mini: (v) => (v < 0.05 ? 'wyłączony' : v < 0.8 ? 'lekki' : v < 1.5 ? 'makieta' : 'mocny'),
	exposure: (v) => `×${(+v).toFixed(2)}`,
	renderScale: (v) => `${Math.round(v * 100)}%`,
	relief: (v) => `×${(+v).toFixed(1)}`,
	mouseSens: (v) => `×${(+v).toFixed(2)}`,
	cockpitFov: (v) => `${Math.round(v)}°`,
	traffic: (v) => ['wyłączony', 'mały', 'normalny', 'duży'][Math.round(v)],
	volume: (v) => (v < 0.005 ? 'cisza' : `${Math.round(v * 100)}%`),
};
FMT.engineVolume = FMT.ambientVolume = FMT.volume;
