// One Euler variant per fresh process. Both variants import three from src/;
// the lazy variant is selected by the resolve hook (THREE_WASM_SWAP=Euler).
import * as THREE from "three/src/Three.js";

const lazy = Object.getOwnPropertyDescriptor(THREE.Euler.prototype, "_x") !== undefined;
const N = 4096;
let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1;
const vals = new Float32Array(N * 4);
for (let i = 0; i < N; i++) vals.set(new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize().toArray(), i * 4);
const objs = Array.from({ length: N }, () => new THREE.Object3D());
let sink = 0, flip = 0;

// Skinned crowd: 40 pawns x 64 bones driven by AnimationMixer (stock three).
function makePawn() {

    const bones = [];
    for (let i = 0; i < 64; i++) {
        const b = new THREE.Bone(); b.name = `b${i}`; b.position.set(rnd(), rnd(), rnd());
        if (i) bones[(i - 1) >> 1].add(b);
        bones.push(b);
    }

    const tracks = [];
    for (let i = 0; i < 64; i++) {
        const times = [0, 0.25, 0.5, 0.75, 1];
        tracks.push(new THREE.QuaternionKeyframeTrack(`b${i}.quaternion`, times, times.flatMap(() => new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize().toArray())));
    }

    const mixer = new THREE.AnimationMixer(bones[0]);
    mixer.clipAction(new THREE.AnimationClip("c", 1, tracks)).play();
    return { root: bones[0], mixer };
}

const pawns = Array.from({ length: 40 }, makePawn);

const workloads = {
    quaternionWrite: [N, () => {
        const o = (flip ^= 4);
        for (let i = 0; i < N; i++) objs[i].quaternion.fromArray(vals, ((i * 4) + o) % (N * 4));
    }],
    quaternionWriteThenReadRotation: [N, () => {
        const o = (flip ^= 4);
        for (let i = 0; i < N; i++) {
            const obj = objs[i]; obj.quaternion.fromArray(vals, ((i * 4) + o) % (N * 4)); sink += obj.rotation.x;
        }
    }],
    rotationSetterWrite: [N, () => {
        for (let i = 0; i < N; i++) objs[i].rotation.y += 0.001;
    }],
    object3DConstruct: [N, () => {
        for (let i = 0; i < N; i++) sink += new THREE.Object3D().id & 1;
    }],
    mixerCrowdFrame: [40 * 64, () => {
        for (const p of pawns) {
            p.mixer.update(1 / 60); p.root.updateMatrixWorld(true);
        }
    }]
};

const yieldTask = () => new Promise(resolve => setImmediate(resolve));
const results = {};
for (const [name, [ops, fn]] of Object.entries(workloads)) {
    for (let w = 0; w < 40; w++) {
        fn(); await yieldTask();
    }

    const samples = [];
    for (let it = 0; it < 200; it++) {
        const t0 = process.hrtime.bigint(); fn();
        samples.push(Number(process.hrtime.bigint() - t0) / ops);
        await yieldTask();
    }

    samples.sort((a, b) => a - b);
    results[name] = samples[samples.length >> 1];
}

console.log(JSON.stringify({ lazy, results, sink: Number.isFinite(sink) }));
