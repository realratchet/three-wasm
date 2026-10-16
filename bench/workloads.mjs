// One benchmark variant per fresh process: `node bench/workloads.mjs <variant>`.
// Variants:
//   three        stock three Matrix4, plain Array elements (baseline)
//   three-f64    stock three Matrix4 code over Float64Array elements
//   wasm         WASM-backed Matrix4, per-call kernels
// Prints JSON { variant, results: { workload: nsPerOp } }.
import * as THREE from "three";

const variant = process.argv[2];
const N = 4096, ITER = 200;

let Matrix4 = THREE.Matrix4, backend = null, batch = null;
if (variant === "wasm") {
    // GC-driven reclamation lags churn (see docs); constructAndDrop needs headroom.
    globalThis.__THREE_WASM_CONFIG__ = { matrix4Capacity: 1 << 21 };

    ({ Matrix4 } = await import("../src/Matrix4.js"));
    backend = await import("../src/backend.js");
    batch = await import("../src/batch.js");
}

function make() {

    const m = new Matrix4();
    if (variant === "three-f64") m.elements = new Float64Array(m.elements);
    return m;
}

let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const mats = Array.from({ length: N }, () => make().compose(
    new THREE.Vector3(rand() * 1e4, rand() * 1e2, rand() * 1e4),
    new THREE.Quaternion(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    new THREE.Vector3(0.5 + rand(), 0.5 + rand(), 0.5 + rand())));
const idx = Uint32Array.from({ length: N * 3 }, () => Math.floor(rand() * N));
const positions = mats.map(() => new THREE.Vector3(rand(), rand(), rand()));
const quats = mats.map(() => new THREE.Quaternion(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
const scales = mats.map(() => new THREE.Vector3(1 + rand(), 1, 1 - rand() / 2));
const outP = new THREE.Vector3(), outQ = new THREE.Quaternion(), outS = new THREE.Vector3();

let sink = 0;

const workloads = {
    multiplyMatrices() {

        for (let i = 0; i < N; i++) mats[idx[i * 3]].multiplyMatrices(mats[idx[i * 3 + 1]], mats[idx[i * 3 + 2]]);
    },
    multiplyInPlace() {

        for (let i = 0; i < N; i++) mats[i].multiply(mats[idx[i]]);
    },
    invert() {

        for (let i = 0; i < N; i++) mats[i].invert();
    },
    compose() {

        for (let i = 0; i < N; i++) mats[i].compose(positions[i], quats[i], scales[i]);
    },
    decompose() {

        for (let i = 0; i < N; i++) mats[i].decompose(outP, outQ, outS);
        sink += outP.x;
    },
    determinant() {

        for (let i = 0; i < N; i++) sink += mats[i].determinant();
    },
    copy() {

        for (let i = 0; i < N; i++) mats[i].copy(mats[idx[i]]);
    },
    readElements() {

        for (let i = 0; i < N; i++) {
            const e = mats[i].elements; sink += e[0] + e[5] + e[10] + e[12];
        }
    },
    constructAndDrop() {

        for (let i = 0; i < N; i++) sink += new Matrix4().elements[0];
    }
};

if (batch) {
    const t = [], a = [], b = [];
    for (let i = 0; i < N; i++) {
        t.push(mats[idx[i * 3]]); a.push(mats[idx[i * 3 + 1]]); b.push(mats[idx[i * 3 + 2]]);
    }

    workloads.multiplyMatricesList = () => batch.multiplyMatricesList(t, a, b);
}

// Keep values bounded so repeated in-place ops don't drift into Inf/NaN,
// which would change the work being measured.
function renormalize() {

    for (let i = 0; i < N; i++) mats[i].compose(positions[i], quats[i], scales[i]);
}

const yieldTask = () => new Promise(resolve => setImmediate(resolve));

const results = {};
for (const [name, fn] of Object.entries(workloads)) {
    for (let w = 0; w < 30; w++) {
        fn(); renormalize();
        await yieldTask();
    }

    const samples = [];
    for (let it = 0; it < ITER; it++) {
        renormalize();
        const t0 = process.hrtime.bigint();
        fn();
        samples.push(Number(process.hrtime.bigint() - t0) / N);
        // Like a frame boundary: lets FinalizationRegistry reclaim slots.
        await yieldTask();
    }

    samples.sort((x, y) => x - y);
    results[name] = samples[samples.length >> 1];
}

const out = { variant, results, sink: Number.isFinite(sink) };
if (backend) out.fallbacks = backend.stats().fallbacks;
console.log(JSON.stringify(out));
