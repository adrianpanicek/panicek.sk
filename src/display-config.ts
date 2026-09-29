export type DisplayConfig = {crt: boolean; animations: boolean};

type ConfigStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'portfolio:config';

function browserStorage(): ConfigStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function readDisplayConfig(storage = browserStorage()): DisplayConfig {
  const config = {crt: false, animations: true};

  try {
    const crt = storage?.getItem('portfolio:crt');

    if (crt === 'on' || crt === 'off') {
      config.crt = crt === 'on';
    }

    const saved = JSON.parse(storage?.getItem(KEY) || 'null');

    if (typeof saved?.crt === 'boolean') {
      config.crt = saved.crt;
    }

    if (typeof saved?.animations === 'boolean') {
      config.animations = saved.animations;
    }
  } catch {}

  return config;
}

export function saveDisplayConfig(
  change: Partial<DisplayConfig>,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({...readDisplayConfig(storage), ...change}),
    );
  } catch {}
}
