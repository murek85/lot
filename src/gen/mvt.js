// Dekoder kafli wektorowych Mapbox Vector Tile (MVT, protobuf) – bez zależności, działa w przeglądarce, w workerze
// i w Node. Zwraca warstwy z obiektami: typ (1 punkt, 2 linia, 3 wielokąt), właściwości i geometrię w jednostkach
// kafla (0…extent) jako tablicę ciągów współrzędnych [x0, y0, x1, y1, …] – dla wielokątów pierścienie (zewnętrzne
// zgodnie z ruchem wskazówek zegara w układzie kafla, otwory przeciwnie, wg specyfikacji MVT 2).

class Reader {
	constructor(buf) {
		this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
		this.pos = 0;
		this.end = this.b.length;
	}
	varint() {
		let v = 0, shift = 0, byte;
		do {
			byte = this.b[this.pos++];
			// powyżej 2^31 – mnożenie zamiast przesunięcia bitowego (precyzja do 2^53)
			v += shift < 28 ? (byte & 0x7f) << shift : (byte & 0x7f) * 2 ** shift;
			shift += 7;
		} while (byte >= 0x80);
		return v;
	}
	svarint() {
		const v = this.varint();
		return v % 2 === 1 ? (v + 1) / -2 : v / 2;
	}
	skip(wire) {
		if (wire === 0) this.varint();
		else if (wire === 1) this.pos += 8;
		else if (wire === 2) this.pos += this.varint();
		else if (wire === 5) this.pos += 4;
		else throw new Error(`MVT: nieznany typ pola ${wire}`);
	}
	sub() {
		const len = this.varint();
		const r = new Reader(this.b);
		r.pos = this.pos;
		r.end = this.pos + len;
		this.pos += len;
		return r;
	}
	string() {
		const len = this.varint();
		const s = TEXT.decode(this.b.subarray(this.pos, this.pos + len));
		this.pos += len;
		return s;
	}
	packed() {
		const r = this.sub(), out = [];
		while (r.pos < r.end) out.push(r.varint());
		return out;
	}
}
const TEXT = new TextDecoder();

function value(r) {
	let v = null;
	while (r.pos < r.end) {
		const tag = r.varint(), field = tag >> 3, wire = tag & 7;
		if (field === 1) v = r.string();
		else if (field === 2) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; }
		else if (field === 3) { v = new DataView(r.b.buffer, r.b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; }
		else if (field === 4 || field === 5) v = r.varint();
		else if (field === 6) v = r.svarint();
		else if (field === 7) v = r.varint() !== 0;
		else r.skip(wire);
	}
	return v;
}

/** Polecenia geometrii MVT → ciągi współrzędnych (każde MoveTo zaczyna nowy ciąg). */
export function decodeGeometry(cmds) {
	const parts = [];
	let x = 0, y = 0, cur = null;
	for (let i = 0; i < cmds.length;) {
		const c = cmds[i++], id = c & 7, count = c >> 3;
		if (id === 1 || id === 2) {
			for (let k = 0; k < count; k++) {
				const dx = cmds[i++], dy = cmds[i++];
				x += (dx >> 1) ^ -(dx & 1);
				y += (dy >> 1) ^ -(dy & 1);
				if (id === 1) { cur = [x, y]; parts.push(cur); } else cur.push(x, y);
			}
		} else if (id === 7) {
			if (cur) cur.push(cur[0], cur[1]); // domknięcie pierścienia
		} else throw new Error(`MVT: nieznane polecenie ${id}`);
	}
	return parts;
}

function feature(r, keys, values) {
	const f = { id: 0, type: 0, props: {}, geom: null };
	let tags = [], cmds = [];
	while (r.pos < r.end) {
		const tag = r.varint(), field = tag >> 3, wire = tag & 7;
		if (field === 1) f.id = r.varint();
		else if (field === 2) tags = r.packed();
		else if (field === 3) f.type = r.varint();
		else if (field === 4) cmds = r.packed();
		else r.skip(wire);
	}
	for (let i = 0; i + 1 < tags.length; i += 2) f.props[keys[tags[i]]] = values[tags[i + 1]];
	f.geom = decodeGeometry(cmds);
	return f;
}

function layer(r, wanted) {
	const L = { name: '', extent: 4096, features: [] };
	const keys = [], values = [], raw = [];
	while (r.pos < r.end) {
		const tag = r.varint(), field = tag >> 3, wire = tag & 7;
		if (field === 1) L.name = r.string();
		else if (field === 2) raw.push(r.sub());
		else if (field === 3) keys.push(r.string());
		else if (field === 4) values.push(value(r.sub()));
		else if (field === 5) L.extent = r.varint();
		else r.skip(wire);
	}
	if (wanted && !wanted.has(L.name)) return L;
	for (const fr of raw) L.features.push(feature(fr, keys, values));
	return L;
}

/** Dekoduje kafel MVT. wanted – zbiór nazw warstw do zdekodowania (pozostałe tylko z nazwą). */
export function decodeTile(buf, wanted = null) {
	const r = new Reader(buf);
	const layers = {};
	while (r.pos < r.end) {
		const tag = r.varint(), field = tag >> 3, wire = tag & 7;
		if (field === 3) { const L = layer(r.sub(), wanted ? new Set(wanted) : null); layers[L.name] = L; } else r.skip(wire);
	}
	return { layers };
}

/** Pole pierścienia (ze znakiem; w układzie kafla y w dół – dodatnie = zgodnie z ruchem wskazówek zegara). */
export function ringArea(ring) {
	let a = 0;
	for (let i = 0; i + 3 < ring.length; i += 2) a += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
	return a / 2;
}
