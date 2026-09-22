// Shared by startup and lazy hydration; local edits keep their explicit chmod mode.
export function programFormat(path: string, bytes: Uint8Array): 'js' | 'wasm' | undefined {
  if (bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109) return 'wasm';
  const header = new TextDecoder().decode(bytes.subarray(0, 80));
  if (/^#!\/usr\/bin\/env browser-js(?:\r?\n|$)/.test(header) || /\.(?:js|mjs)$/.test(path))
    return 'js';
}
export function publishedMode(path: string, bytes: Uint8Array): number {
  return programFormat(path, bytes) ||
    new TextDecoder().decode(bytes) === '#!/usr/bin/env portfolio-app\ndoom\n'
    ? 0o755
    : 0o644;
}
