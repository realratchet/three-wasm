// Runs each variant in fresh processes, rotating order, and reports the
// distribution (min / median / max over runs) of per-op median ns.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNS = Number(process.argv[2] ?? 5);
const VARIANTS = ["three", "three-f64", "wasm"];
const script = fileURLToPath(new URL("./workloads.mjs", import.meta.url));
const runs = Object.fromEntries(VARIANTS.map(v => [v, []]));

for (let r = 0; r < RUNS; r++) {
    for (let k = 0; k < VARIANTS.length; k++) {
        const v = VARIANTS[(r + k) % VARIANTS.length];
        const out = JSON.parse(execFileSync(process.execPath, [script, v]).toString());
        if (out.fallbacks && Object.values(out.fallbacks).some(n => n !== 0)) throw new Error(`wasm run used JS fallback: ${JSON.stringify(out.fallbacks)}`);
        runs[v].push(out.results);
    }
}

const workloads = [...new Set(VARIANTS.flatMap(v => Object.keys(runs[v][0])))];
const stat = (v, w) => {
    const xs = runs[v].map(r => r[w]).filter(x => x !== undefined).sort((a, b) => a - b);
    return xs.length ? { min: xs[0], med: xs[xs.length >> 1], max: xs[xs.length - 1] } : null;
};

console.log(`node ${process.version}, ${RUNS} fresh-process runs per variant, ns/op (min / median / max)`);
console.log("workload".padEnd(22) + VARIANTS.map(v => v.padStart(22)).join("") + "   wasm vs three");
for (const w of workloads) {
    const cells = VARIANTS.map(v => {
        const s = stat(v, w);
        return (s ? `${s.min.toFixed(1)}/${s.med.toFixed(1)}/${s.max.toFixed(1)}` : "-").padStart(22);

    });
    const base = stat("three", w), wasm = stat("wasm", w) ;
    const ratio = base && wasm ? `${((1 - wasm.med / base.med) * 100).toFixed(0)}% faster` : w === "multiplyMatricesList" ? `${((1 - wasm.med / stat("three", "multiplyMatrices").med) * 100).toFixed(0)}% vs three multiplyMatrices` : "";
    console.log(w.padEnd(22) + cells.join("") + "   " + ratio);
}
