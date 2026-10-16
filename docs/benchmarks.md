# Benchmarks — 2026-10-14

Environment: Node v23.6.0 (V8) on the user's Linux machine, other load not controlled. Build: assemblyscript 0.28.20, `-O3 --runtime stub --importMemory`, scalar f64, 2,770-byte module. Command: `npm run bench` (5 fresh processes per variant, rotated order). Each run takes the median of 200 samples over 4,096 random operands, yielding between samples. Every WASM run asserts zero JS fallbacks.

These numbers are **for attribution only**. They are not browser numbers, and they are not frame-time or acceptance evidence (see requirements.md).

Median ns/op (spread across runs was up to ±25%; three's own `multiplyMatrices` median ranged from 54 to 66 between sessions):

| workload | three (Array) | three code on Float64Array | three-wasm |
| --- | --- | --- | --- |
| multiplyMatrices (random operands) | 54–66 | 58 | **43** |
| multiply (in place) | 43 | 55 | 39 |
| invert | 25 | 25 | 26 |
| compose | 10.5 | 11 | 11 |
| decompose | 44 | 44 | 40 |
| determinant | 15–20 | 16 | 16 |
| copy | 21–25 | 34 | 22 |
| constructAndDrop | 15 | 17 | **142** |
| multiplyMatricesList (batch) | — | — | **30** |

## Per-call routing decision

With the kernel used per call (and the faster operand check), the same harness measured:

| | three | per-call WASM |
| --- | --- | --- |
| invert | 25.8 | 40.0 |
| compose | 11.8 | 21.6 |
| determinant | 15.0 | 27.2 |

A call with many f64 arguments (compose has 11) or little arithmetic does not repay the JS→WASM transition, while three's JS on the same view is at parity. Those methods therefore run in JS per call, and their kernels stay for future bulk paths. Only `multiplyMatrices` is routed per call.

## Operand check

Using `elements.buffer === memory.buffer` to validate operands roughly doubled per-call cost (multiply took 88–100 ns). Replacing it with an identity compare against a symbol-keyed slot record brought multiply to 43 ns.

## Construction breakdown

| | ns |
| --- | --- |
| `new Float64Array(wasmBuffer, off, 16)` | 27 |
| `FinalizationRegistry.register` | 66 |
| plain array literal (three) | 1.3 |

## Reclamation under churn

Allocating and dropping 4,096 matrices per task over 600 tasks gave a **peak of ~800k live slots** (~100 MiB). Reclamation is tied to major-GC cadence. `--max-semi-space-size=1` did not help.

# Quaternion / Euler — 2026-10-14

## slerpFlat (experiment, not shipped)

These are 4,096 slerps over Float32 keyframe values, as `QuaternionLinearInterpolant` runs them:

| | ns | exact vs three |
| --- | --- | --- |
| three `slerpFlat` | 63 | — |
| WASM per call with copy in/out, AS `acos`/`sin` | 51 | no: 77/4096 f64 results differ, max 32 ULP. 0 differ after rounding to the Float32 result buffer |
| WASM per call with copy in/out, imported JS `Math` | 75 | yes |
| WASM batch, data resident in WASM memory, AS math | 43 | no |

The trig dominates. Exactness requires JS `Math`, which loses, so this needs an explicit tolerance decision before it can ship.

## Lazy Euler (`npm run bench:euler`)

This is Node v23.6.0, 5 fresh-process runs per variant, with three imported from `src/` in both variants. Times are ns per op; for `mixerCrowdFrame` they are ns per bone.

| workload | stock | lazy Euler |
| --- | --- | --- |
| `object.quaternion.fromArray` (bone write) | 99 | **28** |
| the same, then read `rotation.x` every time (worst case) | 116 | 140 |
| `rotation.y += …` | 76 | 72 |
| `new Object3D()` | 2,698 | 2,653 |
| 40 pawns × 64 bones: `mixer.update` + `updateMatrixWorld` | 625 | **481** |

For reference, writing a standalone `Quaternion` (no `Object3D` wiring) costs 4.8 ns. That gap is the Euler sync.
