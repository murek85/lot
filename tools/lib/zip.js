// Archiwum ZIP w Node (deflate z zlib, sumy CRC-32, katalog centralny, nazwy UTF-8) – bez dodatkowych pakietów.
// Pliki już skompresowane (np. .gz) zapisuje bez ponownej kompresji, gdy deflate nic by nie dał.
import zlib from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
export const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

// entries: [{ name: 'a/b.js', data: Buffer }] → Buffer z całym archiwum
export function zip(entries, now = new Date()) {
	const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
	const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
	const parts = [], central = [];
	let offset = 0;
	for (const { name: rel, data } of entries) {
		const packed = zlib.deflateRawSync(data, { level: 9 });
		const store = packed.length >= data.length;
		const body = store ? data : packed;
		const name = Buffer.from(rel, 'utf8'), crc = crc32(data);
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(store ? 0 : 8, 8);
		head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
		head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
		parts.push(head, name, body);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(store ? 0 : 8, 10);
		cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20);
		cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
		central.push(cd, name);
		offset += 30 + name.length + body.length;
	}
	const cdSize = central.reduce((a, b) => a + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, ...central, end]);
}
