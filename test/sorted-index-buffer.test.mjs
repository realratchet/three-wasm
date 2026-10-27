import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SortedIndexBuffer } from "../src/SortedIndexBuffer.js";
import { kernels, memory, sortedIndexPool } from "../src/backend.js";
import { BufferPool } from "../src/buffer-pool.js";

const native = JSON.parse(readFileSync(new URL("./fixtures/sorted-index-native.json", import.meta.url)));

function sort(keys, stable) {
    const block = sortedIndexPool.allocate(keys.length * 12);
    try {
        const input = sortedIndexPool.view(Int32Array, block, 0, keys.length), order = sortedIndexPool.view(Uint32Array, block, keys.length * 4, keys.length), scratch = sortedIndexPool.view(Uint32Array, block, keys.length * 8, keys.length);
        input.set(keys); for (let i = 0; i < keys.length; i++) order[i] = i;
        kernels.sortedIndexSort(input.byteOffset, order.byteOffset, scratch.byteOffset, keys.length, stable);
        return Array.from(order);
    } finally { sortedIndexPool.release(block); }
}

test("retained native signed-wrap orders", () => {
    for (const row of native) assert.deepEqual(sort(row.keys, false), row.order);
});

test("stable radix keys, ties and skipped bytes", () => {
    let seed = 0x51f29a;
    for (const count of [0,1,2,7,8,9,31,255,256,257,800,1814,4096,7,256]) for (const pattern of ["equal","low","middle","high","random"]) {
        const keys = new Int32Array(count);
        for (let i = 0; i < count; i++) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            keys[i] = pattern === "equal" ? -2147483648 : pattern === "low" ? seed & 255 : pattern === "middle" ? (seed & 255) << 8 : pattern === "high" ? -2147483648 + ((seed & 255) << 16) : (seed >>> 0) % 1000000;
        }
        assert.deepEqual(sort(keys, true), Array.from(keys, (_,i) => i).sort((a,b) => keys[b] - keys[a] || a - b));
    }
});

test("exact float keys, source triangles and independent views", () => {
    const positions = new Float32Array([.5,.5,0, 1,.5,.5, 1.5,.5,0, 1.5,1,1, 65536,0,0, NaN,0,0]);
    const source = new Uint16Array([11,12,13, 12,13,14, 15,15,16]);
    const geometry = new SortedIndexBuffer(positions,source,11), main = geometry.createState(), auxiliary = geometry.createState(), buffer = memory.buffer;
    try {
        assert.equal(geometry.vertexCount, 6);
        assert.equal(main.geometry, auxiliary.geometry);
        assert.notEqual(main.vertexKeys, auxiliary.vertexKeys);
        assert.equal(main.apply(0,0,0,true), true);
        assert.deepEqual(Array.from(main.vertexKeys), [0,2,2,4,-2147483648,-2147483648]);
        assert.deepEqual(Array.from(main.keys), [2,4,-2147483648]);
        assert.deepEqual(Array.from(main.order), [2,1,0]);
        assert.deepEqual(Array.from(main.indices), [15,15,16,12,13,14,11,12,13]);
        const indices = main.indices.slice();
        auxiliary.apply(2,0,0,true);
        assert.deepEqual(main.indices, indices);
        assert.equal(memory.buffer, buffer);
        assert.equal(main.indices.buffer, memory.buffer);
        assert.equal(main.apply(0,0,0,false), true);
    } finally { geometry.dispose(); }
    assert.throws(() => main.apply(0,0,0,true), /disposed/);
    assert.throws(() => geometry.createState(), /disposed/);
    geometry.dispose();
    assert.equal(sortedIndexPool.stats().liveBytes, 0);
});

test("buffer pool coalesces freed blocks and rejects exhaustion", () => {
    const pool = new BufferPool(new WebAssembly.Memory({initial:1}),0,256), a = pool.allocate(64), b = pool.allocate(64), c = pool.allocate(128);
    assert.throws(() => pool.allocate(16), /exhausted/);
    pool.release(b); pool.release(a); pool.release(c); pool.release(c);
    assert.equal(pool.stats().liveBytes, 0);
    assert.equal(pool.stats().freeBlocks, 1);
    const whole = pool.allocate(256); assert.equal(whole.ptr, 0); pool.release(whole);
    assert.throws(() => new SortedIndexBuffer(new Float32Array(3),new Uint32Array([0])), /index count/);
    assert.throws(() => new SortedIndexBuffer(new Float32Array(3),new Uint32Array([1,1,1])), /vertex/);
});

test("retained output keeps its block until the view is collected", async () => {
    let output;
    function allocate() {
        const geometry = new SortedIndexBuffer(new Float32Array([0,0,0]),new Uint32Array([0,0,0])), state = geometry.createState();
        state.apply(0,0,0,true); output = state.indices;
        return state.block.bytes;
    }
    const retainedBytes = allocate();
    for (let i = 0; i < 12; i++) { globalThis.gc(); await delay(0); }
    assert.equal(sortedIndexPool.stats().liveBytes, retainedBytes);
    assert.deepEqual(Array.from(output), [0,0,0]);
    output = null;
    for (let i = 0; i < 12; i++) { globalThis.gc(); await delay(0); }
    assert.equal(sortedIndexPool.stats().liveBytes, 0);
});
