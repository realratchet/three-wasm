// Drives three's own scene-graph, skinning, animation, camera, culling,
// raycasting and instancing code, then prints every resulting number as raw
// IEEE bits. Run once stock and once with Matrix4 swapped; outputs must match.
import * as THREE from "three/src/Three.js";

function mulberry32(seed) {

    return function () {

        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const rand = mulberry32(1234);
const r = (s = 1) => (rand() * 2 - 1) * s;
const out = [];
const bits = new BigUint64Array(1), f64 = new Float64Array(bits.buffer);
const record = (label, values) => {
    const hex = [];
    for (const v of values) {
        f64[0] = v; hex.push(bits[0].toString(16));
    }

    out.push(`${label} ${hex.join(",")}`);
};

const randomQuaternion = () => new THREE.Quaternion(r(), r(), r(), r()).normalize();

const scene = new THREE.Scene();
const nodes = [];

// Hierarchy with large world offsets, reflections and nonuniform scale.
for (let i = 0; i < 200; i++) {
    const node = new THREE.Object3D();
    node.position.set(r(1e5), r(1e3), r(1e5));
    node.quaternion.copy(randomQuaternion());
    node.scale.set(r(3) || 1, r(3) || 1, r(3) || 1);
    (i === 0 ? scene : nodes[Math.floor(rand() * i)]).add(node);
    nodes.push(node);
}

// Skinned mesh driven by an animation mixer.
const bones = [];
for (let i = 0; i < 64; i++) {
    const bone = new THREE.Bone();
    bone.name = `b${i}`;
    bone.position.set(r(2), r(2), r(2));
    bone.quaternion.copy(randomQuaternion());
    if (i > 0) bones[Math.floor(rand() * i)].add(bone);
    bones.push(bone);
}

const geometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
const count = geometry.attributes.position.count;
const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
for (let i = 0; i < count * 4; i++) {
    skinIndex[i] = Math.floor(rand() * 64); skinWeight[i] = 0.25;
}

geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));

const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
skinned.add(bones[0]);
skinned.position.set(1234.5, -20, 98765.25);
nodes[17].add(skinned);
scene.updateMatrixWorld(true);
skinned.bind(new THREE.Skeleton(bones));

const tracks = [];
for (let i = 0; i < 64; i += 3) {
    const times = [0, 0.5, 1, 1.5];
    tracks.push(new THREE.QuaternionKeyframeTrack(`b${i}.quaternion`, times, times.flatMap(() => randomQuaternion().toArray())));
    tracks.push(new THREE.VectorKeyframeTrack(`b${i}.position`, times, times.flatMap(() => [r(2), r(2), r(2)])));
}

const mixer = new THREE.AnimationMixer(skinned);
const clip = new THREE.AnimationClip("clip", 1.5, tracks);
const actionA = mixer.clipAction(clip).play();
const actionB = mixer.clipAction(clip.clone()).play();
actionB.time = 0.4; actionA.setEffectiveWeight(0.7); actionB.setEffectiveWeight(0.3);

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5e5);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
scene.add(camera, ortho);

const meshes = [];
for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(r(50) || 1, 30, 30), new THREE.MeshBasicMaterial());
    nodes[Math.floor(rand() * nodes.length)].add(mesh);
    meshes.push(mesh);
}

const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 128);
nodes[3].add(instanced);
const tmp = new THREE.Matrix4();
for (let i = 0; i < 128; i++) instanced.setMatrixAt(i, tmp.compose(new THREE.Vector3(r(100), r(100), r(100)), randomQuaternion(), new THREE.Vector3(r(2), 1, r(2))));

const frustum = new THREE.Frustum();
const raycaster = new THREE.Raycaster();
const worldPos = new THREE.Vector3(), worldQuat = new THREE.Quaternion(), worldScale = new THREE.Vector3();

for (let frame = 0; frame < 30; frame++) {
    for (let i = 0; i < nodes.length; i += 7) nodes[i].rotateOnAxis(new THREE.Vector3(0, 1, 0), 0.01 * frame);
    // Euler-driven writes interleaved with quaternion-driven ones.
    for (let i = 3; i < nodes.length; i += 11) nodes[i].rotation.y += 0.02;
    for (let i = 5; i < nodes.length; i += 13) nodes[i].rotation.set(r(3), r(3), r(3), ["XYZ", "ZYX", "YZX"][frame % 3]);
    if (frame % 4 === 0) record(`f${frame} rotations`, nodes.filter((_, i) => i % 9 === 0).flatMap(n => [...n.rotation.toArray().slice(0, 3)]));
    mixer.update(1 / 60);

    camera.position.set(r(1e5), r(1e3), r(1e5));
    camera.lookAt(nodes[frame].getWorldPosition(worldPos));
    camera.updateProjectionMatrix();
    scene.updateMatrixWorld();
    skinned.skeleton.update();
    instanced.computeBoundingSphere();

    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

    record(`f${frame} bones`, skinned.skeleton.boneMatrices);
    record(`f${frame} camera`, [...camera.matrixWorld.elements, ...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements, ...camera.projectionMatrixInverse.elements]);
    record(`f${frame} frustum`, frustum.planes.flatMap(p => [p.normal.x, p.normal.y, p.normal.z, p.constant]));
    record(`f${frame} culled`, meshes.map(m => frustum.intersectsObject(m) ? 1 : 0));

    raycaster.setFromCamera(new THREE.Vector2(r(), r()), camera);
    record(`f${frame} ray`, raycaster.intersectObjects(meshes, false).flatMap(h => [h.distance, h.point.x, h.point.y, h.point.z, meshes.indexOf(h.object)]));

    const box = new THREE.Box3().setFromObject(skinned, true);
    record(`f${frame} skinnedBox`, [...box.min.toArray(), ...box.max.toArray()]);

    const probe = meshes[frame % meshes.length];
    probe.getWorldPosition(worldPos); probe.getWorldQuaternion(worldQuat); probe.getWorldScale(worldScale);
    record(`f${frame} decompose`, [...worldPos.toArray(), ...worldQuat.toArray(), ...worldScale.toArray()]);

    // Reparenting preserves world transform via invert() + multiply().
    nodes[(frame * 13) % nodes.length].attach(meshes[(frame * 5) % meshes.length]);
}

record("final rotations", [...nodes, ...bones, ...meshes].flatMap(n => [n.rotation.x, n.rotation.y, n.rotation.z]));
record("final orders", [...nodes, ...bones].map(n => ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"].indexOf(n.rotation.order)));
record("final world", nodes.flatMap(n => [...n.matrixWorld.elements]));
record("final local", meshes.flatMap(m => [...m.matrix.elements, ...m.position.toArray(), ...m.quaternion.toArray(), ...m.scale.toArray()]));
record("instances", [...instanced.instanceMatrix.array, instanced.boundingSphere.radius, ...instanced.boundingSphere.center.toArray()]);
record("json", [...new THREE.ObjectLoader().parse(scene.toJSON()).children[0].matrix.elements]);

const isWasm = new THREE.Matrix4().elements instanceof Float64Array;
const isLazyEuler = Object.getOwnPropertyDescriptor(THREE.Euler.prototype, "_x") !== undefined;
let fallbacks = null;
if (isWasm || isLazyEuler) fallbacks = (await import("../../src/backend.js")).stats().fallbacks;

console.log(JSON.stringify({ isWasm, isLazyEuler, fallbacks, lines: out }));
