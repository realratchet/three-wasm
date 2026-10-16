# Compatibility audit (three 0.186.1)

# Matrix4

## Verified identical

These are covered by `npm test`.

- Prototype surface: method names, `Function.length` of each method, `isMatrix4`, constructor arity, and `Object.keys(new Matrix4())` (`['elements']`).
- Every method, bit-exact by `Object.is` (signed zero; NaN counts as equal to NaN). That covers return identity (`this`, or a value) and side effects on arguments, including the quaternion `_onChange` callback count from `decompose`. Each method is checked on 1,400 deterministic cases mixing generic, large-world (1e7), tiny, TRS with reflections/nonuniform scale, singular, and IEEE-special inputs.
- Aliasing: a target equal to `a`, to `b` or to both; `a === b`; `copy(self)`; `extractRotation(self)`; dependent entries in a batch.
- Three's own pipelines with `Matrix4` swapped by a resolve hook, compared bit-for-bit with a stock run: scene graph with large offsets and reflections, `SkinnedMesh` + `Skeleton.update` bone palette (Float32 boundary), two-action `AnimationMixer` blending, perspective/orthographic cameras, `Frustum` culling, `Raycaster`, `Box3.setFromObject(precise)`, `getWorld*` (decompose), `attach` (invert), `InstancedMesh`, and a `toJSON`/`ObjectLoader` round trip. No JS fallbacks were taken.
- Mutation tests: reordering one sum term (a one-ULP change) and storing `-0` for `+0` are both caught.

## Differences (inherent to typed-array storage)

| Behaviour | three | three-wasm | Impact found |
| --- | --- | --- | --- |
| `Array.isArray(m.elements)` | `true` | `false` | No three or lineage-js call site checks this on matrix elements. |
| `JSON.stringify(m.elements)` | `[...]` | `{"0":…}` | lineage-js `src/assets/decoders/material-decoder.ts:50` returns `value.elements` for `isMatrix4`, so its serialized output changes shape. `toArray()`/`toJSON` paths are unaffected. |
| `m.elements.map(fn)` returning non-numbers | Array of results | Float64Array (strings become NaN) | three `src/nodes/core/NodeBuilder.js:1460` (TSL/WebGPU constant generation for Matrix4) would emit NaN. WebGL renderer is unaffected; Matrix3 `WebGLProgram.js:40` will hit the same issue when Matrix3 is ported. |
| Non-number stores (`set(1,2,3)`, short `fromArray`) | keeps `undefined`/strings | coerces (`NaN`, numbers) | Only matters for malformed input. |
| `structuredClone`/`postMessage` of `m.elements` | 16 numbers | **copies the entire WASM buffer** (the view's `.buffer`) | Must never be sent to workers as is; use `toArray()`. No call site found yet. |
| `m.elements = array` | identity replaced | identity replaced (same) | That matrix then runs three's JS path, counted in `stats().fallbacks`. Its old slot is reclaimed when the old view dies. |
| Retained `m.elements` after `m` is unreachable | stays valid | stays valid; slot is not reused while the view lives | — |
| `m.elements.subarray()` retained after the parent view dies | n/a | **not tracked**: the slot can be reused under it | Avoid. No call site found. |

## lineage-js `.elements` call sites reviewed

These read/write indices or pass to `uniformMatrix4fv(new Float32Array(...))`, which all work with Float64Array: `objects/local-space-skeleton.ts`, `objects/components/skill-effect-host.ts`, `objects/components/transform-component.ts`, `rendering/nameplate-depth-culling.ts`, `rendering/static-lighting.ts`, `rendering/ue2-conventions.ts`, `utils/rotator.ts`, `network/network-ui.ts`, `physics/collision-primitive.ts`, `assets/asset-manager.ts`. The only behavioural difference is the serializer noted above.

# Euler (lazy sync)

## Verified identical

- Every three prototype member exists with the same `Function.length`. Iteration and `DEFAULT_ORDER` match.
- Fuzz test: 400 sequences × 60 random steps on an Euler/Quaternion pair wired exactly like `Object3D`. Steps include quaternion writes through every setter, direct `q._x` writes that bypass callbacks, Euler setters, direct `_x`/`_order` writes, `set`, `copy` (including self), `fromArray`, `reorder`, `setFromQuaternion`/`setFromRotationMatrix` with every `order`/`update` combination, gimbal-lock inputs and IEEE specials. Values (`Object.is`), return identity and both callback counts are compared at random points, so lazy writes stack up between reads.
- Unknown-order warnings fire at the same moment, with identical resulting state.
- Three's scene pipeline (above) is bit-identical with `Euler` swapped alone and together with `Matrix4`, including Euler-driven writes and `rotation` reads.
- Mutation check: a component write that skips resolution is caught.

## Differences

| Behaviour | three | lazy Euler |
| --- | --- | --- |
| `Object.keys(euler)` / `JSON.stringify(euler)` | includes `_x`, `_y`, `_z` | omits them (prototype accessors over symbol-keyed storage) |
| Cost of first read after a quaternion write | 0 (paid at write) | the deferred conversion (~same total) |

lineage-js reads three Euler components only in a few places (e.g. `pawn-attack-component.ts:786` `parent.rotation.z`, skill viewer, radar). No serializer enumerates Euler keys.
