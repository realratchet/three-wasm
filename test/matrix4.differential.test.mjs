// Differential parity against pinned three.js 0.186.1: every Matrix4 method,
// with varied inputs, aliasing, return values, and side effects on arguments.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Matrix4 as WasmMatrix4 } from "../src/Matrix4.js";
import { stats } from "../src/backend.js";
import { assertSameElements, assertSameNumber, matrixInputs, mulberry32 } from "./helpers.mjs";

const CASES = 1400;
const ORDERS = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"];

function makeParams(rand) {

    const r = (s = 1) => (rand() * 2 - 1) * s;
    const pick = list => list[Math.floor(rand() * list.length)];

    let q = [r(), r(), r(), r()];
    if (rand() < 0.8) {
        const l = Math.hypot(...q) || 1;
        q = q.map(v => v / l);
    }

    const left = r(5), bottom = r(5), near = rand() * 10;

    return {
        c: Array.from({ length: 16 }, () => r(3)),
        v1: [r(1e3), r(1e3), r(1e3)],
        v2: [r(1e3), r(1e3), r(1e3)],
        scale: [r(4), r(4), rand() < 0.1 ? 0 : r(4)],
        up: pick([[0, 1, 0], [0, 0, 1], [0, 0, -1], [r(), r(), r()]]),
        q,
        euler: [r(7), r(7), r(7), pick(ORDERS)],
        angle: pick([0, -0, Math.PI, r(10), r(1e6)]),
        scalar: pick([0, -0, 1, -1, r(1e3), NaN, Infinity]),
        shear: Array.from({ length: 6 }, () => r()),
        frustum: [left, left + rand() * 5, bottom + rand() * 5, bottom, near, near + rand() * 1e4],
        coordinateSystem: pick([THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]),
        reversedDepth: rand() < 0.3,
        offset: Math.floor(rand() * 5)
    };
}

const v3 = a => new THREE.Vector3(...a);
const quat = a => new THREE.Quaternion(...a);

// Each op returns { target, ret, out } where out holds side-effect results.
const OPS = {
    set: (mk, a) => {
        const t = mk(); return { t, ret: t.set(...a) };
    },
    identity: (mk, a) => {
        const t = mk(a); return { t, ret: t.identity() };
    },
    clone: (mk, a) => {
        const s = mk(a); const c = s.clone(); return { t: c, ret: c, out: [c !== s, c.elements !== s.elements] };
    },
    copy: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.copy(mk(b)) };
    },
    copySelf: (mk, a) => {
        const t = mk(a); return { t, ret: t.copy(t) };
    },
    copyPosition: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.copyPosition(mk(b)) };
    },
    setFromMatrix3: (mk, a) => {
        const t = mk(a); return { t, ret: t.setFromMatrix3(new THREE.Matrix3().fromArray(a)) };
    },
    extractBasis: (mk, a) => {
        const t = mk(a); const x = v3([9, 9, 9]), y = v3([9, 9, 9]), z = v3([9, 9, 9]);
        return { t, ret: t.extractBasis(x, y, z), out: [x.toArray(), y.toArray(), z.toArray()] };
    },
    makeBasis: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeBasis(v3(p.v1), v3(p.v2), v3(p.scale)) };
    },
    extractRotation: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.extractRotation(mk(b)) };
    },
    extractRotationSelf: (mk, a) => {
        const t = mk(a); return { t, ret: t.extractRotation(t) };
    },
    makeRotationFromEuler: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationFromEuler(new THREE.Euler(...p.euler)) };
    },
    makeRotationFromQuaternion: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationFromQuaternion(quat(p.q)) };
    },
    lookAt: (mk, a, b, p) => {
        const t = mk(a);
        const eye = v3(p.v1), target = p.offset === 0 ? v3(p.v1) : v3(p.v2), up = v3(p.up);
        if (p.offset === 1) target.set(eye.x, eye.y + 5, eye.z);
        const ret = t.lookAt(eye, target, up);
        return { t, ret, out: [eye.toArray(), target.toArray(), up.toArray()] };
    },
    multiply: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.multiply(mk(b)) };
    },
    premultiply: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.premultiply(mk(b)) };
    },
    multiplyMatrices: (mk, a, b, p) => {
        const t = mk(p.c); return { t, ret: t.multiplyMatrices(mk(a), mk(b)) };
    },
    multiplyAliasA: (mk, a, b) => {
        const t = mk(a); return { t, ret: t.multiplyMatrices(t, mk(b)) };
    },
    multiplyAliasB: (mk, a, b) => {
        const t = mk(b); return { t, ret: t.multiplyMatrices(mk(a), t) };
    },
    multiplyAliasBoth: (mk, a) => {
        const t = mk(a); return { t, ret: t.multiplyMatrices(t, t) };
    },
    multiplySameOperands: (mk, a, b, p) => {
        const t = mk(p.c), s = mk(a); return { t, ret: t.multiplyMatrices(s, s) };
    },
    multiplyScalar: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.multiplyScalar(p.scalar) };
    },
    determinant: (mk, a) => {
        const t = mk(a); return { t, ret: t.determinant() };
    },
    determinantAffine: (mk, a) => {
        const t = mk(a); return { t, ret: t.determinantAffine() };
    },
    transpose: (mk, a) => {
        const t = mk(a); return { t, ret: t.transpose() };
    },
    setPositionVector: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.setPosition(v3(p.v1)) };
    },
    setPositionScalars: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.setPosition(...p.v1) };
    },
    invert: (mk, a) => {
        const t = mk(a); return { t, ret: t.invert() };
    },
    invertTwice: (mk, a) => {
        const t = mk(a); return { t, ret: t.invert().invert() };
    },
    scale: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.scale(v3(p.scale)) };
    },
    getMaxScaleOnAxis: (mk, a) => {
        const t = mk(a); return { t, ret: t.getMaxScaleOnAxis() };
    },
    makeTranslationVector: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeTranslation(v3(p.v1)) };
    },
    makeTranslationScalars: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeTranslation(...p.v1) };
    },
    makeRotationX: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationX(p.angle) };
    },
    makeRotationY: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationY(p.angle) };
    },
    makeRotationZ: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationZ(p.angle) };
    },
    makeRotationAxis: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeRotationAxis(v3(p.v1).normalize(), p.angle) };
    },
    makeScale: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeScale(...p.scale) };
    },
    makeShear: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeShear(...p.shear) };
    },
    compose: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.compose(v3(p.v1), quat(p.q), v3(p.scale)) };
    },
    composeThenDecompose: (mk, a, b, p) => {
        const t = mk(a).compose(v3(p.v1), quat(p.q), v3(p.scale));
        const pos = v3([7, 7, 7]), q = quat([7, 7, 7, 7]), s = v3([7, 7, 7]);
        let changes = 0;
        q._onChange(() => changes++);
        const ret = t.decompose(pos, q, s);
        return { t, ret, out: [pos.toArray(), q.toArray(), s.toArray(), changes] };
    },
    decompose: (mk, a) => {
        const t = mk(a);
        const pos = v3([7, 7, 7]), q = quat([7, 7, 7, 7]), s = v3([7, 7, 7]);
        let changes = 0;
        q._onChange(() => changes++);
        const ret = t.decompose(pos, q, s);
        return { t, ret, out: [pos.toArray(), q.toArray(), s.toArray(), changes] };
    },
    makePerspective: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makePerspective(...p.frustum, p.coordinateSystem, p.reversedDepth) };
    },
    makeOrthographic: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: t.makeOrthographic(...p.frustum, p.coordinateSystem, p.reversedDepth) };
    },
    equals: (mk, a, b, p) => {
        const t = mk(a); return { t, ret: [t.equals(mk(b)), t.equals(mk(a)), t.equals(t)] };
    },
    fromArrayOffset: (mk, a, b, p) => {
        const t = mk(); const src = [...Array(p.offset).fill(3), ...a];
        return { t, ret: t.fromArray(src, p.offset) };
    },
    toArray: (mk, a, b, p) => {
        const t = mk(a); const dst = Array(p.offset).fill(3);
        const ret = t.toArray(dst, p.offset);
        return { t, ret: ret === dst, out: [dst, t.toArray()] };
    },
    toArrayTyped: (mk, a) => {
        const t = mk(a); const dst = new Float32Array(20);
        t.toArray(dst, 4);
        return { t, ret: undefined, out: [Array.from(dst)] };
    }
};

function run(Mat, op, a, b, p) {

    const mk = arr => arr === undefined ? new Mat() : new Mat().fromArray(arr);
    const { t, ret, out } = op(mk, a, b, p);
    return { elements: t.elements, retIsTarget: ret === t, ret, out };
}

function compare(name, i, got, want) {

    const where = `${name} case ${i}`;
    assertSameElements(got.elements, want.elements, where);
    assert.equal(got.retIsTarget, want.retIsTarget, `${where}: return identity`);

    if (! want.retIsTarget) {
        if (typeof want.ret === "number") assertSameNumber(got.ret, want.ret, `${where}: return`);
        else assert.deepStrictEqual(got.ret, want.ret, `${where}: return`);
    }

    assert.deepStrictEqual(got.out, want.out, `${where}: side effects`);
}

test("prototype surface matches three", () => {
    const own = C => Object.getOwnPropertyNames(C.prototype).sort();
    assert.deepStrictEqual(own(WasmMatrix4), own(THREE.Matrix4));
    assert.equal(WasmMatrix4.prototype.isMatrix4, true);
    assert.deepStrictEqual(Object.keys(new WasmMatrix4()), Object.keys(new THREE.Matrix4()));
    assert.equal(WasmMatrix4.length, THREE.Matrix4.length);

    for (const name of own(THREE.Matrix4)) {
        const fn = THREE.Matrix4.prototype[name];
        if (typeof fn === "function") assert.equal(WasmMatrix4.prototype[name].length, fn.length, `${name}.length`);
    }

});

test("constructor arguments and default identity", () => {
    const args = Array.from({ length: 16 }, (_, i) => i * 1.5 - 4);
    assertSameElements(new WasmMatrix4(...args).elements, new THREE.Matrix4(...args).elements, "ctor args");
    assertSameElements(new WasmMatrix4().elements, new THREE.Matrix4().elements, "ctor default");

});

for (const [name, op] of Object.entries(OPS)) {
    test(`differential: ${name}`, () => {
        const rand = mulberry32(0x5eed ^ name.length * 7919);
        const inputs = [...matrixInputs(rand, CASES)];

        for (let i = 0; i < CASES; i++) {
            const a = inputs[i], b = inputs[(i * 7 + 3) % CASES];
            const p = makeParams(rand);
            compare(name, i, run(WasmMatrix4, op, a, b, p), run(THREE.Matrix4, op, a, b, p));
        }

    });
}

test("invalid coordinate system throws identically", () => {
    for (const method of ["makePerspective", "makeOrthographic"]) {
        const want = assert.throws(() => new THREE.Matrix4()[method](-1, 1, 1, -1, 1, 10, 1234));
        assert.throws(() => new WasmMatrix4()[method](-1, 1, 1, -1, 1, 10, 1234), { message: /Invalid coordinate system: 1234/ });
        void want;
    }

});

test("kernels ran without JS fallback for WASM-backed operands", () => {
    assert.equal(stats().fallbacks.matrix4Multiply, 0);

});

// Kernels not routed per call (no measured win) are kept for bulk paths and
// must stay exact, so they are checked directly against three.
test("direct kernels: invert, determinant, compose", async () => {
    const { SLOT_PTR, kernels } = await import("../src/backend.js");
    const rand = mulberry32(0xC0DE);
    const inputs = [...matrixInputs(rand, CASES)];

    for (let i = 0; i < CASES; i++) {
        const w = new WasmMatrix4().fromArray(inputs[i]), t = new THREE.Matrix4().fromArray(inputs[i]);
        assertSameNumber(kernels.m4Determinant(w[SLOT_PTR]), t.determinant(), `determinant case ${i}`);

        kernels.m4Invert(w[SLOT_PTR]); t.invert();
        assertSameElements(w.elements, t.elements, `invert case ${i}`);

        const p = makeParams(rand);
        kernels.m4Compose(w[SLOT_PTR], ...p.v1, ...p.q, ...p.scale);
        t.compose(v3(p.v1), quat(p.q), v3(p.scale));
        assertSameElements(w.elements, t.elements, `compose case ${i}`);
    }

});
