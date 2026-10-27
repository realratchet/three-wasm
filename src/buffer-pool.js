class BufferPool {
    constructor(memory, base, capacity) {

        if (!Number.isSafeInteger(capacity) || capacity < 16 || capacity % 16) throw new Error(`three-wasm: invalid buffer capacity ${capacity}`);
        this.memory = memory;
        this.free = [{ ptr: base, bytes: capacity }];
        this.capacity = capacity;
        this.liveBytes = 0;
        this.highWater = 0;
        this.registry = new FinalizationRegistry(block => {
            if (--block.views === 0) this.release(block);
        });
    }

    allocate(bytes) {

        bytes = Math.max(16, Math.ceil(bytes / 16) * 16);
        const index = this.free.findIndex(block => block.bytes >= bytes);
        if (index < 0) throw new Error(`three-wasm: sorted index storage exhausted (${this.liveBytes}/${this.capacity} bytes)`);

        const free = this.free[index], block = { ptr: free.ptr, bytes, views: 0, isReleased: false };
        free.ptr += bytes; free.bytes -= bytes;
        if (!free.bytes) this.free.splice(index, 1);
        this.liveBytes += bytes;
        this.highWater = Math.max(this.highWater, this.liveBytes);
        return block;
    }

    view(Type, block, offset, count) {

        const view = new Type(this.memory.buffer, block.ptr + offset, count);
        block.views++;
        this.registry.register(view, block);
        return view;
    }

    release(block) {

        if (block.isReleased) return;
        block.isReleased = true;
        this.liveBytes -= block.bytes;
        let index = 0;
        while (index < this.free.length && this.free[index].ptr < block.ptr) index++;
        this.free.splice(index, 0, { ptr: block.ptr, bytes: block.bytes });
        if (index > 0 && this.free[index - 1].ptr + this.free[index - 1].bytes === this.free[index].ptr) {
            this.free[index - 1].bytes += this.free[index].bytes;
            this.free.splice(index--, 1);
        }
        if (index + 1 < this.free.length && this.free[index].ptr + this.free[index].bytes === this.free[index + 1].ptr) {
            this.free[index].bytes += this.free[index + 1].bytes;
            this.free.splice(index + 1, 1);
        }
    }

    stats() { return { capacity: this.capacity, liveBytes: this.liveBytes, highWater: this.highWater, freeBlocks: this.free.length }; }
}

export { BufferPool };
