export function heapBase(): usize { // first byte past static data
    return __heap_base;
}

@inline function multiply4(t: usize, a: usize, b: usize): void { // reads all operands before writing, so t may alias a or b
    const a11 = load<f64>(a, 0),  a12 = load<f64>(a, 32), a13 = load<f64>(a, 64),  a14 = load<f64>(a, 96);
    const a21 = load<f64>(a, 8),  a22 = load<f64>(a, 40), a23 = load<f64>(a, 72),  a24 = load<f64>(a, 104);
    const a31 = load<f64>(a, 16), a32 = load<f64>(a, 48), a33 = load<f64>(a, 80),  a34 = load<f64>(a, 112);
    const a41 = load<f64>(a, 24), a42 = load<f64>(a, 56), a43 = load<f64>(a, 88),  a44 = load<f64>(a, 120);

    const b11 = load<f64>(b, 0),  b12 = load<f64>(b, 32), b13 = load<f64>(b, 64),  b14 = load<f64>(b, 96);
    const b21 = load<f64>(b, 8),  b22 = load<f64>(b, 40), b23 = load<f64>(b, 72),  b24 = load<f64>(b, 104);
    const b31 = load<f64>(b, 16), b32 = load<f64>(b, 48), b33 = load<f64>(b, 80),  b34 = load<f64>(b, 112);
    const b41 = load<f64>(b, 24), b42 = load<f64>(b, 56), b43 = load<f64>(b, 88),  b44 = load<f64>(b, 120);

    store<f64>(t, a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41, 0);
    store<f64>(t, a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42, 32);
    store<f64>(t, a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43, 64);
    store<f64>(t, a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44, 96);

    store<f64>(t, a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41, 8);
    store<f64>(t, a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42, 40);
    store<f64>(t, a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43, 72);
    store<f64>(t, a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44, 104);

    store<f64>(t, a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41, 16);
    store<f64>(t, a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42, 48);
    store<f64>(t, a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43, 80);
    store<f64>(t, a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44, 112);

    store<f64>(t, a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41, 24);
    store<f64>(t, a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42, 56);
    store<f64>(t, a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43, 88);
    store<f64>(t, a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44, 120);
}

export function m4Multiply(t: usize, a: usize, b: usize): void {
    multiply4(t, a, b);
}

export function m4MultiplyList(list: usize, count: i32): void { // u32 (target, a, b) triples, run in order
    for (let i = 0; i < count; i++) {
        const p = list + <usize>(i * 12);
        multiply4(<usize>load<u32>(p, 0), <usize>load<u32>(p, 4), <usize>load<u32>(p, 8));
    }
}

export function m4Invert(t: usize): void {
    const n11 = load<f64>(t, 0),  n21 = load<f64>(t, 8),   n31 = load<f64>(t, 16),  n41 = load<f64>(t, 24);
    const n12 = load<f64>(t, 32), n22 = load<f64>(t, 40),  n32 = load<f64>(t, 48),  n42 = load<f64>(t, 56);
    const n13 = load<f64>(t, 64), n23 = load<f64>(t, 72),  n33 = load<f64>(t, 80),  n43 = load<f64>(t, 88);
    const n14 = load<f64>(t, 96), n24 = load<f64>(t, 104), n34 = load<f64>(t, 112), n44 = load<f64>(t, 120);

    const t1 = n11 * n22 - n21 * n12;
    const t2 = n11 * n32 - n31 * n12;
    const t3 = n11 * n42 - n41 * n12;
    const t4 = n21 * n32 - n31 * n22;
    const t5 = n21 * n42 - n41 * n22;
    const t6 = n31 * n42 - n41 * n32;
    const t7 = n13 * n24 - n23 * n14;
    const t8 = n13 * n34 - n33 * n14;
    const t9 = n13 * n44 - n43 * n14;
    const t10 = n23 * n34 - n33 * n24;
    const t11 = n23 * n44 - n43 * n24;
    const t12 = n33 * n44 - n43 * n34;

    const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;

    if (det == 0) {
        memory.fill(t, 0, 128);
        return;
    }

    const detInv = 1 / det;

    store<f64>(t, (n22 * t12 - n32 * t11 + n42 * t10) * detInv, 0);
    store<f64>(t, (n31 * t11 - n21 * t12 - n41 * t10) * detInv, 8);
    store<f64>(t, (n24 * t6 - n34 * t5 + n44 * t4) * detInv, 16);
    store<f64>(t, (n33 * t5 - n23 * t6 - n43 * t4) * detInv, 24);

    store<f64>(t, (n32 * t9 - n12 * t12 - n42 * t8) * detInv, 32);
    store<f64>(t, (n11 * t12 - n31 * t9 + n41 * t8) * detInv, 40);
    store<f64>(t, (n34 * t3 - n14 * t6 - n44 * t2) * detInv, 48);
    store<f64>(t, (n13 * t6 - n33 * t3 + n43 * t2) * detInv, 56);

    store<f64>(t, (n12 * t11 - n22 * t9 + n42 * t7) * detInv, 64);
    store<f64>(t, (n21 * t9 - n11 * t11 - n41 * t7) * detInv, 72);
    store<f64>(t, (n14 * t5 - n24 * t3 + n44 * t1) * detInv, 80);
    store<f64>(t, (n23 * t3 - n13 * t5 - n43 * t1) * detInv, 88);

    store<f64>(t, (n22 * t8 - n12 * t10 - n32 * t7) * detInv, 96);
    store<f64>(t, (n11 * t10 - n21 * t8 + n31 * t7) * detInv, 104);
    store<f64>(t, (n24 * t2 - n14 * t4 - n34 * t1) * detInv, 112);
    store<f64>(t, (n13 * t4 - n23 * t2 + n33 * t1) * detInv, 120);
}

export function m4Determinant(t: usize): f64 {
    const n11 = load<f64>(t, 0),  n12 = load<f64>(t, 32), n13 = load<f64>(t, 64),  n14 = load<f64>(t, 96);
    const n21 = load<f64>(t, 8),  n22 = load<f64>(t, 40), n23 = load<f64>(t, 72),  n24 = load<f64>(t, 104);
    const n31 = load<f64>(t, 16), n32 = load<f64>(t, 48), n33 = load<f64>(t, 80),  n34 = load<f64>(t, 112);
    const n41 = load<f64>(t, 24), n42 = load<f64>(t, 56), n43 = load<f64>(t, 88),  n44 = load<f64>(t, 120);

    const t11 = n23 * n34 - n24 * n33;
    const t12 = n22 * n34 - n24 * n32;
    const t13 = n22 * n33 - n23 * n32;

    const t21 = n21 * n34 - n24 * n31;
    const t22 = n21 * n33 - n23 * n31;
    const t23 = n21 * n32 - n22 * n31;

    return n11 * (n42 * t11 - n43 * t12 + n44 * t13) -
        n12 * (n41 * t11 - n43 * t21 + n44 * t22) +
        n13 * (n41 * t12 - n42 * t21 + n44 * t23) -
        n14 * (n41 * t13 - n42 * t22 + n43 * t23);
}

export function m4Compose(
    t: usize,
    px: f64, py: f64, pz: f64,
    x: f64, y: f64, z: f64, w: f64,
    sx: f64, sy: f64, sz: f64
): void {
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    store<f64>(t, (1 - (yy + zz)) * sx, 0);
    store<f64>(t, (xy + wz) * sx, 8);
    store<f64>(t, (xz - wy) * sx, 16);
    store<f64>(t, 0, 24);

    store<f64>(t, (xy - wz) * sy, 32);
    store<f64>(t, (1 - (xx + zz)) * sy, 40);
    store<f64>(t, (yz + wx) * sy, 48);
    store<f64>(t, 0, 56);

    store<f64>(t, (xz + wy) * sz, 64);
    store<f64>(t, (yz - wx) * sz, 72);
    store<f64>(t, (1 - (xx + yy)) * sz, 80);
    store<f64>(t, 0, 88);

    store<f64>(t, px, 96);
    store<f64>(t, py, 104);
    store<f64>(t, pz, 112);
    store<f64>(t, 1, 120);
}
