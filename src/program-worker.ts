// Serialized into a worker inside an opaque-origin iframe. Keep this function self-contained.
export function programWorker() {
  const send = (message: unknown) => postMessage(message);
  const stopped = {};
  let shown = false;
  let exited = false;
  let outputSize = 0;
  let onEvent: ((event: { id: string; type: string; value: string }) => unknown) | undefined;
  const exit = (code = 0): never => {
    if (!exited) {
      exited = true;
      send({ type: 'exit', code });
    }
    throw stopped;
  };
  const write = (text: unknown, error = false) => {
    const value = String(text);
    outputSize += value.length;
    if (outputSize > 1048576) throw new Error('Program output exceeded 1 MiB');
    send({ type: 'output', text: value, error });
  };
  const fail = (error: unknown) => {
    if (error === stopped || exited) return;
    send({ type: 'output', text: String(error) + '\n', error: true });
    exited = true;
    send({ type: 'exit', code: 1 });
  };
  addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    fail((event as PromiseRejectionEvent).reason);
  });
  addEventListener('error', (event) => {
    event.preventDefault();
    fail((event as ErrorEvent).message);
  });
  let started = false;
  onmessage = async (event) => {
    try {
      if (event.data.type === 'event') {
        await onEvent?.(event.data.event);
        return;
      }
      if (started) return;
      started = true;
      const { args, format, bytes } = event.data;
      const view = (html: string) => {
        if (html.length > 262144) throw new Error('View exceeded 256 KiB');
        shown = true;
        send({ type: 'view', html });
      };
      const api = Object.freeze({
        args: Object.freeze(args),
        print: (...values: unknown[]) => write(values.map(String).join(' ') + '\n'),
        write: (text: unknown) => write(text),
        error: (...values: unknown[]) => write(values.map(String).join(' ') + '\n', true),
        view,
        onEvent: (handler: typeof onEvent) => {
          onEvent = handler;
        },
        exit,
      });
      let code: unknown;
      if (format === 'js') {
        Object.assign(globalThis, { api });
        console.log = api.print;
        console.error = api.error;
        console.warn = api.error;
        const source = new TextDecoder().decode(bytes).replace(/^#![^\n]*(?:\n|$)/, '');
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        try {
          const module = await import(url);
          if (typeof module.default === 'function') code = await module.default(api);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        let memory: WebAssembly.Memory;
        const range = (pointer: number, length: number) => {
          if (!memory || pointer < 0 || length < 0 || pointer + length > memory.buffer.byteLength)
            throw new Error('Wasm memory range out of bounds');
          return new Uint8Array(memory.buffer, pointer, length);
        };
        const text = (pointer: number, length: number) =>
          new TextDecoder().decode(range(pointer, length));
        const argument = (index: number) => {
          if (!Number.isInteger(index) || index < 0 || index >= args.length)
            throw new Error('Invalid argument index');
          return new TextEncoder().encode(args[index]);
        };
        const { instance } = await WebAssembly.instantiate(bytes, {
          env: {
            write: (fd: number, pointer: number, length: number) => {
              if (fd !== 1 && fd !== 2) return -1;
              write(text(pointer, length), fd === 2);
              return length;
            },
            exit,
            arg_count: () => args.length,
            arg_len: (index: number) => argument(index).length,
            arg_copy: (index: number, pointer: number, capacity: number) => {
              const value = argument(index);
              if (capacity < value.length) return -1;
              range(pointer, value.length).set(value);
              return value.length;
            },
            view: (pointer: number, length: number) => view(text(pointer, length)),
          },
        });
        memory = instance.exports.memory as WebAssembly.Memory;
        const main = instance.exports._start || instance.exports.main;
        if (typeof main !== 'function') throw new Error('Wasm must export main or _start');
        onEvent = (event) => {
          if (event.type === 'click' && typeof instance.exports.on_event === 'function') {
            const id = Number(event.id);
            if (Number.isInteger(id)) instance.exports.on_event(id);
          }
        };
        code = main();
      }
      if (!shown) exit(typeof code === 'number' ? code : 0);
    } catch (error) {
      fail(error);
    }
  };
}
