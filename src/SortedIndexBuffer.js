import { kernels, sortedIndexPool as pool } from "./backend.js";

class SortedIndexState {
    constructor(geometry) {

        const count = geometry.count, vertices = geometry.vertexCount;
        this.geometry = geometry;
        this.block = pool.allocate(40 + vertices * 4 + count * 24);
        this.descriptor = pool.view(Uint32Array, this.block, 0, 10);
        this.vertexKeys = pool.view(Int32Array, this.block, 40, vertices);
        this.keys = pool.view(Int32Array, this.block, 40 + vertices * 4, count);
        this.order = pool.view(Uint32Array, this.block, 40 + vertices * 4 + count * 4, count);
        this.scratch = pool.view(Uint32Array, this.block, 40 + vertices * 4 + count * 8, count);
        this.indices = pool.view(Uint32Array, this.block, 40 + vertices * 4 + count * 12, count * 3);
        this.descriptor.set([count, vertices, geometry.positions.byteOffset, geometry.triangles.byteOffset, geometry.source.byteOffset, this.vertexKeys.byteOffset, this.keys.byteOffset, this.order.byteOffset, this.scratch.byteOffset, this.indices.byteOffset]);
    }

    apply(x, y, z, entering) {

        if (this.block.isReleased) throw new Error(`three-wasm: sorted index state is disposed`);
        return !!kernels.sortedIndexApply(this.descriptor.byteOffset, x, y, z, entering);
    }

    dispose() { pool.release(this.block); }
}

class SortedIndexBuffer {
    constructor(positions, source, firstVertex = 0) {

        if (source.length % 3) throw new Error(`three-wasm: invalid sorted index count ${source.length}`);
        const lookup = new Map(), arrPositions = [], triangles = new Uint32Array(source.length);
        for (let i = 0; i < source.length; i++) {
            const offset = (source[i] - firstVertex) * 3;
            if (offset < 0 || offset + 2 >= positions.length) throw new Error(`three-wasm: invalid sorted vertex ${offset}`);
            let index = lookup.get(offset);
            if (index === undefined) {
                index = arrPositions.length / 3;
                arrPositions.push(positions[offset], positions[offset + 1], positions[offset + 2]);
                lookup.set(offset, index);
            }
            triangles[i] = index;
        }
        this.count = source.length / 3;
        this.vertexCount = arrPositions.length / 3;
        this.states = [];
        this.block = pool.allocate(arrPositions.length * 4 + source.length * 8);
        this.positions = pool.view(Float32Array, this.block, 0, arrPositions.length);
        this.triangles = pool.view(Uint32Array, this.block, arrPositions.length * 4, source.length);
        this.source = pool.view(Uint32Array, this.block, arrPositions.length * 4 + source.length * 4, source.length);
        this.positions.set(arrPositions); this.triangles.set(triangles); this.source.set(source);
    }

    createState() {

        if (this.block.isReleased) throw new Error(`three-wasm: sorted index buffer is disposed`);
        const state = new SortedIndexState(this);
        this.states.push(state);
        return state;
    }

    dispose() {

        for (const state of this.states) state.dispose();
        this.states.length = 0;
        pool.release(this.block);
    }
}

export { SortedIndexBuffer };
