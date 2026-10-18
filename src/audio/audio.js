// Dźwięk gry – syntezowany w Web Audio, bez plików nagrań: silnik (ton zapłonów z harmonicznymi, kołysanie
// gwiazdowego, pulsujący wydech), śmigło (świst modulowany przejściem łopat), wiatr i toczenie po ziemi z szumu,
// brzęczyk przeciągnięcia, zdarzenia (przyziemienie, kraksa) i dźwięki menu. Poziomy liczy src/audio/mix.js.
// AudioContext powstaje przy pierwszym geście użytkownika (wymóg przeglądarek) – do tego czasu wszystko milczy.
import { SOUND, engineFreqs, layerLevels, masterGain } from './mix.js';

const SMOOTH = 0.08; // stała czasowa zmian parametrów (s) – bez trzasków

export class GameAudio {
	constructor() {
		this.ctx = null;
		this.snd = SOUND.dromader;
		this.rpm = 0;
		this.volume = 0.8;
		this.vol = { engine: 1, ambient: 1 };
		this.uiOn = true;
		this.muted = false;
		this.lastUi = 0;
	}

	/** Wywołać w obsłudze gestu (klik, klawisz) – tworzy i wznawia kontekst. */
	unlock() {
		if (!this.ctx) {
			const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
			if (!AC) return;
			this.ctx = new AC({ latencyHint: 'interactive' });
			this.build();
		}
		if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
	}

	/** Karta w tle – kontekst wstrzymany (nie zużywa procesora). */
	setHidden(hidden) {
		if (!this.ctx) return;
		if (hidden) this.ctx.suspend().catch(() => {});
		else this.ctx.resume().catch(() => {});
	}

	setAircraft(id) { this.snd = SOUND[id] ?? SOUND.dromader; this.waves(); }

	setSettings(s) {
		this.volume = s.volume ?? 0.8;
		this.vol = { engine: s.engineVolume ?? 1, ambient: s.ambientVolume ?? 1 };
		this.uiOn = s.uiSounds ?? true;
		this.muted = s.sound === false;
	}

	// ---------- graf ----------

	noiseBuffer(seconds = 2) {
		const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
		const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
		// szum różowy (filtr Paula Kelleta) – naturalniejszy od białego dla wiatru i świstu
		let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
		for (let i = 0; i < n; i++) {
			const w = Math.random() * 2 - 1;
			b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
			b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
			d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
			b6 = w * 0.115926;
		}
		return b;
	}

	noise() {
		const s = this.ctx.createBufferSource();
		s.buffer = this.noiseBuf;
		s.loop = true;
		s.loopStart = Math.random();
		s.start(0, Math.random() * 1.5);
		return s;
	}

	gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
	filter(type, f, q = 0.7) { const x = this.ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; }
	chain(...nodes) { for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]); return nodes[nodes.length - 1]; }

	build() {
		const c = this.ctx;
		this.noiseBuf = this.noiseBuffer();
		// wyjście: przytłumienie (pauza), kompresor (szczyty kraksy), głośność główna
		this.master = this.gain(0);
		this.muffle = this.filter('lowpass', 20000, 0.5);
		const comp = c.createDynamicsCompressor();
		comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
		this.chain(this.muffle, comp, this.master, c.destination);
		this.bus = this.gain(1);
		this.bus.connect(this.muffle);
		this.uiBus = this.gain(0.5); // menu – poza przytłumieniem pauzy
		this.uiBus.connect(comp);

		// silnik: dwa tony zapłonów (lekko rozstrojone – „bicie”) przez nasycenie i filtr, kołysanie od obrotu wału
		this.eng1 = c.createOscillator();
		this.eng2 = c.createOscillator();
		this.eng2.detune.value = 9;
		this.sub = c.createOscillator(); // pomruk o oktawę niżej
		this.sub.type = 'triangle';
		this.subGain = this.gain(0.5);
		this.waves();
		const shaper = c.createWaveShaper();
		const curve = new Float32Array(1024);
		for (let i = 0; i < curve.length; i++) { const x = (i / 511.5 - 1) * 2.2; curve[i] = Math.tanh(x) * 0.8; }
		shaper.curve = curve;
		shaper.oversample = '2x';
		this.engFilter = this.filter('lowpass', 800, 1.1);
		this.engLope = this.gain(1); // kołysanie (modulacja amplitudy obrotem wału)
		this.engGain = this.gain(0);
		const engMix = this.gain(0.32);
		this.eng1.connect(engMix); this.eng2.connect(engMix);
		this.chain(this.sub, this.subGain, engMix);
		this.chain(engMix, shaper, this.engFilter, this.engLope, this.engGain, this.bus);
		this.lope = c.createOscillator(); // obrót wału
		this.lopeDepth = this.gain(0);
		this.chain(this.lope, this.lopeDepth, this.engLope.gain);

		// wydech: szum w paśmie, pulsujący z częstotliwością zapłonów (trzask gwiazdowego, warkot boksera)
		this.exBand = this.filter('bandpass', 400, 1.2);
		this.exPulse = this.gain(0.5);
		this.exGain = this.gain(0);
		this.chain(this.noise(), this.exBand, this.exPulse, this.exGain, this.bus);
		this.exOsc = c.createOscillator();
		this.exOsc.type = 'square';
		this.exDepth = this.gain(0.5);
		this.chain(this.exOsc, this.exDepth, this.exPulse.gain);

		// śmigło: świst szumu modulowany przejściem łopat + niski ton łopat
		this.propBand = this.filter('bandpass', 900, 0.6);
		this.propMod = this.gain(0.6);
		this.propGain = this.gain(0);
		this.chain(this.noise(), this.propBand, this.propMod, this.propGain, this.bus);
		this.bladeOsc = c.createOscillator();
		this.bladeDepth = this.gain(0.4);
		this.chain(this.bladeOsc, this.bladeDepth, this.propMod.gain);
		this.bladeTone = c.createOscillator();
		this.bladeTone.type = 'sawtooth';
		this.bladeToneGain = this.gain(0.0);
		this.chain(this.bladeTone, this.filter('lowpass', 260, 0.7), this.bladeToneGain, this.propGain);

		// wiatr: dwa pasma szumu (szum opływu i niski huk), powolne podmuchy
		this.windBand = this.filter('bandpass', 600, 0.45);
		this.windLow = this.filter('lowpass', 180, 0.5);
		this.windGain = this.gain(0);
		this.gust = this.gain(1);
		this.chain(this.noise(), this.windBand, this.gust, this.windGain, this.bus);
		this.chain(this.noise(), this.windLow, this.gain(1.4), this.gust);
		this.gustOsc = c.createOscillator();
		this.gustOsc.frequency.value = 0.13;
		this.chain(this.gustOsc, this.gain(0.25), this.gust.gain);

		// deszcz: wysoki szum kropli + bębnienie o osłonę kabiny (pasmo średnie, ziarniste – modulacja szumem)
		this.rainGain = this.gain(0);
		this.chain(this.noise(), this.filter('highpass', 1800, 0.5), this.filter('lowpass', 9000, 0.5), this.rainGain, this.bus);
		this.drumGain = this.gain(0);
		const drumMod = this.gain(0.5);
		this.chain(this.noise(), this.filter('bandpass', 900, 0.9), drumMod, this.drumGain, this.bus);
		this.chain(this.noise(), this.filter('lowpass', 40, 0.5), this.gain(6), drumMod.gain);

		// pociąg: niskie dudnienie i stukot (szum w paśmie modulowany prostokątem w rytmie wózków)
		this.trainGain = this.gain(0);
		this.chain(this.noise(), this.filter('lowpass', 110, 0.8), this.gain(2.5), this.trainGain, this.bus);
		const clackMod = this.gain(0.4);
		this.chain(this.noise(), this.filter('bandpass', 1400, 2), clackMod, this.trainGain);
		this.clackOsc = c.createOscillator();
		this.clackOsc.type = 'square';
		this.clackOsc.frequency.value = 2;
		this.chain(this.clackOsc, this.gain(0.4), clackMod.gain);
		this.clackOsc.start();

		// gwar: szum w paśmie mowy z powolną, nieregularną modulacją (wiele głosów naraz)
		this.crowdGain = this.gain(0);
		const crowdMod = this.gain(0.6);
		this.chain(this.noise(), this.filter('bandpass', 520, 1.4), this.filter('peaking', 1800, 1), crowdMod, this.crowdGain, this.bus);
		this.chain(this.noise(), this.filter('lowpass', 6, 0.5), this.gain(8), crowdMod.gain);

		// ruch uliczny: szum opon (pasmo średnie) i niski pomruk silników
		this.trafficGain = this.gain(0);
		this.chain(this.noise(), this.filter('bandpass', 700, 0.5), this.trafficGain, this.bus);
		this.chain(this.noise(), this.filter('lowpass', 160, 0.7), this.gain(1.2), this.trafficGain);

		// toczenie po ziemi: niski szum i dudnienie
		this.groundGain = this.gain(0);
		this.chain(this.noise(), this.filter('lowpass', 140, 1.5), this.gain(2.2), this.groundGain, this.bus);

		// brzęczyk przeciągnięcia (przerywany)
		this.horn = c.createOscillator();
		this.horn.type = 'square';
		this.horn.frequency.value = 410;
		this.hornGate = this.gain(0);
		this.hornGain = this.gain(0);
		this.chain(this.horn, this.filter('bandpass', 1200, 2), this.hornGate, this.hornGain, this.bus);
		const hornLfo = c.createOscillator();
		hornLfo.type = 'square';
		hornLfo.frequency.value = 3.2;
		this.chain(hornLfo, this.gain(0.5), this.hornGate.gain);
		this.hornGate.gain.value = 0.5;

		// gwizd turbiny (tylko silnik turbośmigłowy): dwa rozstrojone tony przez wąski filtr
		this.whine1 = c.createOscillator();
		this.whine2 = c.createOscillator();
		this.whine2.detune.value = 14;
		this.whineBand = this.filter('bandpass', 3000, 4);
		this.whineGain = this.gain(0);
		this.whine1.connect(this.whineBand); this.whine2.connect(this.whineBand);
		this.chain(this.whineBand, this.whineGain, this.bus);

		for (const o of [this.eng1, this.eng2, this.sub, this.lope, this.exOsc, this.bladeOsc, this.bladeTone, this.gustOsc, this.horn, hornLfo, this.whine1, this.whine2]) o.start();
	}

	/** Barwa tonu zapłonów zależna od silnika: harmoniczne 1/n^k, gwiazdowy – mocniejsze parzyste (pomruk). */
	waves() {
		if (!this.ctx) return;
		const n = 24, re = new Float32Array(n), im = new Float32Array(n);
		const k = 1.25 - this.snd.bright * 0.55;
		for (let i = 1; i < n; i++) im[i] = (1 / Math.pow(i, k)) * (i % 2 === 0 ? 0.6 + this.snd.body * 0.5 : 1) * (i === 1 ? this.snd.body : 1);
		const w = this.ctx.createPeriodicWave(re, im);
		this.eng1.setPeriodicWave(w);
		this.eng2.setPeriodicWave(w);
	}

	// ---------- klatka ----------

	/** s – stan do miksu (zob. layerLevels) plus game ('menu' | 'flying' | 'paused' | 'crashed' | 'loading'). */
	update(dt, s) {
		if (!this.ctx || this.ctx.state !== 'running') return;
		const t = this.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, SMOOTH);
		// obroty: rozkręcanie szybkie, wybieg po kraksie i zgaszeniu – kilka sekund
		const target = s.rpm;
		const rate = target < this.rpm ? (s.crashed ? 0.6 : 1.5) : 2.5;
		this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * rate));
		const L = layerLevels({ ...s, rpm: this.rpm }, this.vol);
		const f = engineFreqs(Math.max(this.rpm, 1), this.snd);
		set(this.master.gain, masterGain(this.volume, this.muted, s.game) * 0.9);
		set(this.muffle.frequency, s.game === 'paused' ? 520 : 20000);

		set(this.eng1.frequency, f.firing);
		set(this.eng2.frequency, f.firing);
		set(this.sub.frequency, f.firing / 2);
		set(this.subGain.gain, 0.25 + this.snd.body * 0.35);
		set(this.lope.frequency, f.crank);
		set(this.lopeDepth.gain, this.snd.rough * 0.35 * (1 - s.throttle * 0.5));
		set(this.engFilter.frequency, L.engineCutoff);
		set(this.engGain.gain, L.engine * 0.55);

		set(this.exOsc.frequency, f.firing);
		set(this.exBand.frequency, 260 + f.firing * (1.5 + this.snd.bright * 3));
		set(this.exDepth.gain, 0.35 + this.snd.rough * 0.4);
		set(this.exGain.gain, L.exhaust * 0.5);

		set(this.whine1.frequency, f.whine);
		set(this.whine2.frequency, f.whine * 0.5);
		set(this.whineBand.frequency, f.whine);
		set(this.whineGain.gain, L.engine * (this.snd.turbine ?? 0) * (s.view === 'cockpit' ? 0.05 : 0.09));

		set(this.bladeOsc.frequency, f.blade);
		set(this.bladeTone.frequency, f.blade);
		set(this.propBand.frequency, 500 + f.blade * 6);
		set(this.bladeToneGain.gain, 0.6);
		set(this.propGain.gain, L.prop * 0.35);

		set(this.rainGain.gain, L.rain * 0.5);
		set(this.trafficGain.gain, L.traffic * 0.35);
		set(this.trainGain.gain, L.train * 0.45);
		set(this.crowdGain.gain, L.crowd * 0.4);
		set(this.clackOsc.frequency, Math.max(0.2, L.clack));
		set(this.drumGain.gain, L.drum * 0.55);
		set(this.windBand.frequency, L.windCutoff);
		set(this.windGain.gain, L.wind * 0.9);
		set(this.groundGain.gain, L.ground * 0.6);
		set(this.hornGain.gain, L.stall * 0.25);
	}

	// ---------- zdarzenia ----------

	/** Jednorazowy szum przez filtr z obwiednią. */
	burst({ type = 'lowpass', f = 800, q = 0.7, f2 = null, dur = 0.5, gain = 1, attack = 0.005, to = this.bus }) {
		const c = this.ctx, t = c.currentTime;
		const src = c.createBufferSource();
		src.buffer = this.noiseBuf;
		const flt = this.filter(type, f, q);
		if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
		const g = this.gain(0);
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
		this.chain(src, flt, g, to);
		src.start(t, Math.random() * 1.2);
		src.stop(t + dur + 0.05);
	}

	/** Jednorazowy ton z obwiednią (opcjonalnie glissando). */
	tone({ type = 'sine', f = 440, f2 = null, dur = 0.15, gain = 0.3, attack = 0.004, at = 0, to = this.bus }) {
		const c = this.ctx, t = c.currentTime + at;
		const o = c.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f, t);
		if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
		const g = this.gain(0);
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
		this.chain(o, g, to);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	/** Zdarzenia: 'touchdown' (siła 0…1), 'crash', 'thunder' i 'horn' (odległość w m). */
	event(name, strength = 0.5) {
		if (!this.ctx || this.ctx.state !== 'running') return;
		const v = this.vol.ambient;
		if (name === 'touchdown') {
			this.burst({ f: 120, q: 1.2, dur: 0.35, gain: (0.6 + strength) * v }); // uderzenie podwozia
			this.burst({ type: 'bandpass', f: 2400, f2: 1500, q: 3, dur: 0.25 + strength * 0.25, gain: 0.25 * strength * v, attack: 0.01 }); // pisk opon
		} else if (name === 'horn') {
			// sygnał pociągu: akord dwóch tonów (jak syreny lokomotyw), ciszej z odległości
			const g = Math.min(0.5, 400 / (strength + 200)) * v;
			for (const f of [311, 370]) this.tone({ type: 'sawtooth', f, dur: 1.4, gain: 0.08 * g, attack: 0.06 });
			this.burst({ type: 'bandpass', f: 340, q: 4, dur: 1.4, gain: 0.15 * g, attack: 0.06 });
		} else if (name === 'thunder') {
			// grzmot: im bliżej, tym głośniej i ostrzej (trzask na początku), daleki – sam niski pomruk
			const d = strength, near = Math.min(1, 2500 / d);
			const g = Math.min(1.6, 2600 / d) * v;
			if (near > 0.6) this.burst({ type: 'highpass', f: 1200, f2: 300, q: 0.6, dur: 0.6, gain: 0.6 * g * near, attack: 0.003 });
			this.burst({ f: 260 * (0.5 + near), f2: 45, q: 0.9, dur: 4 + 3 * (1 - near), gain: g, attack: 0.05 + (1 - near) * 0.4 });
			this.burst({ f: 110, q: 1.4, dur: 5.5, gain: 0.8 * g, attack: 0.3 });
		} else if (name === 'crash') {
			this.burst({ f: 900, f2: 90, q: 0.8, dur: 2.4, gain: 1.6 * v }); // uderzenie
			this.burst({ type: 'bandpass', f: 3200, f2: 700, q: 1.5, dur: 1.4, gain: 0.5 * v, attack: 0.02 }); // gięta blacha
			for (let i = 0; i < 7; i++) {
				// metal: krótkie nieharmoniczne tony, rozrzucone w czasie
				const f = 300 + Math.random() * 1600;
				this.tone({ type: 'triangle', f, f2: f * (0.6 + Math.random() * 0.3), dur: 0.3 + Math.random() * 0.6, gain: 0.12 * v, at: Math.random() * 0.8 });
			}
		}
	}

	/**
	 * Ptaki: kind 'call' (głos gatunku), 'scare' (trzepot spłoszonego stada), 'strike' (zderzenie); d – odległość od
	 * kamery (m), muffled – w kabinie (ciszej). Daleko (> 450 m) – nic nie słychać.
	 */
	bird(kind, species, d, muffled = false) {
		if (!this.ctx || this.ctx.state !== 'running') return;
		const v = this.vol.ambient * (muffled ? 0.3 : 1);
		if (kind === 'strike') {
			this.burst({ f: 180, q: 1, dur: 0.25, gain: 1.1 * this.vol.ambient, attack: 0.002 });
			this.burst({ type: 'bandpass', f: 2600, q: 0.8, dur: 0.35, gain: 0.25 * this.vol.ambient, attack: 0.01 });
			return;
		}
		if (d > 450) return;
		const g = Math.min(1, 60 / (d + 30)) * v;
		const t = (o) => this.tone(o);
		if (kind === 'scare') {
			// trzepot: seria krótkich szumów
			for (let i = 0; i < 10; i++) this.burstAt(0.03 * i + Math.random() * 0.03, { type: 'bandpass', f: 900 + Math.random() * 600, q: 1.2, dur: 0.05, gain: 0.25 * g });
			return;
		}
		if (species === 'starling') {
			const n = 3 + Math.floor(Math.random() * 4);
			for (let i = 0; i < n; i++) { const f = 3000 + Math.random() * 3000; t({ f, f2: f * (0.7 + Math.random() * 0.6), dur: 0.05, gain: 0.05 * g, at: i * 0.07 + Math.random() * 0.05 }); }
		} else if (species === 'stork') {
			// klekot: szybkie kliknięcia dziobem
			for (let i = 0; i < 14; i++) this.burstAt(i * 0.075, { type: 'bandpass', f: 1500, q: 3, dur: 0.03, gain: 0.35 * g });
		} else if (species === 'buzzard') {
			t({ type: 'sawtooth', f: 2600, f2: 1500, dur: 0.75, gain: 0.03 * g, attack: 0.05 });
			t({ f: 2600, f2: 1500, dur: 0.75, gain: 0.05 * g, attack: 0.05 });
		} else if (species === 'gull') {
			for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) t({ type: 'triangle', f: 1450, f2: 850, dur: 0.32, gain: 0.07 * g, at: i * 0.4, attack: 0.02 });
		} else {
			// wrona: „kraa” – chrapliwy ton z szumem
			for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) {
				t({ type: 'sawtooth', f: 560, f2: 470, dur: 0.28, gain: 0.04 * g, at: i * 0.42, attack: 0.02 });
				this.burstAt(i * 0.42, { type: 'bandpass', f: 1100, q: 2, dur: 0.28, gain: 0.12 * g, attack: 0.02 });
			}
		}
	}

	/** burst() z opóźnieniem (s). */
	burstAt(at, o) {
		if (at <= 0) return this.burst(o);
		setTimeout(() => this.burst(o), at * 1000);
	}

	/** Dźwięki menu: 'hover', 'click', 'select', 'back', 'done', 'toggle'. */
	ui(name) {
		if (!this.ctx || !this.uiOn || this.muted || this.ctx.state !== 'running') return;
		const now = performance.now();
		if (name === 'hover' && now - this.lastUi < 45) return;
		this.lastUi = now;
		const to = this.uiBus;
		const v = this.volume;
		if (name === 'hover') this.tone({ f: 2400, dur: 0.035, gain: 0.05 * v, to });
		else if (name === 'click') { this.tone({ type: 'triangle', f: 880, f2: 1320, dur: 0.07, gain: 0.16 * v, to }); this.burst({ type: 'highpass', f: 3000, dur: 0.03, gain: 0.08 * v, to }); }
		else if (name === 'select') this.tone({ type: 'triangle', f: 1180, dur: 0.06, gain: 0.13 * v, to });
		else if (name === 'back') this.tone({ type: 'triangle', f: 990, f2: 620, dur: 0.09, gain: 0.13 * v, to });
		else if (name === 'toggle') this.tone({ type: 'square', f: 1500, dur: 0.025, gain: 0.05 * v, to });
		else if (name === 'done') { this.tone({ f: 784, dur: 0.22, gain: 0.12 * v, to }); this.tone({ f: 1175, dur: 0.35, gain: 0.12 * v, at: 0.11, to }); }
	}
}
