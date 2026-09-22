export function assertDoomArtifact(bytes: Uint8Array<ArrayBuffer>): void {
  if (!WebAssembly.validate(bytes)) {
    throw new Error('The built Doom artifact is not valid WebAssembly');
  }

  const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes))
    .map(({ module, name }) => `${module}.${name}`)
    .sort();
  const expectedImports = [
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
  ];
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
    throw new Error(`The built Doom artifact has unexpected imports: ${imports.join(', ')}`);
  }
  assertLifecycleType(bytes);
  if (bytes.byteLength <= 4_000_000 || bytes.byteLength >= 5_000_000) {
    throw new Error(`The built Doom artifact has an unexpected size: ${bytes.byteLength} bytes`);
  }
}

function assertLifecycleType(bytes: Uint8Array): void {
  let offset = 8;
  const unsigned = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  const vector = () => {
    const length = unsigned();
    const values = bytes.subarray(offset, offset + length);
    offset += length;
    return values;
  };
  const types: Array<{ parameters: Uint8Array; results: Uint8Array }> = [];
  const decoder = new TextDecoder();
  while (offset < bytes.length) {
    const section = bytes[offset++];
    const length = unsigned();
    const end = offset + length;
    if (section === 1) {
      const count = unsigned();
      for (let i = 0; i < count; i++) {
        if (bytes[offset++] !== 0x60) throw new Error('Unsupported Doom function type');
        types.push({ parameters: vector(), results: vector() });
      }
    } else if (section === 2) {
      const count = unsigned();
      for (let i = 0; i < count; i++) {
        const module = decoder.decode(vector());
        const name = decoder.decode(vector());
        if (bytes[offset++] !== 0) throw new Error('Doom imports must be functions');
        const type = types[unsigned()];
        if (module === 'lifecycle' && name === 'onExit') {
          if (
            type.parameters.length !== 1 ||
            type.parameters[0] !== 0x7f ||
            type.results.length !== 0
          )
            throw new Error('lifecycle.onExit must have type (i32) -> ()');
          return;
        }
      }
    }
    offset = end;
  }
  throw new Error('Doom lifecycle.onExit import is missing');
}
