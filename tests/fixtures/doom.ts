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

export function doomBrowserFixture(start: 'draw' | 'trap' | 'exit' = 'draw'): Uint8Array {
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
  const memory = vector([[0, ...encodeUnsigned(4)]]);
  const globals = vector(
    constants.map(([, value]) => [0x7f, 0, 0x41, ...encodeSigned(value), 0x0b]),
  );
  const exports = vector([
    [...wasmString('memory'), 2, 0],
    [...wasmString('quit'), 0, 0],
    [...wasmString('initGame'), 0, 3],
    [...wasmString('tickGame'), 0, 4],
    [...wasmString('reportKeyDown'), 0, 5],
    [...wasmString('reportKeyUp'), 0, 6],
    ...constants.map(([name], index) => [...wasmString(name), 3, ...encodeUnsigned(index)]),
  ]);
  const initBody = [
    0,
    0x41,
    ...encodeSigned(320),
    0x41,
    ...encodeSigned(200),
    0x10,
    2,
    0x41,
    0,
    0x10,
    1,
    0x0b,
  ];
  const tickBody = [0, 0x41, 0, 0x10, 1, 0x0b];
  const codes = vector(
    [
      start === 'trap' ? [0, 0, 0x0b] : start === 'exit' ? [0, 0x41, 0, 0x10, 0, 0x0b] : initBody,
      tickBody,
      [0, 0x0b],
      [0, 0x0b],
    ].map((body) => [...encodeUnsigned(body.length), ...body]),
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
