import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mkdtemp, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, unpack } from '../deploy/pull';

function site() {
  return Object.fromEntries(
    [
      'index.html',
      'filesystem.json',
      'snapshot.json',
      'robots.txt',
      'service-worker.js',
      'assets/client.js',
      'assets/shell.worker.js',
      'assets/styles.css',
      'assets/vim.js',
    ].map((path) => [
      path,
      strToU8(
        path === 'index.html'
          ? '<main id="transcript"><script src="/assets/client.js"></script></main>'
          : '{}',
      ),
    ]),
  );
}

test('deployment rejects traversal, missing files and oversized expanded archives', () => {
  expect(() => unpack(zipSync({ ...site(), '../escape': strToU8('bad') }))).toThrow(
    'Unsafe archive path',
  );
  expect(() => unpack(zipSync({ ...site(), '/absolute': strToU8('bad') }))).toThrow(
    'Unsafe archive path',
  );
  expect(() => unpack(zipSync({ 'index.html': strToU8('bad') }))).toThrow('Missing required file');
  expect(() => unpack(zipSync({ ...site(), large: new Uint8Array(17 * 1024 * 1024) }))).toThrow(
    'size limit',
  );
  expect(Object.keys(unpack(zipSync(site())))).toHaveLength(9);
});

test('deployment switches releases atomically and keeps current when master changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'panicek-deploy-'));
  try {
    await activate(root, 'master-1-1', site(), async () => true);
    const first = await readlink(join(root, 'current'));
    await expect(activate(root, 'master-2-1', site(), async () => false)).rejects.toThrow(
      'Master changed',
    );
    expect(await readlink(join(root, 'current'))).toBe(first);
    await activate(root, 'master-2-1', site(), async () => true);
    expect(await readlink(join(root, 'current'))).toBe(join(root, 'releases', 'master-2-1'));
    expect((await Bun.file(join(root, '.deployed.json')).json()).previous).toBe(first);
    expect(await Bun.file(join(first, 'index.html')).exists()).toBe(true);
    await activate(root, 'master-2-1', site(), async () => true);
    expect(await Bun.file(join(root, 'current', 'index.html')).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
