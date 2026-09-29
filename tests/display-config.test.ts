import {expect, test} from 'bun:test';
import {readDisplayConfig, saveDisplayConfig} from '../src/display-config';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('saving display settings preserves the other across new reads', () => {
  const saved = storage();
  saveDisplayConfig({crt: false}, saved);
  saveDisplayConfig({animations: false}, saved);
  expect(readDisplayConfig(saved)).toEqual({
    crt: false,
    animations: false,
  });
  saveDisplayConfig({crt: true}, saved);
  expect(readDisplayConfig(saved)).toEqual({
    crt: true,
    animations: false,
  });
  expect(JSON.parse(saved.getItem('portfolio:config')!)).toEqual({
    crt: true,
    animations: false,
  });
});

test('existing choices migrate when saving and explicit configuration wins over legacy keys', () => {
  const saved = storage({'portfolio:crt': 'off', 'portfolio:bloom': 'on'});
  expect(readDisplayConfig(saved)).toEqual({
    crt: false,
    animations: true,
  });
  saveDisplayConfig({crt: true}, saved);
  expect(readDisplayConfig(saved)).toEqual({
    crt: true,
    animations: true,
  });
});

test('missing, malformed, and unavailable storage use valid browser defaults', () => {
  expect(readDisplayConfig(storage())).toEqual({
    crt: false,
    animations: true,
  });
  expect(readDisplayConfig(storage({'portfolio:config': '{bad'}))).toEqual({
    crt: false,
    animations: true,
  });
  expect(
    readDisplayConfig(
      storage({'portfolio:config': '{"crt":"off","bloom":true}'}),
    ),
  ).toEqual({crt: false, animations: true});
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(readDisplayConfig(blocked)).toEqual({
    crt: false,
    animations: true,
  });
  expect(() => saveDisplayConfig({crt: false}, blocked)).not.toThrow();
});

test('animation preference persists independently of CRT', () => {
  const saved = storage();
  saveDisplayConfig({animations: false}, saved);
  saveDisplayConfig({crt: false}, saved);
  expect(readDisplayConfig(saved)).toEqual({
    crt: false,
    animations: false,
  });
});
