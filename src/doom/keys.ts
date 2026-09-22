export type DoomKeyExports = {
  KEY_LEFTARROW: number | WebAssembly.Global;
  KEY_RIGHTARROW: number | WebAssembly.Global;
  KEY_UPARROW: number | WebAssembly.Global;
  KEY_DOWNARROW: number | WebAssembly.Global;
  KEY_STRAFE_L: number | WebAssembly.Global;
  KEY_STRAFE_R: number | WebAssembly.Global;
  KEY_FIRE: number | WebAssembly.Global;
  KEY_USE: number | WebAssembly.Global;
  KEY_SHIFT: number | WebAssembly.Global;
  KEY_TAB: number | WebAssembly.Global;
  KEY_ESCAPE: number | WebAssembly.Global;
  KEY_ENTER: number | WebAssembly.Global;
  KEY_BACKSPACE: number | WebAssembly.Global;
  KEY_ALT: number | WebAssembly.Global;
  reportKeyDown(key: number): void;
  reportKeyUp(key: number): void;
};

export type DoomKeyboard = {
  dispose(): void;
};

function globalValue(value: number | WebAssembly.Global): number {
  return typeof value === 'number' ? value : Number(value.value);
}

function createKeyMap(exports: DoomKeyExports): Map<string, number> {
  return new Map([
    ['ArrowLeft', globalValue(exports.KEY_LEFTARROW)],
    ['ArrowRight', globalValue(exports.KEY_RIGHTARROW)],
    ['ArrowUp', globalValue(exports.KEY_UPARROW)],
    ['ArrowDown', globalValue(exports.KEY_DOWNARROW)],
    ['Comma', globalValue(exports.KEY_STRAFE_L)],
    ['Period', globalValue(exports.KEY_STRAFE_R)],
    ['ControlLeft', globalValue(exports.KEY_FIRE)],
    ['ControlRight', globalValue(exports.KEY_FIRE)],
    ['Space', globalValue(exports.KEY_USE)],
    ['ShiftLeft', globalValue(exports.KEY_SHIFT)],
    ['ShiftRight', globalValue(exports.KEY_SHIFT)],
    ['Tab', globalValue(exports.KEY_TAB)],
    ['Escape', globalValue(exports.KEY_ESCAPE)],
    ['Enter', globalValue(exports.KEY_ENTER)],
    ['NumpadEnter', globalValue(exports.KEY_ENTER)],
    ['Backspace', globalValue(exports.KEY_BACKSPACE)],
    ['AltLeft', globalValue(exports.KEY_ALT)],
    ['AltRight', globalValue(exports.KEY_ALT)],
  ]);
}

function translateKey(event: KeyboardEvent, keys: Map<string, number>): number | null {
  const mapped = keys.get(event.code);
  if (mapped !== undefined) return mapped;
  if (event.key.length !== 1) return null;
  const character = event.key.charCodeAt(0);
  return character <= 255 ? character : null;
}

export function attachDoomKeyboard(target: EventTarget, exports: DoomKeyExports): DoomKeyboard {
  const keys = createKeyMap(exports);
  const held = new Map<string, number>();
  let disposed = false;
  const browserWindow = typeof window === 'undefined' ? undefined : window;
  const browserDocument = typeof document === 'undefined' ? undefined : document;

  const consume = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const keydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    const key = translateKey(keyboardEvent, keys);
    if (key === null) return;
    consume(event);
    const identity = keyboardEvent.code || keyboardEvent.key;
    if (held.has(identity)) return;
    const alreadyHeld = [...held.values()].includes(key);
    held.set(identity, key);
    if (!alreadyHeld) exports.reportKeyDown(key);
  };

  const keyup = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    const identity = keyboardEvent.code || keyboardEvent.key;
    const heldKey = held.get(identity);
    const key = heldKey ?? translateKey(keyboardEvent, keys);
    if (key === null) return;
    consume(event);
    if (heldKey === undefined) return;
    held.delete(identity);
    if (![...held.values()].includes(heldKey)) exports.reportKeyUp(heldKey);
  };

  const release = () => {
    const keys = new Set(held.values());
    held.clear();
    for (const key of keys) exports.reportKeyUp(key);
  };

  const visibilityChanged = () => {
    if (browserDocument?.hidden) release();
  };

  browserWindow?.addEventListener('blur', release);
  browserDocument?.addEventListener('visibilitychange', visibilityChanged);
  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', release);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('keyup', keyup);
      target.removeEventListener('blur', release);
      browserWindow?.removeEventListener('blur', release);
      browserDocument?.removeEventListener('visibilitychange', visibilityChanged);
      release();
    },
  };
}
