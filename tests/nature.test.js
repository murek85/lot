import test from 'node:test';
import assert from 'node:assert/strict';
import { treeGeometry } from '../src/forest.js';
import { waveMap } from '../src/gfx/waves.js';

test('geometria drzewa: trzy kształty o tej samej topologii, pień i korona', () => {
	for (const sides of [4, 7]) {
		const g = treeGeometry(sides);
		const n = g.attributes.position.count;
		for (const name of ['aCone', 'aRound', 'aPart', 'aRel']) assert.equal(g.attributes[name].count, n);
		const part = g.attributes.aPart.array;
		assert.ok(part.includes(0) && part.includes(1));
		// wszystkie indeksy w zakresie, trójkąty pełne
		const idx = g.index.array;
		assert.equal(idx.length % 3, 0);
		assert.ok(Math.max(...idx) < n);
		// korona sosny zaczyna się w połowie wysokości, wierzchołek na 1
		const ys = [];
		for (let i = 0; i < n; i++) if (part[i] === 1) ys.push(g.attributes.position.getY(i));
		assert.ok(Math.min(...ys) >= 0.49 && Math.max(...ys) <= 1.0001);
	}
	assert.ok(treeGeometry(4).attributes.position.count < treeGeometry(7).attributes.position.count);
});

test('mapa fal: kafelkowana (krawędzie się zszywają) i zróżnicowana', () => {
	const n = 64;
	const m = waveMap(n, 3, 24);
	assert.equal(m.length, n * n * 4);
	// sąsiednie piksele przez krawędź kafelka różnią się tyle, co w środku – brak szwu
	const at = (x, y, c) => m[(y * n + x) * 4 + c];
	let edge = 0, inner = 0;
	for (let y = 0; y < n; y++) {
		edge += Math.abs(at(n - 1, y, 0) - at(0, y, 0));
		inner += Math.abs(at(n / 2, y, 0) - at(n / 2 + 1, y, 0));
	}
	assert.ok(edge < inner * 2.5 + n, `szew ${edge} vs ${inner}`);
	const r = [...m.filter((_, i) => i % 4 === 0)];
	assert.ok(Math.max(...r) - Math.min(...r) > 150);
});
