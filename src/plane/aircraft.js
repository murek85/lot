// Rejestr samolotów do wyboru: model, charakterystyka lotu, opis do menu.
import { createDromader, REGISTRATION as DRB } from './model.js';
import { createWilga, REGISTRATION as WGA } from './wilga.js';
import { createExtra, REGISTRATION as AKR } from './extra.js';
import { DROMADER, WILGA, EXTRA } from './flight.js';

export const AIRCRAFT = {
	dromader: {
		id: 'dromader', name: 'PZL M-18 Dromader', short: 'Dromader', reg: DRB, build: createDromader, flight: DROMADER,
		note: 'rolniczy dolnopłat, 1000 KM, stabilny i ciężki',
		specs: 'rozpiętość 17,7 m · 110–260 km/h · kabina jednoosobowa',
	},
	wilga: {
		id: 'wilga', name: 'PZL-104 Wilga 35', short: 'Wilga', reg: WGA, build: createWilga, flight: WILGA,
		note: 'górnopłat STOL, startuje z łąki, widok w dół przez drzwi',
		specs: 'rozpiętość 11,1 m · 60–190 km/h · cztery miejsca',
	},
	extra: {
		id: 'extra', name: 'Extra 330LX', short: 'Extra', reg: AKR, build: createExtra, flight: EXTRA,
		note: 'akrobacyjny, beczki i lot na plecach, 300°/s przechyłu',
		specs: 'rozpiętość 7,5 m · 110–345 km/h · owiewka kroplowa',
	},
};

export const aircraftById = (id) => AIRCRAFT[id] ?? AIRCRAFT.dromader;
