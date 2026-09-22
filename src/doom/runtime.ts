import { attachDoomKeyboard, type DoomKeyExports, type DoomKeyboard } from './keys';

export type DoomProgress = {
  received: number;
  total: number | null;
};

export type DoomSession = {
  dispose(): void;
};

export type DoomRuntimeOptions = {
  canvas: HTMLCanvasElement;
  wasmUrl?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onProgress(progress: DoomProgress): void;
  onFrame(memory: WebAssembly.Memory, pointer: number, width: number, height: number): void;
  onExit(exitCode: number): void;
};

type DoomExports = DoomKeyExports & {
  memory: WebAssembly.Memory;
  initGame(): void;
  tickGame(): void;
};

let active = false;

async function responseBytes(
  response: Response,
  onProgress: (progress: DoomProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) {
    throw new Error(`Unable to load Doom: ${response.status} ${response.statusText}`.trim());
  }

  const encoding = response.headers.get('Content-Encoding');
  const lengthHeader =
    !encoding || encoding.trim().toLowerCase() === 'identity'
      ? response.headers.get('Content-Length')
      : null;
  const parsedLength = lengthHeader === null ? Number.NaN : Number(lengthHeader);
  const total = Number.isSafeInteger(parsedLength) && parsedLength >= 0 ? parsedLength : null;

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress({ received: bytes.byteLength, total });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = new Uint8Array(result.value);
      chunks.push(chunk);
      received += chunk.byteLength;
      onProgress({ received, total });
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function functionExport(exports: WebAssembly.Exports, name: string): (...args: number[]) => void {
  const value = exports[name];
  if (typeof value !== 'function') throw new TypeError(`Doom export ${name} is missing`);
  return value as (...args: number[]) => void;
}

function globalExport(exports: WebAssembly.Exports, name: string): WebAssembly.Global {
  const value = exports[name];
  if (!(value instanceof WebAssembly.Global)) throw new TypeError(`Doom export ${name} is missing`);
  return value;
}

function doomExports(exports: WebAssembly.Exports): DoomExports {
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new TypeError('Doom export memory is missing');
  }

  return {
    memory: exports.memory,
    initGame: functionExport(exports, 'initGame'),
    tickGame: functionExport(exports, 'tickGame'),
    reportKeyDown: functionExport(exports, 'reportKeyDown'),
    reportKeyUp: functionExport(exports, 'reportKeyUp'),
    KEY_LEFTARROW: globalExport(exports, 'KEY_LEFTARROW'),
    KEY_RIGHTARROW: globalExport(exports, 'KEY_RIGHTARROW'),
    KEY_UPARROW: globalExport(exports, 'KEY_UPARROW'),
    KEY_DOWNARROW: globalExport(exports, 'KEY_DOWNARROW'),
    KEY_STRAFE_L: globalExport(exports, 'KEY_STRAFE_L'),
    KEY_STRAFE_R: globalExport(exports, 'KEY_STRAFE_R'),
    KEY_FIRE: globalExport(exports, 'KEY_FIRE'),
    KEY_USE: globalExport(exports, 'KEY_USE'),
    KEY_SHIFT: globalExport(exports, 'KEY_SHIFT'),
    KEY_TAB: globalExport(exports, 'KEY_TAB'),
    KEY_ESCAPE: globalExport(exports, 'KEY_ESCAPE'),
    KEY_ENTER: globalExport(exports, 'KEY_ENTER'),
    KEY_BACKSPACE: globalExport(exports, 'KEY_BACKSPACE'),
    KEY_ALT: globalExport(exports, 'KEY_ALT'),
  };
}

export async function startDoom(options: DoomRuntimeOptions): Promise<DoomSession> {
  if (active) throw new Error('Doom is already starting or running');
  active = true;

  let exports: DoomExports | null = null;
  let memory: WebAssembly.Memory | null = null;
  let keyboard: DoomKeyboard | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frameWidth = 0;
  let frameHeight = 0;
  let exitPending: number | null = null;
  let insideWebAssembly = false;
  let finished = false;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const clearRuntime = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (keyboard) {
      try {
        keyboard.dispose();
      } catch (error) {
        console.error(error);
      }
      keyboard = null;
    }
    memory = null;
    exports = null;
    active = false;
  };

  const finish = (exitCode: number) => {
    if (finished) return;
    finished = true;
    clearRuntime();
    options.onExit(exitCode);
  };

  const finishPendingExit = () => {
    if (exitPending === null || insideWebAssembly) return;
    const exitCode = exitPending;
    exitPending = null;
    finish(exitCode);
  };

  const requestExit = (exitCode: number) => {
    if (exitPending === null) exitPending = exitCode;
    if (!insideWebAssembly) finishPendingExit();
  };

  const invoke = (callback: () => void) => {
    insideWebAssembly = true;
    try {
      callback();
    } finally {
      insideWebAssembly = false;
      finishPendingExit();
    }
  };

  const readMessage = (pointer: number, length: number): string => {
    if (!memory) return '';
    return decoder.decode(new Uint8Array(memory.buffer, pointer, length));
  };

  const imports: WebAssembly.Imports = {
    loading: {
      onGameInit(width: number, height: number) {
        frameWidth = width;
        frameHeight = height;
      },
      wadSizes() {},
      readWads() {},
    },
    ui: {
      drawFrame(pointer: number) {
        if (memory) options.onFrame(memory, pointer, frameWidth, frameHeight);
      },
    },
    runtimeControl: {
      timeInMilliseconds() {
        return BigInt(Math.trunc(performance.now()));
      },
    },
    console: {
      onInfoMessage(pointer: number, length: number) {
        console.info(readMessage(pointer, length));
      },
      onErrorMessage(pointer: number, length: number) {
        console.error(readMessage(pointer, length));
      },
    },
    gameSaving: {
      sizeOfSaveGame() {
        return 0;
      },
      readSaveGame() {
        return 0;
      },
      writeSaveGame() {
        return 0;
      },
    },
    lifecycle: {
      onExit: requestExit,
    },
  };

  try {
    const fetchWasm = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await fetchWasm(options.wasmUrl ?? '/assets/doom/doom.wasm');
    const bytes = await responseBytes(response, options.onProgress);
    const instantiated = await WebAssembly.instantiate(bytes, imports);
    exports = doomExports(instantiated.instance.exports);
    memory = exports.memory;
    keyboard = attachDoomKeyboard(options.canvas, exports);

    invoke(exports.initGame);
    if (!finished) {
      const interval = 1000 / 35;
      let nextTick = performance.now() + interval;
      const schedule = () => {
        timer = setTimeout(runTick, Math.max(0, nextTick - performance.now()));
      };
      const runTick = () => {
        timer = null;
        if (finished || !exports) return;
        try {
          invoke(exports.tickGame);
        } catch (error) {
          console.error(error);
          finish(1);
        }
        if (finished) return;
        const now = performance.now();
        do nextTick += interval;
        while (nextTick <= now);
        schedule();
      };
      schedule();
    }
  } catch (error) {
    clearRuntime();
    throw error;
  }

  return {
    dispose() {
      requestExit(1);
    },
  };
}
