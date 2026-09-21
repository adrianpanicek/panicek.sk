import { Buffer } from 'buffer';
// A few just-bash commands use the global Node-compatible byte API even in its browser build.
Object.defineProperty(globalThis, 'Buffer', { value: Buffer, configurable: true, writable: true });
