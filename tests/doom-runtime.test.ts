import { describe, expect, test } from 'bun:test';
import { attachDoomKeyboard } from '../src/doom/keys';
import { startDoom, type DoomSession } from '../src/doom/runtime';

class FakeCanvas extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    if (callback) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(callback);
      this.listeners.set(type, listeners);
    }
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options);
    if (callback) this.listeners.get(type)?.delete(callback);
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

const keyExports = {
  KEY_LEFTARROW: 11,
  KEY_RIGHTARROW: 12,
  KEY_UPARROW: 13,
  KEY_DOWNARROW: 14,
  KEY_STRAFE_L: 15,
  KEY_STRAFE_R: 16,
  KEY_FIRE: 17,
  KEY_USE: 18,
  KEY_SHIFT: 19,
  KEY_TAB: 20,
  KEY_ESCAPE: 21,
  KEY_ENTER: 22,
  KEY_BACKSPACE: 23,
  KEY_ALT: 24,
};

function keyboardEvent(
  type: string,
  key: string,
  code = '',
): Event & { key: string; code: string } {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'code', { value: code });
  return event as Event & { key: string; code: string };
}

function encodeUnsigned(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return bytes;
}

function encodeSigned(value: number): number[] {
  const bytes: number[] = [];
  let done = false;
  while (!done) {
    let byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    done = (value === 0 && !sign) || (value === -1 && sign);
    if (!done) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}

function vector(items: number[][]): number[] {
  return [...encodeUnsigned(items.length), ...items.flat()];
}

function wasmString(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [...encodeUnsigned(bytes.length), ...bytes];
}

function section(id: number, contents: number[]): number[] {
  return [id, ...encodeUnsigned(contents.length), ...contents];
}

function doomFixture(exitOnTick = true): Uint8Array {
  const constants = Object.entries(keyExports);
  const types = vector([
    [0x60, 0, 0],
    [0x60, 1, 0x7f, 0],
    [0x60, 2, 0x7f, 0x7f, 0],
  ]);
  const imports = vector([
    [...wasmString('lifecycle'), ...wasmString('onExit'), 0, ...encodeUnsigned(1)],
    [...wasmString('ui'), ...wasmString('drawFrame'), 0, ...encodeUnsigned(1)],
    [...wasmString('loading'), ...wasmString('onGameInit'), 0, ...encodeUnsigned(2)],
  ]);
  const functions = vector([[0], [0], [1], [1]]);
  const memory = vector([[0, ...encodeUnsigned(1)]]);
  const globals = vector(
    constants.map(([, value]) => [0x7f, 0, 0x41, ...encodeSigned(value), 0x0b]),
  );
  const exports = vector([
    [...wasmString('memory'), 2, 0],
    [...wasmString('initGame'), 0, 3],
    [...wasmString('tickGame'), 0, 4],
    [...wasmString('reportKeyDown'), 0, 5],
    [...wasmString('reportKeyUp'), 0, 6],
    ...constants.map(([name], index) => [...wasmString(name), 3, ...encodeUnsigned(index)]),
  ]);
  const initBody = [0, 0x41, ...encodeSigned(320), 0x41, ...encodeSigned(200), 0x10, 2, 0x0b];
  const tickBody = exitOnTick
    ? [0, 0x41, 0, 0x10, 0, 0x41, 0, 0x10, 1, 0x0b]
    : [0, 0x41, 0, 0x10, 1, 0x0b];
  const codes = vector(
    [initBody, tickBody, [0, 0x0b], [0, 0x0b]].map((body) => [
      ...encodeUnsigned(body.length),
      ...body,
    ]),
  );

  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(1, types),
    ...section(2, imports),
    ...section(3, functions),
    ...section(5, memory),
    ...section(6, globals),
    ...section(7, exports),
    ...section(10, codes),
  ]);
}

function response(bytes: Uint8Array, contentLength = bytes.byteLength): Response {
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: { 'Content-Length': String(contentLength) },
  });
}

function streamedResponse(chunks: Uint8Array[], contentLength: number): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { 'Content-Length': String(contentLength) } },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForExit(start: (finish: (code: number) => void) => void): Promise<number> {
  return new Promise((resolve) => start(resolve));
}

function asCanvas(canvas: FakeCanvas): HTMLCanvasElement {
  return canvas as unknown as HTMLCanvasElement;
}

describe('Doom keyboard', () => {
  test('maps Doom controls and printable keys using the module export values', () => {
    const canvas = new FakeCanvas();
    const down: number[] = [];
    const up: number[] = [];
    const keyboard = attachDoomKeyboard(canvas, {
      ...keyExports,
      reportKeyDown: (key) => down.push(key),
      reportKeyUp: (key) => up.push(key),
    });

    const expected = [
      ['ArrowLeft', 'ArrowLeft', 11],
      ['ArrowRight', 'ArrowRight', 12],
      ['ArrowUp', 'ArrowUp', 13],
      ['ArrowDown', 'ArrowDown', 14],
      [',', 'Comma', 15],
      ['.', 'Period', 16],
      ['Control', 'ControlLeft', 17],
      [' ', 'Space', 18],
      ['Shift', 'ShiftLeft', 19],
      ['Tab', 'Tab', 20],
      ['Escape', 'Escape', 21],
      ['Enter', 'Enter', 22],
      ['Backspace', 'Backspace', 23],
      ['Alt', 'AltLeft', 24],
      ['q', 'KeyQ', 113],
    ] as const;

    for (const [key, code, value] of expected) {
      const pressed = keyboardEvent('keydown', key, code);
      const released = keyboardEvent('keyup', key, code);
      canvas.dispatchEvent(pressed);
      canvas.dispatchEvent(released);
      expect(pressed.defaultPrevented).toBe(true);
      expect(released.defaultPrevented).toBe(true);
      expect(down.at(-1)).toBe(value);
      expect(up.at(-1)).toBe(value);
    }

    const unmapped = keyboardEvent('keydown', 'F1');
    canvas.dispatchEvent(unmapped);
    expect(unmapped.defaultPrevented).toBe(false);
    expect(down).toHaveLength(expected.length);
    keyboard.dispose();
    expect(canvas.listenerCount()).toBe(0);
  });

  test('uses physical key identity across modifier changes', () => {
    const canvas = new FakeCanvas();
    const down: number[] = [];
    const up: number[] = [];
    const keyboard = attachDoomKeyboard(canvas, {
      ...keyExports,
      reportKeyDown: (key) => down.push(key),
      reportKeyUp: (key) => up.push(key),
    });

    canvas.dispatchEvent(keyboardEvent('keydown', '<', 'Comma'));
    canvas.dispatchEvent(keyboardEvent('keyup', ',', 'Comma'));
    canvas.dispatchEvent(keyboardEvent('keydown', 'W', 'KeyW'));
    canvas.dispatchEvent(keyboardEvent('keyup', 'w', 'KeyW'));

    expect(down).toEqual([15, 87]);
    expect(up).toEqual([15, 87]);
    keyboard.dispose();
  });

  test('releases held keys on window blur and hidden documents and removes every listener', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const windowTarget = new FakeCanvas();
    const documentTarget = Object.assign(new FakeCanvas(), { hidden: false });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowTarget });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: documentTarget });
    const canvas = new FakeCanvas();
    const released: number[] = [];
    const keyboard = attachDoomKeyboard(canvas, {
      ...keyExports,
      reportKeyDown: () => {},
      reportKeyUp: (key) => released.push(key),
    });
    try {
      canvas.dispatchEvent(keyboardEvent('keydown', 'ArrowLeft', 'ArrowLeft'));
      canvas.dispatchEvent(keyboardEvent('keydown', 'Control', 'ControlLeft'));
      canvas.dispatchEvent(keyboardEvent('keydown', 'Control', 'ControlRight'));
      windowTarget.dispatchEvent(new Event('blur'));
      expect(released).toEqual([11, 17]);
      canvas.dispatchEvent(keyboardEvent('keydown', 'w', 'KeyW'));
      documentTarget.dispatchEvent(new Event('visibilitychange'));
      expect(released).toEqual([11, 17]);
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event('visibilitychange'));
      expect(released).toEqual([11, 17, 119]);
      windowTarget.dispatchEvent(new Event('blur'));
      expect(released).toEqual([11, 17, 119]);
      keyboard.dispose();
      expect(canvas.listenerCount()).toBe(0);
      expect(windowTarget.listenerCount()).toBe(0);
      expect(documentTarget.listenerCount()).toBe(0);
    } finally {
      keyboard.dispose();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  test('releases every held key on blur and disposal', () => {
    const canvas = new FakeCanvas();
    const released: number[] = [];
    const keyboard = attachDoomKeyboard(canvas, {
      ...keyExports,
      reportKeyDown: () => {},
      reportKeyUp: (key) => released.push(key),
    });

    canvas.dispatchEvent(keyboardEvent('keydown', 'ArrowLeft', 'ArrowLeft'));
    canvas.dispatchEvent(keyboardEvent('keydown', 'w', 'KeyW'));
    canvas.dispatchEvent(new Event('blur'));
    expect(released).toEqual([11, 119]);

    canvas.dispatchEvent(keyboardEvent('keydown', 'Control', 'ControlLeft'));
    keyboard.dispose();
    expect(released).toEqual([11, 119, 17]);
    expect(canvas.listenerCount()).toBe(0);
  });
});

describe.serial('Doom runtime', () => {
  test('reports each streamed chunk against the response content length', async () => {
    const progress: Array<{ received: number; total: number | null }> = [];
    const bytes = [
      new Uint8Array([0, 0x61, 0x73]),
      new Uint8Array([0x6d, 1, 0]),
      new Uint8Array([0, 0, 0]),
    ];

    await expect(
      startDoom({
        canvas: asCanvas(new FakeCanvas()),
        fetch: async () => streamedResponse(bytes, 9),
        onProgress: (value) => progress.push(value),
        onFrame: () => {},
        onExit: () => {},
      }),
    ).rejects.toBeInstanceOf(WebAssembly.CompileError);
    expect(progress).toEqual([
      { received: 3, total: 9 },
      { received: 6, total: 9 },
      { received: 9, total: 9 },
    ]);
  });

  test('reports decoded download bytes without using a compressed Content-Length as the total', async () => {
    const progress: Array<{ received: number; total: number | null }> = [];
    const bytes = doomFixture(false);
    const encoded = streamedResponse([bytes.slice(0, 100), bytes.slice(100)], 80);
    encoded.headers.set('Content-Encoding', 'br');
    const session = await startDoom({
      canvas: asCanvas(new FakeCanvas()),
      fetch: async () => encoded,
      onProgress: (value) => progress.push(value),
      onFrame: () => {},
      onExit: () => {},
    });
    try {
      expect(progress).toEqual([
        { received: 100, total: null },
        { received: bytes.byteLength, total: null },
      ]);
    } finally {
      session.dispose();
    }
  });

  test('queues lifecycle cleanup until the active WebAssembly tick returns', async () => {
    const canvas = new FakeCanvas();
    const events: string[] = [];
    const exit = waitForExit((finish) => {
      void startDoom({
        canvas: asCanvas(canvas),
        fetch: async () => response(doomFixture()),
        onProgress: () => {},
        onFrame: (memory, pointer, width, height) => {
          expect(memory).toBeInstanceOf(WebAssembly.Memory);
          expect([pointer, width, height]).toEqual([0, 320, 200]);
          events.push('frame');
        },
        onExit: (code) => {
          events.push('exit');
          finish(code);
        },
      });
    });

    expect(await exit).toBe(0);
    expect(events).toEqual(['frame', 'exit']);
    expect(canvas.listenerCount()).toBe(0);
    await Bun.sleep(60);
    expect(events).toEqual(['frame', 'exit']);
  });

  test('defers fatal disposal requested synchronously from a frame callback', async () => {
    const canvas = new FakeCanvas();
    const events: string[] = [];
    const exited = deferred<number>();
    let session!: DoomSession;

    session = await startDoom({
      canvas: asCanvas(canvas),
      fetch: async () => response(doomFixture(false)),
      onProgress: () => {},
      onFrame: () => {
        events.push('frame:start');
        session.dispose();
        events.push(`listeners:${canvas.listenerCount()}`);
        events.push('frame:end');
      },
      onExit: (code) => {
        events.push('exit');
        exited.resolve(code);
      },
    });
    canvas.dispatchEvent(keyboardEvent('keydown', 'ArrowLeft', 'ArrowLeft'));

    expect(await exited.promise).toBe(1);
    expect(events).toEqual(['frame:start', 'listeners:3', 'frame:end', 'exit']);
    expect(canvas.listenerCount()).toBe(0);
  });

  test('rejects fetch and invalid WebAssembly failures without retaining the launch slot', async () => {
    const options = {
      canvas: asCanvas(new FakeCanvas()),
      onProgress: () => {},
      onFrame: () => {},
      onExit: () => {},
    };

    await expect(
      startDoom({ ...options, fetch: async () => Promise.reject(new Error('offline')) }),
    ).rejects.toThrow('offline');
    await expect(
      startDoom({ ...options, fetch: async () => response(new Uint8Array([1, 2, 3])) }),
    ).rejects.toBeInstanceOf(WebAssembly.CompileError);

    const session = await startDoom({
      ...options,
      fetch: async () => response(doomFixture(false)),
    });
    session.dispose();
  });

  test('rejects a duplicate while the first launch is still loading', async () => {
    const pending = deferred<Response>();
    const options = {
      canvas: asCanvas(new FakeCanvas()),
      fetch: () => pending.promise,
      onProgress: () => {},
      onFrame: () => {},
      onExit: () => {},
    };
    const first = startDoom(options);

    await expect(startDoom(options)).rejects.toThrow('already');
    pending.resolve(response(doomFixture(false)));
    const session = await first;
    session.dispose();
  });

  test('fatal cleanup after simulated context loss is idempotent and permits a new launch', async () => {
    const canvas = new FakeCanvas();
    const exits: number[] = [];
    const options = {
      canvas: asCanvas(canvas),
      fetch: async () => response(doomFixture(false)),
      onProgress: () => {},
      onFrame: () => {},
      onExit: (code: number) => exits.push(code),
    };
    const simulateUnrecoverableContextLoss = (session: DoomSession) => session.dispose();

    const first = await startDoom(options);
    simulateUnrecoverableContextLoss(first);
    first.dispose();
    expect(exits).toEqual([1]);
    expect(canvas.listenerCount()).toBe(0);

    const second = await startDoom(options);
    second.dispose();
    expect(exits).toEqual([1, 1]);
  });
});
