export type DisplayConfig = { crt: boolean; bloom: boolean };
type ConfigStorage = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'portfolio:config';

function browserStorage(): ConfigStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function readDisplayConfig(
  defaultBloom: boolean,
  storage = browserStorage(),
): DisplayConfig {
  const config = { crt: true, bloom: defaultBloom };
  try {
    const crt = storage?.getItem('portfolio:crt');
    const bloom = storage?.getItem('portfolio:bloom');
    if (crt === 'on' || crt === 'off') config.crt = crt === 'on';
    if (bloom === 'on' || bloom === 'off') config.bloom = bloom === 'on';
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    if (typeof saved?.crt === 'boolean') config.crt = saved.crt;
    if (typeof saved?.bloom === 'boolean') config.bloom = saved.bloom;
  } catch {}
  return config;
}

export function saveDisplayConfig(
  change: Partial<DisplayConfig>,
  defaultBloom: boolean,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({ ...readDisplayConfig(defaultBloom, storage), ...change }),
    );
  } catch {}
}
