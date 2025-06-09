'use strict'

/**
 * Memory Management Unit. Stores memory and handles Read/Write access.
 */
class MMU {
    constructor() {
        this._ram = new Array(65536);
        this._bus = null;
        this._bytesUsed = 0;
    }

    get BytesUsed() {
        return this._bytesUsed;
    }

    get RAM() {
        return this._ram;
    }

    get Total() {
        return this._ram.length;
    }

    ConnectBus(bus) {
        this._bus = bus;
    }

    Reset() {
        this._ram = new Array(65536);
        this._bytesUsed = 0;
    }

    Write(val, addr) {
        if (typeof this._ram[addr] == 'undefined') {
            this._bytesUsed++;
        }
        this._ram[addr] = val;
    }

    Read(addr) {
        // MMIO
        switch (addr) {
            case 0xF884:
                return Number((this._bus._cpu.State.Clock >> 32n) & 0xFFn);
            case 0xF883:
                return Number((this._bus._cpu.State.Clock >> 24n) & 0xFFn);
            case 0xF882:
                return Number((this._bus._cpu.State.Clock >> 16n) & 0xFFn);
            case 0xF881:
                return Number((this._bus._cpu.State.Clock >> 8n) & 0xFFn);
            case 0xF880:
                return Number(this._bus._cpu.State.Clock & 0xFFn);
        }

        if (typeof this._ram[addr] != 'undefined') {
            return this._ram[addr];
        }
        else {
            return 0x0;
        }
    }

    GetRAMSlice(startAddr, endAddr) {
        return this._ram.slice(startAddr, endAddr);
    }
}

export { MMU };
