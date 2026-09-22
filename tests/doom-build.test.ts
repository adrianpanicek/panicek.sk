import { assertDoomArtifact } from '../scripts/doom-artifact';
import { expect, test } from 'bun:test';

const upstreamRevision = '31cc1af9656a8184830090c4e9f268383f5d7e15';

test('pinned Doom shareware artifact exposes the clean-exit lifecycle import', async () => {
  const artifact = Bun.file('vendor/doom/doom.wasm');
  expect(await artifact.exists()).toBe(true);

  const bytes = new Uint8Array(await artifact.arrayBuffer());
  expect(WebAssembly.validate(bytes)).toBe(true);
  expect(() => assertDoomArtifact(bytes)).not.toThrow();

  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module)
    .map(({ module: importModule, name }) => `${importModule}.${name}`)
    .sort();
  expect(imports).toEqual([
    'console.onErrorMessage',
    'console.onInfoMessage',
    'gameSaving.readSaveGame',
    'gameSaving.sizeOfSaveGame',
    'gameSaving.writeSaveGame',
    'lifecycle.onExit',
    'loading.onGameInit',
    'loading.readWads',
    'loading.wadSizes',
    'runtimeControl.timeInMilliseconds',
    'ui.drawFrame',
  ]);
  expect(bytes.byteLength).toBeGreaterThan(4_000_000);
  expect(bytes.byteLength).toBeLessThan(5_000_000);

  const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const sourceMetadata = await Bun.file('vendor/doom/SOURCE.md').text();
  expect(sourceMetadata).toContain(upstreamRevision);
  expect(sourceMetadata).toContain(digest);
});

test('vendored Doom quits through its real menu without trapping in exit callbacks', async () => {
  let time = 1000;
  const exits: number[] = [];
  const { instance } = await WebAssembly.instantiate(
    await Bun.file('vendor/doom/doom.wasm').bytes(),
    {
      loading: { onGameInit() {}, wadSizes() {}, readWads() {} },
      ui: { drawFrame() {} },
      runtimeControl: { timeInMilliseconds: () => BigInt(++time) },
      console: { onInfoMessage() {}, onErrorMessage() {} },
      gameSaving: { sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0 },
      lifecycle: { onExit: (code: number) => exits.push(code) },
    },
  );
  const game = instance.exports as unknown as {
    initGame(): void;
    tickGame(): void;
    reportKeyDown(key: number): void;
    reportKeyUp(key: number): void;
    KEY_ESCAPE: WebAssembly.Global;
    KEY_ENTER: WebAssembly.Global;
  };
  const tick = () => {
    time += 29;
    game.tickGame();
  };
  const press = (key: number) => {
    game.reportKeyDown(key);
    tick();
    game.reportKeyUp(key);
    tick();
  };
  game.initGame();
  tick();
  press(Number(game.KEY_ESCAPE.value));
  press('q'.charCodeAt(0));
  press(Number(game.KEY_ENTER.value));
  expect(exits).toEqual([]);
  press('y'.charCodeAt(0));
  expect(exits).toEqual([0]);
});

function artifactWithExitType(parameters: number[], results: number[]): Uint8Array<ArrayBuffer> {
  const unsigned = (value: number): number[] => {
    const bytes = [];
    do {
      const byte = value & 127;
      value >>>= 7;
      bytes.push(byte | (value ? 128 : 0));
    } while (value);
    return bytes;
  };
  const string = (value: string) => [value.length, ...new TextEncoder().encode(value)];
  const names = [
    ['console', 'onErrorMessage'],
    ['console', 'onInfoMessage'],
    ['gameSaving', 'readSaveGame'],
    ['gameSaving', 'sizeOfSaveGame'],
    ['gameSaving', 'writeSaveGame'],
    ['lifecycle', 'onExit'],
    ['loading', 'onGameInit'],
    ['loading', 'readWads'],
    ['loading', 'wadSizes'],
    ['runtimeControl', 'timeInMilliseconds'],
    ['ui', 'drawFrame'],
  ];
  const types = [1, 0x60, parameters.length, ...parameters, results.length, ...results];
  const imports = [
    names.length,
    ...names.flatMap(([module, name]) => [...string(module), ...string(name), 0, 0]),
  ];
  const prefix = [
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    1,
    ...unsigned(types.length),
    ...types,
    2,
    ...unsigned(imports.length),
    ...imports,
    0,
    ...unsigned(4_000_000),
  ];
  const bytes = new Uint8Array(prefix.length + 4_000_000);
  bytes.set(prefix);
  return bytes;
}

test.each([
  [[], []],
  [[0x7e], []],
  [[0x7f, 0x7f], []],
  [[0x7f], [0x7f]],
])(
  'rejects a valid Doom-shaped artifact with incompatible lifecycle parameters %j and results %j',
  (parameters, results) => {
    const bytes = artifactWithExitType(parameters, results);
    expect(WebAssembly.validate(bytes)).toBe(true);
    expect(() => assertDoomArtifact(bytes)).toThrow('lifecycle.onExit must have type (i32) -> ()');
  },
);

test('accepts the exact lifecycle i32 argument and no-result ABI', () => {
  expect(() => assertDoomArtifact(artifactWithExitType([0x7f], []))).not.toThrow();
});
