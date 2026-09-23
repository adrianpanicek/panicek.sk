import { expect, test } from 'bun:test';
import { readDisplayConfig, saveDisplayConfig } from '../src/display-config';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('saving either display setting preserves the other across new reads', () => {
  const saved = storage();
  saveDisplayConfig({ crt: false }, true, saved);
  saveDisplayConfig({ bloom: false }, true, saved);
  expect(readDisplayConfig(true, saved)).toEqual({ crt: false, bloom: false });
  saveDisplayConfig({ crt: true }, true, saved);
  expect(readDisplayConfig(false, saved)).toEqual({ crt: true, bloom: false });
  expect(JSON.parse(saved.getItem('portfolio:config')!)).toEqual({ crt: true, bloom: false });
});

test('existing choices migrate when saving and explicit configuration wins over legacy keys', () => {
  const saved = storage({ 'portfolio:crt': 'off', 'portfolio:bloom': 'on' });
  expect(readDisplayConfig(false, saved)).toEqual({ crt: false, bloom: true });
  saveDisplayConfig({ bloom: false }, false, saved);
  expect(readDisplayConfig(true, saved)).toEqual({ crt: false, bloom: false });
});

test('missing, malformed, and unavailable storage use valid browser defaults', () => {
  expect(readDisplayConfig(false, storage())).toEqual({ crt: true, bloom: false });
  expect(readDisplayConfig(true, storage({ 'portfolio:config': '{bad' }))).toEqual({
    crt: true,
    bloom: true,
  });
  expect(
    readDisplayConfig(false, storage({ 'portfolio:config': '{"crt":"off","bloom":true}' })),
  ).toEqual({ crt: true, bloom: true });
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readDisplayConfig(false, blocked)).toEqual({ crt: true, bloom: false });
  expect(() => saveDisplayConfig({ crt: false }, false, blocked)).not.toThrow();
});
