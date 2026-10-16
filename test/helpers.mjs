import assert from "node:assert/strict";

// Deterministic PRNG so failures reproduce from the printed case index.
export function mulberry32(seed) {

    return function () {

        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Exact parity: Object.is distinguishes -0 and treats NaN as equal to NaN.
export function assertSameElements(actual, expected, message) {

    assert.equal(actual.length, expected.length, `${message}: length`);

    for (let i = 0; i < expected.length; i++) {
        if (! Object.is(actual[i], expected[i])) {
            assert.fail(`${message}: element ${i} is ${actual[i]}, expected ${expected[i]}\n` +
                `actual   ${Array.from(actual)}\nexpected ${Array.from(expected)}`);
        }
    }
}

export function assertSameNumber(actual, expected, message) {

    if (! Object.is(actual, expected)) assert.fail(`${message}: ${actual} !== ${expected}`);
}

const SPECIAL = [0, -0, 1, -1, NaN, Infinity, -Infinity, 5e-324, -5e-324, 1.7976931348623157e308, 2.2250738585072014e-308];

// Varied 16-element inputs: generic, large world coordinates, tiny values,
// TRS-shaped with negative/nonuniform scale, singular, and IEEE specials.
export function* matrixInputs(rand, count) {

    const r = (scale = 1) => (rand() * 2 - 1) * scale;

    for (let i = 0; i < count; i++) {
        const kind = i % 7;
        const e = new Array(16);

        if (kind === 0) {
            for (let j = 0; j < 16; j++) e[j] = r();
        } else if (kind === 1) {
            for (let j = 0; j < 16; j++) e[j] = r(1e4);
            e[12] = r(1e7); e[13] = r(1e7); e[14] = r(1e7);
        } else if (kind === 2) {
            for (let j = 0; j < 16; j++) e[j] = r(1e-6);
        } else if (kind === 3) {
            // Affine TRS with reflections / nonuniform scale.
            for (let j = 0; j < 12; j++) e[j] = r(3);
            e[3] = 0; e[7] = 0; e[11] = 0;
            e[12] = r(1e5); e[13] = r(1e5); e[14] = r(1e5); e[15] = 1;
        } else if (kind === 4) {
            // Singular: duplicated column or zero column.
            for (let j = 0; j < 16; j++) e[j] = r(10);
            const col = Math.floor(rand() * 4);
            for (let k = 0; k < 4; k++) e[col * 4 + k] = rand() < 0.5 ? 0 : e[((col + 1) % 4) * 4 + k];
        } else if (kind === 5) {
            for (let j = 0; j < 16; j++) e[j] = SPECIAL[Math.floor(rand() * SPECIAL.length)];
        } else {
            // Mostly ordinary with one or two specials sprinkled in.
            for (let j = 0; j < 16; j++) e[j] = r(100);
            e[Math.floor(rand() * 16)] = SPECIAL[Math.floor(rand() * SPECIAL.length)];
            if (rand() < 0.5) e[Math.floor(rand() * 16)] = -0;
        }

        yield e;
    }
}
