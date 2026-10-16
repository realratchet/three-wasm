// `.elements` view semantics, foreign operands, slot reclamation, exhaustion
// and the bulk multiply path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { Matrix4 } from "../src/Matrix4.js";
import { multiplyMatricesList } from "../src/batch.js";
import { fallbacks, matrix4Pool, memory } from "../src/backend.js";
import { assertSameElements, matrixInputs, mulberry32 } from "./helpers.mjs";

async function collect() {

    // FinalizationRegistry callbacks run as tasks after a GC.
    for (let i = 0; i < 4; i++) {
        globalThis.gc();
        await delay(0);
    }
}

test("elements is a stable Float64Array view into WASM memory", () => {
    const m = new Matrix4();
    const e = m.elements;

    assert.ok(e instanceof Float64Array);
    assert.equal(e.length, 16);
    assert.equal(e.buffer, memory.buffer);
    assert.equal(Array.isArray(e), false, "documented difference from three");

    m.makeRotationX(1).multiply(new Matrix4().makeTranslation(1, 2, 3)).invert();
    assert.equal(m.elements, e, "identity preserved across kernel calls");

    e[12] = 42;
    assert.equal(m.elements[12], 42, "direct element writes are visible");

});

test("assigning a plain array keeps working through the counted JS path", () => {
    const rand = mulberry32(99);
    const [a, b] = matrixInputs(rand, 2);
    const before = fallbacks.matrix4Multiply;

    const w = new Matrix4();
    const plain = [...a];
    w.elements = plain;
    const t = new THREE.Matrix4().fromArray(a);

    assert.equal(w.elements, plain, "assignment replaces identity, as in three");

    w.multiply(new Matrix4().fromArray(b));
    t.multiply(new THREE.Matrix4().fromArray(b));
    assertSameElements(w.elements, t.elements, "multiply on plain elements");
    assert.equal(w.elements, plain);
    assert.equal(fallbacks.matrix4Multiply, before + 1);

    w.invert(); t.invert();
    assertSameElements(w.elements, t.elements, "invert on plain elements");
    assert.equal(w.determinant(), t.determinant());

    w.compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion(0, 0.6, 0, 0.8), new THREE.Vector3(1, -2, 3));
    t.compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion(0, 0.6, 0, 0.8), new THREE.Vector3(1, -2, 3));
    assertSameElements(w.elements, t.elements, "compose on plain elements");

});

test("three matrices are accepted as operands via the JS path", () => {
    const w = new Matrix4().makeRotationY(0.3);
    const t = new THREE.Matrix4().makeRotationY(0.3);
    const other = new THREE.Matrix4().makeScale(2, -1, 0.5);

    w.multiply(other); t.multiply(other);
    assertSameElements(w.elements, t.elements, "three operand");
    assert.ok(t.multiply(new Matrix4().makeTranslation(1, 1, 1)), "three accepts ours too");

});

test("typed-array behaviour differences are explicit", () => {
    const m = new Matrix4();

    // Non-number values coerce on store, unlike a plain array.
    m.set(1, 2, 3);
    assert.ok(Number.isNaN(m.elements[3]), "undefined arguments become NaN");

    // Structured clone of the view copies only 16 elements' worth of the buffer slice.
    const cloned = structuredClone(m.elements);
    assert.equal(cloned.length, 16);
    assert.equal(cloned.buffer.byteLength, memory.buffer.byteLength, "structured clone copies the whole WASM buffer");

    assert.deepStrictEqual(m.toArray(), Array.from(m.elements), "toArray returns a plain array");
    assert.ok(Array.isArray(m.toArray()));

});

test("unreachable matrices return their slots; live count plateaus", async () => {
    await collect();
    const baseLive = matrix4Pool.live;

    for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 50000; i++) new Matrix4().makeRotationZ(i);
        await collect();
    }

    const s = matrix4Pool.stats();
    assert.ok(s.reclaimed >= 240000, `reclaimed ${s.reclaimed}`);
    assert.ok(s.live - baseLive < 1000, `live grew by ${s.live - baseLive}`);
    assert.ok(s.touchedBytes < 100000 * 128, `touched ${s.touchedBytes} bytes; slots are reused`);

});

test("a retained view keeps its slot after its matrix dies", async () => {
    const retained = (() => new Matrix4().makeTranslation(11, 22, 33).elements)();
    const snapshot = Array.from(retained);

    await collect();
    const churn = [];
    for (let i = 0; i < 20000; i++) churn.push(new Matrix4().makeScale(-i, i, i));

    assert.deepStrictEqual(Array.from(retained), snapshot);
    for (const m of churn) assert.notEqual(m.elements.byteOffset, retained.byteOffset);

});

test("pool exhaustion overflows to counted heap matrices instead of growing memory", () => {
    const dir = fileURLToPath(new URL("../src/", import.meta.url));
    const script = `
        globalThis.__THREE_WASM_CONFIG__ = { matrix4Capacity: 8 };
        const { Matrix4 } = await import(${JSON.stringify(dir + "Matrix4.js")});
        const { stats } = await import(${JSON.stringify(dir + "backend.js")});
        const memoryBytes = stats().memoryBytes;
        const keep = [];
        for (let i = 0; i < 9; i++) keep.push(new Matrix4().makeTranslation(i, 2 * i, 3 * i));
        const heap = keep.filter(m => m.elements.buffer.byteLength === 128);
        const product = new Matrix4().multiplyMatrices(keep[8], keep[1]);
        const s = stats();
        console.log(heap.length, s.matrix4.overflowed, s.fallbacks.matrix4Multiply, Array.from(product.elements.slice(12, 15)).join(','), s.memoryBytes === memoryBytes);
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script]).toString().trim();
    // Module-level temporaries in Matrix4.js occupy one slot: 7 pooled, then 2 + the product overflow.
    assert.equal(out, "2 3 1 9,18,27 true");

});

test("multiplyMatricesList matches sequential three, including dependent entries", () => {
    const rand = mulberry32(7);
    const inputs = [...matrixInputs(rand, 600)];
    const n = 3000;

    const wm = inputs.map(e => new Matrix4().fromArray(e));
    const tm = inputs.map(e => new THREE.Matrix4().fromArray(e));
    const pick = () => Math.floor(rand() * inputs.length);
    const triples = Array.from({ length: n }, () => [pick(), pick(), pick()]);

    multiplyMatricesList(triples.map(x => wm[x[0]]), triples.map(x => wm[x[1]]), triples.map(x => wm[x[2]]));
    for (const [t, a, b] of triples) tm[t].multiplyMatrices(tm[a], tm[b]);

    for (let i = 0; i < inputs.length; i++) assertSameElements(wm[i].elements, tm[i].elements, `batch matrix ${i}`);

    assert.throws(() => multiplyMatricesList([new THREE.Matrix4()], [wm[0]], [wm[1]]), TypeError);

});
