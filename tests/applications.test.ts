import { describe, expect, test } from 'bun:test';
import { canLaunchDoom, type LaunchEnvironment } from '../src/applications';

const desktop: LaunchEnvironment = {
  coarsePointer: false,
  finePointer: true,
  viewportWidth: 1280,
  viewportHeight: 900,
  webAssembly: true,
};

describe('Doom launch eligibility', () => {
  test('accepts a fine-pointer desktop with WebAssembly', () => {
    expect(canLaunchDoom(desktop)).toBe(true);
    expect(canLaunchDoom({ ...desktop, viewportWidth: 640, viewportHeight: 480 })).toBe(true);
  });

  test('rejects pointerless environments', () => {
    expect(canLaunchDoom({ ...desktop, finePointer: false })).toBe(false);
  });

  test('rejects coarse-pointer input', () => {
    expect(canLaunchDoom({ ...desktop, coarsePointer: true })).toBe(false);
  });

  test('rejects a 390x844 phone viewport', () => {
    expect(canLaunchDoom({ ...desktop, viewportWidth: 390, viewportHeight: 844 })).toBe(false);
  });

  test('rejects a viewport shorter than the 480px game minimum', () => {
    expect(canLaunchDoom({ ...desktop, viewportHeight: 479 })).toBe(false);
  });

  test('rejects environments without WebAssembly', () => {
    expect(canLaunchDoom({ ...desktop, webAssembly: false })).toBe(false);
  });
});
