import { BufferPool } from "./buffer-pool.js";
import { buildInfo, wasmBase64 } from "./generated/math-wasm.js";

const PAGE_BYTES = 65536;
const MATRIX4_BYTES = 128;
const LIST_ENTRY_BYTES = 12;

const config = Object.assign({
    matrix4Capacity: 262144, // 32 MiB of matrices
    sortedIndexBytes: 33554432,
    multiplyListCapacity: 65536 // 768 KiB of (target, a, b) pointer triples
}, globalThis.__THREE_WASM_CONFIG__); // set before the first import

const STATIC_RESERVE = PAGE_BYTES; // static data must fit in the first page
const matrix4Base = STATIC_RESERVE;
const listBase = matrix4Base + config.matrix4Capacity * MATRIX4_BYTES;
const sortedIndexBase = Math.ceil((listBase + config.multiplyListCapacity * LIST_ENTRY_BYTES) / 16) * 16;
const reservedBytes = sortedIndexBase + config.sortedIndexBytes;
const pages = Math.ceil(reservedBytes / PAGE_BYTES);

const memory = new WebAssembly.Memory({ initial: pages, maximum: pages }); // never grows: growing detaches retained views

function decodeBase64(text) {

    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const { instance } = await WebAssembly.instantiate(decodeBase64(wasmBase64), { env: { memory } }); // top-level await so importers' module-level temporaries get slots
const kernels = instance.exports;

if (kernels.heapBase() > STATIC_RESERVE) {
    throw new Error(`three-wasm: static data (${kernels.heapBase()} bytes) exceeds reserve (${STATIC_RESERVE})`);
}

class SlotPool {
    constructor(name, base, slotBytes, capacity) {

        this.name = name;
        this.base = base;
        this.slotBytes = slotBytes;
        this.capacity = capacity;

        this._free = new Uint32Array(capacity);
        this._freeCount = 0;
        this._bump = 0;

        this.live = 0;
        this.highWater = 0;
        this.allocations = 0;
        this.reclaimed = 0;
        this.overflowed = 0;

        this._registry = new FinalizationRegistry(ptr => this._release(ptr)); // targets are views, not owners: a retained view keeps its slot
    }

    allocate() {

        let ptr;

        if (this._freeCount > 0) {
            ptr = this._free[--this._freeCount];
        } else if (this._bump < this.capacity) {
            ptr = this.base + this._bump * this.slotBytes;
            this._bump++;
        } else {
            this.overflowed++; // reclamation trails major GCs; caller falls back to heap storage
            return -1;
        }

        this.live++;
        this.allocations++;
        if (this.live > this.highWater) this.highWater = this.live;

        return ptr;
    }

    track(view, ptr) {

        this._registry.register(view, ptr);
    }

    _release(ptr) {

        this._free[this._freeCount++] = ptr;
        this.live--;
        this.reclaimed++;
    }

    stats() {

        return {
            capacity: this.capacity,
            slotBytes: this.slotBytes,
            reservedBytes: this.capacity * this.slotBytes,
            touchedBytes: this._bump * this.slotBytes,
            freeListBytes: this._free.byteLength,
            live: this.live,
            highWater: this.highWater,
            allocations: this.allocations,
            reclaimed: this.reclaimed,
            overflowed: this.overflowed
        };
    }
}

const SLOT_VIEW = Symbol("three-wasm.view"); // symbols keep the public shape identical to three's
const SLOT_PTR = Symbol("three-wasm.ptr");

const matrix4Pool = new SlotPool("Matrix4", matrix4Base, MATRIX4_BYTES, config.matrix4Capacity);

const sortedIndexPool = new BufferPool(memory, sortedIndexBase, config.sortedIndexBytes);

const fallbacks = { // ops that ran in JS for lack of a WASM slot; benchmarks assert zero
    matrix4Multiply: 0
};

function stats() {

    return {
        buildInfo,
        memoryBytes: memory.buffer.byteLength,
        reservedBytes,
        matrix4: matrix4Pool.stats(),
        sortedIndex: sortedIndexPool.stats(),
        multiplyListCapacity: config.multiplyListCapacity,
        fallbacks: { ...fallbacks }
    };
}

const listView = new Uint32Array(memory.buffer, listBase, config.multiplyListCapacity * 3);

export { SLOT_PTR, SLOT_VIEW, buildInfo, config, fallbacks, kernels, listBase, listView, matrix4Pool, memory, sortedIndexPool, stats };
