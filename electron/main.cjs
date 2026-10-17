/* Aplikacja desktopowa: gra w oknie Electron, bez serwera (jak w Maszyniście i Pograniczu Galaktyki).
   - Pliki gry podaje protokół app:// (electron/assets.cjs) zamiast file:// – moduły ES, mapa importów i fetch danych
     regionu działają jak z serwera, a zapisy (localStorage) mają stałe źródło. Pliki czytane przez fs – działają też
     z app.asar spakowanej aplikacji.
   - WebGPU: Chromium w Electronie ma je włączone; aplikacja prosi o wydajną kartę graficzną (laptopy z dwiema).
   - Okno bez paska menu; F11 albo Alt+Enter – pełny ekran; rozmiar, położenie, maksymalizacja i pełny ekran
     zapamiętane (userData/window.json). Jedna kopia naraz.
   - Zabezpieczenia: izolacja kontekstu, piaskownica, bez Node w stronie; nawigacja tylko w obrębie app://game, linki
     zewnętrzne w przeglądarce systemu, bez nowych okien. Strona dostaje małe API (electron/preload.cjs →
     window.desktop).
   - Narzędzia deweloperskie (Ctrl+Shift+I) tylko w wersji niespakowanej. */
'use strict';
const { app, BrowserWindow, protocol, shell, ipcMain, Menu, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { resolveAsset, mimeOf } = require('./assets.cjs');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'app://game';
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
Menu.setApplicationMenu(null);
app.commandLine.appendSwitch('force_high_performance_gpu');

if (!app.requestSingleInstanceLock()) app.quit();

function loadState() {
	try {
		const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
		return s && typeof s === 'object' ? s : {};
	} catch {
		return {};
	}
}
function saveState(win) {
	if (!win || win.isDestroyed()) return;
	const bounds = win.getNormalBounds();
	try {
		fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...bounds, maximized: win.isMaximized(), fullscreen: win.isFullScreen() }));
	} catch {}
}
// zapamiętane położenie tylko wtedy, gdy nadal leży na którymś ekranie
function onScreen(s) {
	if (![s.x, s.y, s.width, s.height].every(Number.isFinite)) return false;
	return screen.getAllDisplays().some(({ workArea: a }) => s.x + 80 > a.x && s.y + 40 > a.y && s.x < a.x + a.width - 80 && s.y < a.y + a.height - 40);
}

let win = null;
function createWindow() {
	const state = loadState();
	const placed = onScreen(state);
	win = new BrowserWindow({
		width: Math.max(1024, state.width || 1600),
		height: Math.max(640, state.height || 900),
		...(placed ? { x: state.x, y: state.y } : {}),
		minWidth: 1024,
		minHeight: 640,
		show: false,
		backgroundColor: '#0b1018',
		title: 'Lot nad Polską',
		icon: path.join(ROOT, process.platform === 'win32' ? 'favicon.ico' : 'icons/icon-256.png'), // build/ nie trafia do paczki
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false,
			backgroundThrottling: false,
		},
	});
	if (state.maximized) win.maximize();
	if (state.fullscreen) win.setFullScreen(true);
	win.once('ready-to-show', () => win.show());

	const wc = win.webContents;
	wc.on('will-navigate', (e, url) => {
		if (url.startsWith(ORIGIN + '/')) return;
		e.preventDefault();
		if (/^https?:\/\//.test(url)) shell.openExternal(url);
	});
	wc.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	wc.on('before-input-event', (e, input) => {
		if (input.type !== 'keyDown') return;
		if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
			win.setFullScreen(!win.isFullScreen());
			e.preventDefault();
		} else if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
			wc.toggleDevTools();
			e.preventDefault();
		}
	});
	for (const event of ['enter-full-screen', 'leave-full-screen']) win.on(event, () => wc.send('desktop:fullscreen', win.isFullScreen()));
	win.on('close', () => saveState(win));
	win.on('closed', () => (win = null));
	if (process.env.LOT_CHECK) selfCheck(win);
	win.loadURL(ORIGIN + '/index.html');
}

/* npm run app:check – aplikacja startuje, wczytuje region, przechodzi ekran startowy, startuje „Szybki start”,
   czeka, aż samolot poleci, wypisuje raport z błędami strony i kończy się (kod wyjścia 1 przy problemie).
   LOT_SHOT=<plik.png> – zrzut okna z lotu. */
function selfCheck(w) {
	const errors = [];
	w.webContents.on('console-message', (e) => {
		if (e.level === 'error') errors.push(e.message);
	});
	w.webContents.on('did-fail-load', (_, code, text, url) => errors.push(`load ${url}: ${text}`));
	w.webContents.once('did-finish-load', async () => {
		let report;
		try {
			report = await w.webContents.executeJavaScript(`(async () => {
				const wait = async (ok, s) => { for (let i = 0; i < s * 4 && !ok(); i++) await new Promise((r) => setTimeout(r, 250)); return ok(); };
				const $ = (id) => document.getElementById(id);
				const nogpu = () => !$('nogpu').hidden;
				await wait(() => $('boot').classList.contains('ready') || nogpu(), 120);
				if (nogpu()) return { gpu: !!navigator.gpu, error: $('nogpu-title').textContent };
				window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
				await wait(() => window.__lot, 10);
				document.querySelector('[data-act="quick"]').click();
				await wait(() => window.__lot.game === 'flying', 120);
				const x0 = window.__lot.flight.x, z0 = window.__lot.flight.z;
				await new Promise((r) => setTimeout(r, 2000));
				const f = window.__lot.flight;
				return {
					origin: location.origin,
					desktop: !!(window.desktop && window.desktop.app),
					gpu: !!navigator.gpu,
					game: window.__lot.game,
					moved: Math.round(Math.hypot(f.x - x0, f.z - z0)),
					speed: Math.round(f.speed * 3.6),
					frame: Math.round(await window.__lot.bench(10) * 10) / 10,
					storage: (() => { try { localStorage.setItem('lot-check', '1'); localStorage.removeItem('lot-check'); return true; } catch { return false; } })(),
				};
			})()`);
		} catch (err) {
			errors.push(String(err));
		}
		if (process.env.LOT_SHOT)
			try {
				await new Promise((r) => setTimeout(r, 2000));
				fs.writeFileSync(process.env.LOT_SHOT, (await w.webContents.capturePage()).toPNG());
			} catch {}
		const out = JSON.stringify({ report, errors }, null, 1);
		console.log(out);
		// spakowana aplikacja w Windows nie ma konsoli: LOT_CHECK=<plik> zapisuje tam raport
		if (process.env.LOT_CHECK !== '1')
			try {
				fs.writeFileSync(process.env.LOT_CHECK, out);
			} catch {}
		app.exit(errors.length || !report || report.game !== 'flying' || !(report.moved > 0) ? 1 : 0);
	});
}

ipcMain.handle('desktop:fullscreen:get', () => !!(win && win.isFullScreen()));
ipcMain.handle('desktop:fullscreen:set', (_, on) => {
	if (win) win.setFullScreen(!!on);
	return !!(win && win.isFullScreen());
});
ipcMain.handle('desktop:quit', () => app.quit());

app.on('second-instance', () => {
	if (!win) return;
	if (win.isMinimized()) win.restore();
	win.focus();
});

app.whenReady().then(() => {
	protocol.handle('app', async (request) => {
		const url = new URL(request.url);
		if (url.host !== 'game') return new Response('Nie znaleziono', { status: 404 });
		const file = resolveAsset(ROOT, url.pathname);
		if (!file) return new Response('Nie znaleziono', { status: 404 });
		try {
			return new Response(await fs.promises.readFile(file), { headers: { 'content-type': mimeOf(file) } });
		} catch {
			return new Response('Nie znaleziono', { status: 404 });
		}
	});
	createWindow();
	app.on('activate', () => {
		if (!BrowserWindow.getAllWindows().length) createWindow();
	});
});
app.on('window-all-closed', () => app.quit());
