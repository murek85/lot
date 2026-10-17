/* Okno strony na aplikację desktopową: window.desktop – pełny ekran i wyjście z gry. Nic więcej z Electrona ani Node
   nie trafia do strony. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
	app: true,
	isFullScreen: () => ipcRenderer.invoke('desktop:fullscreen:get'),
	setFullScreen: (on) => ipcRenderer.invoke('desktop:fullscreen:set', !!on),
	onFullScreen: (listener) => ipcRenderer.on('desktop:fullscreen', (_, on) => listener(!!on)),
	quit: () => ipcRenderer.invoke('desktop:quit'),
});
