// Runs three's own code (scene graph, skinning, animation, cameras, culling,
// raycasting, attach, instancing, JSON, Euler/quaternion sync) once stock and
// with each combination of replacements swapped in by a resolve hook, and
// requires bit-identical output.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scenario = fileURLToPath(new URL("./fixtures/scene-scenario.mjs", import.meta.url));
const register = fileURLToPath(new URL("./fixtures/register-swap.mjs", import.meta.url));

const run = swap => JSON.parse(execFileSync(process.execPath, swap === null ? [scenario] : ["--import", register, scenario], {
    maxBuffer: 1 << 28,
    env: { ...process.env, THREE_WASM_SWAP: swap ?? "" }
}).toString());

const stock = run(null);

for (const swap of ["Matrix4", "Euler", "Matrix4,Euler"]) {
    test(`three scene pipeline is bit-identical with ${swap} swapped`, () => {
        const swapped = run(swap);

        assert.equal(stock.isWasm, false);
        assert.equal(stock.isLazyEuler, false);
        assert.equal(swapped.isWasm, swap.includes("Matrix4"), "Matrix4 swap must match request");
        assert.equal(swapped.isLazyEuler, swap.includes("Euler"), "Euler swap must match request");
        assert.deepStrictEqual(swapped.fallbacks, { matrix4Multiply: 0 });
        assert.equal(swapped.lines.length, stock.lines.length);

        for (let i = 0; i < stock.lines.length; i++) {
            assert.equal(swapped.lines[i], stock.lines[i], `line ${i}: ${stock.lines[i].split(" ").slice(0, 2).join(" ")}`);
        }

    });
}
