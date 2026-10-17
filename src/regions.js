// Regiony wbudowane (data/regions/<id>/). Kwadrat o boku size metrów wokół środka.
// Bez pola gen – wypiekane z ESA WorldCover i Overpass (npm run bake -- <id>, npm run bake:osm -- <id>);
// z polem gen – z kafli wektorowych OpenStreetMap jak generator w grze (npm run bake:gen -- <id>), z miejscami
// startu (nazwa z mapy, odmiana: gen – dopełniacz „od …”, instr – narzędnik „nad …”; pierwsze – domyślne).
export const REGIONS = {
	'bory-tucholskie': {
		id: 'bory-tucholskie',
		name: 'Bory Tucholskie',
		center: { lon: 17.65, lat: 53.64 },
		size: 46000,
		heightRes: 2048,
		coverRes: 4096,
	},
	zabrze: {
		id: 'zabrze',
		name: 'Zabrze',
		center: { lon: 18.7857, lat: 50.3249 },
		size: 46000,
		gen: {
			terrain: 'detailed', buildings: 'all',
			places: [
				{ id: 'zabrze', name: 'Zabrze', gen: 'Zabrza', instr: 'Zabrzem' },
				{ id: 'gliwice', name: 'Gliwice', gen: 'Gliwic', instr: 'Gliwicami' },
				{ id: 'katowice', name: 'Katowice', gen: 'Katowic', instr: 'Katowicami' },
				{ id: 'bytom', name: 'Bytom', gen: 'Bytomia', instr: 'Bytomiem' },
				{ id: 'ruda', name: 'Ruda Śląska', gen: 'Rudy Śląskiej', instr: 'Rudą Śląską' },
				{ id: 'chorzow', name: 'Chorzów', gen: 'Chorzowa', instr: 'Chorzowem' },
			],
		},
	},
	'beskid-slaski': {
		id: 'beskid-slaski',
		name: 'Beskid Śląski',
		center: { lon: 19.0, lat: 49.7 },
		size: 46000,
		gen: {
			terrain: 'detailed', buildings: 'all',
			places: [
				{ id: 'szczyrk', name: 'Szczyrk', gen: 'Szczyrku', instr: 'Szczyrkiem' },
				{ id: 'bielsko', name: 'Bielsko-Biała', gen: 'Bielska-Białej', instr: 'Bielskiem-Białą' },
				{ id: 'wisla', name: 'Wisła', gen: 'Wisły', instr: 'Wisłą' },
				{ id: 'ustron', name: 'Ustroń', gen: 'Ustronia', instr: 'Ustroniem' },
				{ id: 'zywiec', name: 'Żywiec', gen: 'Żywca', instr: 'Żywcem' },
				{ id: 'skoczow', name: 'Skoczów', gen: 'Skoczowa', instr: 'Skoczowem' },
			],
		},
	},
};
export const DEFAULT_REGION = 'zabrze';
