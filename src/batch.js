import { SLOT_PTR, SLOT_VIEW, config, kernels, listBase, listView } from "./backend.js";

function multiplyMatricesList(targets, as, bs, count = targets.length) { // targets[i].multiplyMatrices(as[i], bs[i]) in order; non-WASM operands throw

    const capacity = config.multiplyListCapacity;

    for (let start = 0; start < count; start += capacity) {
        const n = Math.min(capacity, count - start);

        for (let i = 0; i < n; i++) {
            const t = targets[start + i], a = as[start + i], b = bs[start + i];

            if (t.elements !== t[SLOT_VIEW] || a.elements !== a[SLOT_VIEW] || b.elements !== b[SLOT_VIEW]) {
                throw new TypeError(`three-wasm: multiplyMatricesList entry ${start + i} is not WASM-backed`);
            }

            const j = i * 3;
            listView[j] = t[SLOT_PTR];
            listView[j + 1] = a[SLOT_PTR];
            listView[j + 2] = b[SLOT_PTR];
        }

        kernels.m4MultiplyList(listBase, n);
    }
}

export { multiplyMatricesList };
