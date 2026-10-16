// Stock vs lazy Euler, fresh process per run, rotated order. ns per op
// (per bone for mixerCrowdFrame).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNS = Number(process.argv[2] ?? 5);
const script = fileURLToPath(new URL("./euler-workloads.mjs", import.meta.url));
const register = fileURLToPath(new URL("../test/fixtures/register-swap.mjs", import.meta.url));
const VARIANTS = { stock: [script], lazy: ["--import", register, script] };
const runs = { stock: [], lazy: [] };

for (let r = 0; r < RUNS; r++) {
    for (const v of r % 2 ? ["lazy", "stock"] : ["stock", "lazy"]) {
        const out = JSON.parse(execFileSync(process.execPath, VARIANTS[v], { env: { ...process.env, THREE_WASM_SWAP: "Euler" } }).toString());
        if (out.lazy !== (v === "lazy")) throw new Error(`variant ${v} did not load the expected Euler`);
        runs[v].push(out.results);
    }
}

const med = (v, w) => {
    const xs = runs[v].map(r => r[w]).sort((a, b) => a - b);
    return { min: xs[0], med: xs[xs.length >> 1], max: xs[xs.length - 1] };
};

console.log(`node ${process.version}, ${RUNS} fresh-process runs each, ns/op (min / median / max)`);
console.log("workload".padEnd(34) + "stock".padStart(22) + "lazy Euler".padStart(22));
for (const w of Object.keys(runs.stock[0])) {
    const s = med("stock", w), l = med("lazy", w);
    const f = x => `${x.min.toFixed(1)}/${x.med.toFixed(1)}/${x.max.toFixed(1)}`.padStart(22);
    console.log(w.padEnd(34) + f(s) + f(l) + `   ${((1 - l.med / s.med) * 100).toFixed(0)}% faster`);
}
