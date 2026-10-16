// Lazy Euler parity: an Euler/Quaternion pair wired exactly like Object3D,
// driven by long random op sequences that interleave quaternion writes (some
// bypassing callbacks), Euler writes, order changes and reads. Values and
// callback counts must match stock three after every step.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Euler as LazyEuler } from "../src/Euler.js";
import { assertSameNumber, mulberry32 } from "./helpers.mjs";

const ORDERS = ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"];

function wire(EulerClass) {

    const rotation = new EulerClass(), quaternion = new THREE.Quaternion();
    const counts = { rotation: 0, quaternion: 0 };
    rotation._onChange(() => {
        counts.rotation++; quaternion.setFromEuler(rotation, false);

    });
    quaternion._onChange(() => {
        counts.quaternion++; rotation.setFromQuaternion(quaternion, undefined, false);

    });
    return { rotation, quaternion, counts };
}

function makeOps(rand) {

    const r = (s = 1) => (rand() * 2 - 1) * s;
    const pick = list => list[Math.floor(rand() * list.length)];
    const special = () => pick([0, -0, 1, -1, NaN, Infinity, 0.9999999, -0.99999995]);
    const quatValues = () => {
        if (rand() < 0.05) return [special(), special(), special(), special()];
        if (rand() < 0.15) {
            // Near gimbal lock for some order.
            const a = Math.PI / 2 + r(1e-6);
            return new THREE.Quaternion().setFromEuler(new THREE.Euler(r(), a, r(), pick(ORDERS))).toArray();
        }

        const q = [r(), r(), r(), r()];
        if (rand() < 0.8) {
            const l = Math.hypot(...q) || 1; return q.map(v => v / l);
        }

        return q;
    };

    // Each op is applied identically to both sides; args are drawn once.
    return [
        () => {
            const v = quatValues(); return s => s.quaternion.set(...v);
        },
        () => {
            const v = quatValues(); return s => s.quaternion.fromArray(v);
        },
        () => {
            const v = r(4), k = pick(["_x", "_y", "_z", "_w"]); return s => {
                s.quaternion[k] = v;
            }; // bypasses callbacks
        },
        () => {
            const v = r(2), k = pick(["x", "y", "z", "w"]); return s => {
                s.quaternion[k] = v;
            };
        },
        () => {
            const axis = new THREE.Vector3(r(), r(), r()).normalize(), a = r(7); return s => s.quaternion.setFromAxisAngle(axis, a);
        },
        () => {
            const v = quatValues(), t = rand(); return s => s.quaternion.slerp(new THREE.Quaternion(...v), t);
        },
        () => {
            const v = quatValues(); return s => s.quaternion.multiply(new THREE.Quaternion(...v));
        },
        () => s => s.quaternion.normalize(),
        () => s => s.quaternion.invert(),
        () => {
            const e = [r(4), r(4), r(4), pick(ORDERS)]; return s => s.quaternion.setFromEuler(new THREE.Euler(...e));
        },
        () => {
            const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...quatValues())); return s => s.quaternion.setFromRotationMatrix(m);
        },
        () => {
            const v = r(4), k = pick(["x", "y", "z"]); return s => {
                s.rotation[k] = v;
            };
        },
        () => {
            const v = r(4), k = pick(["_x", "_y", "_z"]); return s => {
                s.rotation[k] = v;
            }; // bypasses callbacks
        },
        () => {
            const o = pick(ORDERS); return s => {
                s.rotation.order = o;
            };
        },
        () => {
            const o = pick(ORDERS); return s => {
                s.rotation._order = o;
            }; // bypasses callbacks
        },
        () => {
            const e = [r(4), r(4), r(4), pick([...ORDERS, undefined])]; return s => s.rotation.set(...e);
        },
        () => {
            const e = [r(4), r(4), r(4), ...(rand() < 0.5 ? [pick(ORDERS)] : [])]; return s => s.rotation.fromArray(e);
        },
        () => {
            const e = [r(4), r(4), r(4), pick(ORDERS)]; return s => s.rotation.copy(new THREE.Euler(...e));
        },
        () => s => s.rotation.copy(s.rotation),
        () => {
            const v = new THREE.Vector3(r(4), r(4), r(4)), o = pick([...ORDERS, undefined]); return s => s.rotation.setFromVector3(v, o);
        },
        () => {
            const o = pick(ORDERS); return s => s.rotation.reorder(o);
        },
        () => {
            const v = quatValues(), o = pick([...ORDERS, undefined]), u = pick([false, undefined, true]);
            return s => s.rotation.setFromQuaternion(new THREE.Quaternion(...v), o, u);
        },
        () => {
            const m = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion(...quatValues()), new THREE.Vector3(1, 1, 1)), o = pick([...ORDERS, undefined]), u = pick([false, undefined, true]);
            return s => s.rotation.setFromRotationMatrix(m, o, u);
        },
        () => {
            // Snapshot semantics: mutate the quaternion silently after a lazy set.
            const v = quatValues(), w = r(3);
            return s => {
                s.quaternion.set(...v); s.quaternion._z = w;
            };
        }
    ];
}

function observe(s) {

    const e = s.rotation, q = s.quaternion;
    return {
        euler: [e.x, e.y, e.z, e.order, e._x, e._y, e._z, e._order],
        array: e.toArray(),
        iter: [...e],
        quaternion: [q._x, q._y, q._z, q._w],
        counts: { ...s.counts }
    };
}

function assertSameObservation(got, want, where) {

    for (const key of ["euler", "array", "iter", "quaternion"]) {
        for (let i = 0; i < want[key].length; i++) {
            const a = got[key][i], b = want[key][i];
            if (typeof b === "number") assertSameNumber(a, b, `${where} ${key}[${i}]`);
            else assert.equal(a, b, `${where} ${key}[${i}]`);
        }
    }

    assert.deepStrictEqual(got.counts, want.counts, `${where} callback counts`);
}

test("prototype surface covers three Euler", () => {
    const names = C => Reflect.ownKeys(C.prototype);
    for (const name of names(THREE.Euler)) {
        assert.ok(Reflect.has(LazyEuler.prototype, name), `missing ${String(name)}`);
        const fn = Object.getOwnPropertyDescriptor(THREE.Euler.prototype, name).value;
        if (typeof fn === "function") assert.equal(LazyEuler.prototype[name].length, fn.length, `${String(name)}.length`);
    }

    assert.equal(LazyEuler.DEFAULT_ORDER, "XYZ");
    assert.equal(new LazyEuler().isEuler, true);
    assert.deepStrictEqual([...new LazyEuler(1, 2, 3, "ZYX")], [...new THREE.Euler(1, 2, 3, "ZYX")]);

    // Documented difference: component storage is not enumerable.
    assert.deepStrictEqual(Object.keys(new LazyEuler()), ["isEuler", "_order"]);

});

test("random Object3D-style op sequences match three, observed at random points", () => {
    const warn = console.warn;
    console.warn = () => {};

    try {
        for (let seq = 0; seq < 400; seq++) {
            const rand = mulberry32(1000 + seq);
            const ops = makeOps(rand);
            const lazy = wire(LazyEuler), stock = wire(THREE.Euler);

            for (let step = 0; step < 60; step++) {
                const apply = ops[Math.floor(rand() * ops.length)]();
                const retLazy = apply(lazy), retStock = apply(stock);
                assert.equal(retLazy === lazy.rotation, retStock === stock.rotation, `seq ${seq} step ${step}: return identity`);

                // Observing resolves pending state, so sometimes skip it to let
                // several lazy writes stack up before the next read.
                if (rand() < 0.3 || step === 59) assertSameObservation(observe(lazy), observe(stock), `seq ${seq} step ${step}`);
            }
        }
    } finally {
        console.warn = warn;
    }

});

test("clone and equals see resolved values", () => {
    const lazy = wire(LazyEuler), stock = wire(THREE.Euler);
    for (const s of [lazy, stock]) s.quaternion.set(0.1, 0.7, -0.2, 0.6).normalize();

    const a = lazy.rotation.clone(), b = stock.rotation.clone();
    assert.deepStrictEqual(a.toArray(), b.toArray());
    assert.ok(a instanceof LazyEuler);

    lazy.quaternion.set(0.5, 0.5, 0.5, 0.5);
    stock.quaternion.set(0.5, 0.5, 0.5, 0.5);
    assert.equal(lazy.rotation.equals(new LazyEuler().setFromQuaternion(lazy.quaternion)), stock.rotation.equals(new THREE.Euler().setFromQuaternion(stock.quaternion)));

});

test("unknown order warns at the same time as three", () => {
    const calls = [];
    const warn = console.warn;
    console.warn = (...args) => calls.push(args.join(" "));

    try {
        const lazy = wire(LazyEuler), stock = wire(THREE.Euler);
        for (const s of [lazy, stock]) {
            s.quaternion.set(0, 0.6, 0, 0.8);
            s.rotation.setFromQuaternion(s.quaternion, "BAD", false);
            calls.push("|");
        }

        assert.equal(calls.filter(c => c.includes("unknown order: BAD")).length, 2);
        assert.deepStrictEqual(calls.map(c => c === "|"), [false, true, false, true]);
        assert.deepStrictEqual(observe(lazy).euler, observe(stock).euler);
    } finally {
        console.warn = warn;
    }

});
