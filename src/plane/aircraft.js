// Rejestr samolotów do wyboru: model, charakterystyka lotu, opis do menu.
import { createDromader, REGISTRATION as DRB } from './model.js';
import { createWilga, REGISTRATION as WGA } from './wilga.js';
import { createExtra, REGISTRATION as AKR } from './extra.js';
import { createAn2, REGISTRATION as ANT } from './an2.js';
import { createOrlik, REGISTRATION as ORL } from './orlik.js';
import { createP11c, REGISTRATION as P11 } from './p11c.js';
import { DROMADER, WILGA, EXTRA, AN2, ORLIK, P11C } from './flight.js';

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
	an2: {
		id: 'an2', name: 'PZL Mielec An-2', short: 'An-2', reg: ANT, build: createAn2, flight: AN2,
		note: 'dwupłat „Antek”, ociężały, lata bardzo wolno i prawie nie daje się przeciągnąć',
		specs: 'rozpiętość 18,2 m · 55–225 km/h · kabina dwuosobowa obok siebie',
	},
	orlik: {
		id: 'orlik', name: 'PZL-130 Orlik', short: 'Orlik', reg: ORL, build: createOrlik, flight: ORLIK,
		note: 'turbośmigłowy szkolny, akrobacja, chowane podwozie',
		specs: 'rozpiętość 9,0 m · 120–415 km/h · kabina tandem',
	},
	p11c: {
		id: 'p11c', name: 'PZL P.11c', short: 'P.11c', reg: P11, build: createP11c, flight: P11C,
		note: 'przedwojenny myśliwiec, skrzydło mewie, otwarta kabina',
		specs: 'rozpiętość 10,7 m · 110–375 km/h · silnik gwiazdowy Mercury',
	},
};

export const aircraftById = (id) => AIRCRAFT[id] ?? AIRCRAFT.dromader;
