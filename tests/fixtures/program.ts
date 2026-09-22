// Small independent Wasm fixture exercising host imports and exported memory.
export function programFixture(): Uint8Array {
  const str = (s: string) => [s.length, ...new TextEncoder().encode(s)];
  const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, [2, 0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f, 0x60, 0, 1, 0x7f]),
    ...section(2, [
      2,
      ...str('env'),
      ...str('write'),
      0,
      0,
      ...str('env'),
      ...str('arg_count'),
      0,
      1,
    ]),
    ...section(3, [1, 1]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, ...str('memory'), 2, 0, ...str('main'), 0, 2]),
    ...section(10, [1, 13, 0, 0x41, 1, 0x41, 0, 0x41, 9, 0x10, 0, 0x1a, 0x10, 1, 0x0b]),
    ...section(11, [1, 0, 0x41, 0, 0x0b, ...str('wasm says')]),
  ]);
}
