# three-wasm

AssemblyScript/WASM-backed drop-in replacements for three.js math classes, pinned to **three 0.186.1**.

Status: `Matrix4` (WASM-backed) and `Euler` (lazy quaternion→Euler sync, plain JS). Both pass the exact-parity tests; production integration has not been approved.

```sh
npm install
npm run build   # asc -> build/math.wasm -> src/generated/math-wasm.js (embedded + provenance)
npm test        # differential, alias, lifecycle and three-integration parity
npm run bench         # Matrix4: fresh-process Node microbenchmarks (attribution only)
npm run bench:euler   # stock vs lazy Euler, same three/src build
```

## Design

| Concern | Decision |
| --- | --- |
| Storage | `matrix.elements` is a `Float64Array(16)` view into one WASM memory. It is an own enumerable data property, as in three, so `Object.keys` and JSON shape are unchanged. |
| Memory growth | None. One fixed reservation is made at load (`initial === maximum`), so views never detach. When the pool is exhausted, new matrices fall back to plain `Float64Array` storage and run three's JS paths (counted in `fallbacks`). |
| Capacity | `globalThis.__THREE_WASM_CONFIG__ = { matrix4Capacity, multiplyListCapacity }`, set before the first import. Default is 262,144 matrices (32 MiB). |
| Reclamation | A `FinalizationRegistry` tracks the **view**, not the matrix. A retained `m.elements` therefore keeps its slot after `m` dies, and the matrix keeps its view alive. No public lifecycle API. |
| Kernel routing | Per call, only `multiplyMatrices` (and so `multiply`/`premultiply`) uses WASM, because it is the only measured win. `invert`, `determinant` and `compose` kernels exist and are tested exactly, but run in JS per call. See [docs/benchmarks.md](docs/benchmarks.md). |
| Operand check | A symbol-keyed slot record plus an identity compare (`elements === m[SLOT_VIEW]`). If a matrix's `elements` was reassigned, or an operand is a foreign matrix, the method runs three's JS code and increments `stats().fallbacks`. |
| Bulk | `multiplyMatricesList(targets, as, bs)` runs ordered triples in a single boundary crossing over the same kernel. Non-WASM operands throw. |
| Numerics | Strict f64 with three's evaluation order; no SIMD, FMA or relaxed math. Transcendentals stay in JS `Math`. Kernels read all operands before writing, so any aliasing is safe. |
| Loading | Top-level await instantiates an embedded base64 module, so three's module-level temporaries can allocate. Failure rejects the import, with no JS fallback. The CSP needs `'wasm-unsafe-eval'`. |
| Build | `scripts/build.mjs` records the compiler version, options, source sha256, wasm sha256 and git revision in `buildInfo`. |

## Euler: lazy quaternion→Euler sync

`Object3D` wires `quaternion._onChange → rotation.setFromQuaternion( quaternion, undefined, false )`. As a result, every quaternion write (every animated bone, every frame) pays for a matrix compose plus `asin` and two `atan2` calls, even though `rotation` is almost never read. The replacement `Euler` handles that non-notifying call by snapshotting the quaternion and order (about 5 stores). It computes the angles with three's exact code on the first read of `x/y/z/_x/_y/_z`, iteration, `toArray`, `equals` or `clone`.

- Because the snapshot is taken eagerly, later quaternion writes that bypass callbacks cannot leak into the result. Notifying calls (`update` undefined or `true`), unknown orders and every other method stay eager.
- Callback counts and ordering are identical, and the warning for an unknown order fires at the same moment.
- Measured: a bone quaternion write takes 28 ns instead of 99 ns, and a 40-pawn × 64-bone `AnimationMixer` + `updateMatrixWorld` frame is about 23% faster per bone. The worst case, reading `rotation` after every write, is about 20% slower. See [docs/benchmarks.md](docs/benchmarks.md).
- No WASM is involved. A WASM `slerpFlat` was measured and rejected for now: an exact version (importing JS `Math`) is 19% slower, and the faster one uses AssemblyScript trig, which is not bit-exact in f64.

## Using it in lineage-js (not applied)

three's package entry is a pre-bundled file, so substituting `Matrix4` means building three from `src/`. For an **isolated prototype build**:

```js
// webpack config (prototype only)
resolve: { alias: { three$: require.resolve('three/src/Three.js') } },
plugins: [
  new webpack.NormalModuleReplacementPlugin(
    /three[\\/]src[\\/]math[\\/]Matrix4\.js$/,
    path.resolve('../three-wasm/src/Matrix4.js')),
  new webpack.NormalModuleReplacementPlugin(
    /three[\\/]src[\\/]math[\\/]Euler\.js$/,
    path.resolve('../three-wasm/src/Euler.js'))
],
experiments: { topLevelAwait: true }, // default since webpack 5.83; check installed version
```

The JS baseline must use the same `src/`-based build without the replacement plugin. The bundled `three.module.js` is a different build and is not a valid baseline.

## Known gaps / open issues

1. **Reclamation lags churn badly.** In Node, steady churn of 4,096 dropped matrices per task peaked at about **800k live, unreclaimed slots (≈100 MiB)**. Slots appear to come back only on major GCs, and V8 does not count slot pressure as memory pressure. A long synchronous burst can exhaust the pool even when every matrix is garbage. Options: size the pool from measured application churn; an explicit overflow policy (counted heap-backed matrices); or pooling at known hot allocation sites. Not decided.
2. **Construction costs ~10×** (≈142 ns vs ≈15 ns): about 27 ns for the view plus about 66 ns for `FinalizationRegistry.register`. This only matters for code that churns matrices.
3. `.elements` is a `Float64Array`. See [docs/compatibility.md](docs/compatibility.md) for the call sites this affects, including a lineage-js serializer and three's TSL `NodeBuilder`.
4. `Euler`'s `_x/_y/_z` became prototype accessors, so `Object.keys(euler)` is `['isEuler', '_order']` (plus `_onChangeCallback` once wired).
5. Matrix3, Vector* and Quaternion are not started. Browser measurements and lineage-js scene validation have not been done.
