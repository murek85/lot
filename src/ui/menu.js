// Menu gry: ekrany składane z szablonów (jak w Pograniczu Galaktyki), nad żywą sceną 3D (jak w Maszyniście).
// Ekrany: home (dowództwo lotu), newflight (plan lotu: miejsce, pora roku i dnia, pogoda, widok), slots (zapis /
// odczyt), settings (zakładki), help, news, pause, pauseEnv (pogoda i pora w trakcie lotu), crash.
// Esc cofa o jeden poziom; w locie otwiera pauzę, na pauzie wznawia. Gra dostarcza obiekt `game` z akcjami.
import { PLACES, TIMES, SEASONS, WEATHER } from './places.js';
import { AIRCRAFT, aircraftById } from '../plane/aircraft.js';

export const VERSION = 'PROTOTYP 0.7'; // zgodnie z CHANGELOG.md i NEWS

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
};

// „Co nowego” – skrót pliku CHANGELOG.md (wersje 0.1–0.6 nadane wstecz kolejnym etapom prac)
export const NEWS = [
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
	['Kółko', 'odległość kamery; w kabinie – pole widzenia'],
	['Prawy przycisk', 'kąt kamery; w kabinie przeciąganie – rozglądanie się, dwuklik – na wprost'],
	['Esc', 'pauza i wznowienie, w menu – wstecz'],
	['R', 'start od nowa z tego samego miejsca'],
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
		root.addEventListener('input', (e) => this.onInput(e));
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
		return `<section class="menu-content">${this.head('Gotowy do startu.', 'Bory Tucholskie z wysokości kilkuset metrów: jeziora rynnowe, Brda, lasy i miasteczka z prawdziwej mapy.')}
			<div class="menu-actions">
				${cont ? this.btn('continue', `Kontynuuj lot <small style="opacity:.7;font-weight:400">· ${esc(cont.title)}</small>`, { prominent: true }) : ''}
				${this.btn('quick', 'Szybki start', { prominent: !cont, hint: '<kbd>ENTER</kbd>' })}
				${this.btn('new', 'Nowy lot — plan lotu')}
				${this.btn('load', 'Wczytaj lot — sloty')}
				${this.btn('settings', 'Ustawienia')}
				${this.btn('help', 'Sterowanie i pomoc')}
			</div></section>`;
	}

	card_home() {
		const p = this.planInfo(this.plan);
		return `<aside class="menu-card"><div class="eyebrow">PLAN LOTU</div><h2>${esc(p.place.name)}</h2>
			<dl><dt>Pora</dt><dd>${esc(p.time.name)} · ${esc(p.season.note)}</dd><dt>Pogoda</dt><dd>${esc(p.weather.name)}</dd>
			<dt>Maszyna</dt><dd>${esc(aircraftById(this.plan.aircraft).name)} · ${aircraftById(this.plan.aircraft).reg}</dd><dt>Widok</dt><dd>${this.plan.view === 'cockpit' ? 'kabina' : 'za samolotem'}</dd></dl>
			<span class="tag">${this.game.slotInfo('auto') ? 'ZAPIS GOTOWY DO WZNOWIENIA' : 'OCZEKIWANIE NA ZGODĘ NA START'}</span></aside>`;
	}

	render_newflight() {
		const tiles = (list, key, wide = false) => `<div class="tiles${wide ? ' wide' : ''}">${list.map((o, i) =>
			`<button class="tile${this.plan[key] === o.id ? ' sel' : ''}" data-pick="${key}:${o.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(o.name)}</b><small>${esc(o.note)}</small></button>`).join('')}</div>`;
		return `<section class="menu-content menu-window">${this.head('Plan lotu.', '')}
			<div class="menu-scroll">
				<h2>Samolot</h2>${tiles(Object.values(AIRCRAFT).map((a) => ({ id: a.id, name: a.name, note: `${a.note} · ${a.specs}` })), 'aircraft', true)}
				<h2>Miejsce startu</h2>${tiles(PLACES, 'place', true)}
				<h2>Pora dnia</h2>${tiles(TIMES, 'time')}
				<h2>Pora roku</h2>${tiles(SEASONS, 'season')}
				<h2>Pogoda</h2>${tiles(WEATHER, 'weather')}
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
		const tabs = [['Obraz', 'obraz'], ['Sterowanie', 'ster'], ['Interfejs', 'ui']];
		const range = (key, label, min, max, step, fmt, note = '') => `<label class="setting"><span>${label}<output>${fmt(s[key])}</output></span>
			<input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-fmt="${key}">${note ? `<small>${note}</small>` : ''}</label>`;
		const check = (key, label, note = '') => `<label class="setting check"${note ? ` title="${esc(note)}"` : ''}><input type="checkbox" data-set="${key}"${s[key] ? ' checked' : ''}><span>${label}</span>${note ? `<small>${note}</small>` : ''}</label>`;
		const panels = [
			range('mini', 'Efekt miniatury', 0, 2, 0.05, FMT.mini, 'rozmycie góry i dołu kadru – krajobraz jak makieta') +
			range('exposure', 'Ekspozycja', 0.4, 2.5, 0.01, FMT.exposure, 'mnożnik automatycznej ekspozycji') +
			range('renderScale', 'Rozdzielczość obrazu', 0.5, 1, 0.05, FMT.renderScale, 'mniej – płynniej na słabszych kartach') +
			range('relief', 'Przewyższenie rzeźby', 1, 4, 0.1, FMT.relief, 'pagórki morenowe wyraźniejsze z góry'),
			check('invertPitch', 'Odwróć oś wznoszenia', 'W / ↑ – nos w dół, jak drążkiem') +
			range('mouseSens', 'Czułość myszy w kabinie', 0.4, 2, 0.05, FMT.mouseSens) +
			range('cockpitFov', 'Pole widzenia w kabinie', 45, 90, 1, FMT.cockpitFov),
			check('hud', 'Panel lotu', 'prędkość, wysokość, gaz w rogu ekranu') +
			check('fps', 'Licznik klatek') +
			check('reducedMotion', 'Ogranicz animacje menu') +
			check('dev', 'Panel deweloperski', 'suwaki godziny, daty, chmur i powietrza; klawisz H'),
		];
		return `<section class="menu-content menu-window">${this.head('Ustawienia.', '')}
			<div class="menu-tabs" role="tablist">${tabs.map(([t], i) => `<button role="tab" data-tab="${i}" aria-selected="${i === this.settingsTab}"><small>0${i + 1}</small>${t}</button>`).join('')}</div>
			<div class="menu-scroll"><div class="tab-panel" role="tabpanel">${panels[this.settingsTab]}</div></div>
			<div class="menu-window-actions">${this.btn('back', 'Wróć', { hint: '<kbd>ESC</kbd>' })}<span class="spacer"></span><small style="color:var(--m-muted)">Zmiany działają od razu i są zapamiętywane.</small></div></section>`;
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
			<dt>Kurs</dt><dd>${r.heading}°</dd><dt>Gaz</dt><dd>${r.throttle}%</dd><dt>Czas</dt><dd>${esc(r.time)}</dd><dt>Pogoda</dt><dd>${esc(r.weather)}</dd></dl>
			<span class="tag">${r.lights}</span></aside>`;
	}

	render_pauseEnv() {
		const cur = this.game.environment();
		const tiles = (list, kind) => `<div class="tiles">${list.map((o, i) =>
			`<button class="tile${cur[kind] === o.id ? ' sel' : ''}" data-env="${kind}:${o.id}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${esc(o.name)}</b><small>${esc(o.note)}</small></button>`).join('')}</div>`;
		return `<section class="menu-content menu-window">${this.head('Pogoda i pora.', '')}
			<div class="menu-scroll"><h2>Pora dnia</h2>${tiles(TIMES, 'time')}<h2>Pora roku</h2>${tiles(SEASONS, 'season')}<h2>Pogoda</h2>${tiles(WEATHER, 'weather')}</div>
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
			case 'env': return this.show('pauseEnv', 'pause');
			case 'resume': return g.resume();
			case 'restart': return g.restart();
			case 'menu': return g.toMenu();
			case 'back': return this.escape();
		}
	}

	onInput(e) {
		const el = e.target;
		const key = el.dataset.set;
		if (!key) return;
		const v = el.type === 'checkbox' ? el.checked : +el.value;
		this.game.setSetting(key, v);
		if (el.type === 'range') {
			this.fill(el);
			const out = el.closest('.setting')?.querySelector('output');
			if (out) out.textContent = FMT[key](v);
		}
	}

	fill(r) {
		r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
	}

	/** Esc / „Wróć”: o poziom wyżej. Zwraca true, gdy menu obsłużyło klawisz. */
	escape() {
		const s = this.screen;
		if (!s) return false;
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
			place: PLACES.find((p) => p.id === plan.place) ?? PLACES[0],
			time: TIMES.find((p) => p.id === plan.time) ?? TIMES[1],
			season: SEASONS.find((p) => p.id === plan.season) ?? SEASONS[1],
			weather: WEATHER.find((p) => p.id === plan.weather) ?? WEATHER[2],
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
};
