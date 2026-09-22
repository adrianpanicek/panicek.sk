import { expect, test } from 'bun:test';
import { createFilesystem, snapshot, overlayBetween } from '../src/filesystem';
import { createShell } from '../src/shell';

const base = {
  '/home/web/ABOUT.md': 'About',
  '/home/web/blog': { directory: true as const },
  '/blog': { target: '/home/web/blog' },
};
function server() {
  const requests: string[] = [];
  const fetcher = async (url: string) => {
    requests.push(url);
    const responses: Record<string, unknown> = {
      '/_files/home/web/blog/': [
        { name: 'INDEX.md', type: 'file' },
        { name: 'nested', type: 'directory' },
      ],
      '/_files/home/web/blog/INDEX.md': '# Blog',
      '/_files/home/web/blog/nested/': [{ name: 'post.md', type: 'file' }],
      '/_files/home/web/blog/nested/post.md': 'Deep post',
    };
    const value = responses[url];
    return value === undefined
      ? new Response(null, { status: 404 })
      : typeof value === 'string'
        ? new Response(value)
        : Response.json(value);
  };
  return { requests, fetcher };
}
test('directory aliases load on demand across shell commands and snapshots stay lazy', async () => {
  const { requests, fetcher } = server();
  const baseline = await snapshot(await createFilesystem(base));
  const fs = await createFilesystem(base, {}, { fetcher, baseline });
  const shell = createShell(fs);
  await shell.exec(':');
  Object.assign(baseline, await snapshot(fs));
  expect(requests).toEqual([]);
  expect((await shell.exec('ls /blog')).stdout).toContain('INDEX.md');
  expect(requests).toEqual(['/_files/home/web/blog/', '/_files/home/web/blog/INDEX.md']);
  expect(overlayBetween(baseline, await snapshot(fs))).toEqual({});
  expect((await shell.exec('render /blog')).documents[0]).toEqual({
    path: '/home/web/blog/INDEX.md',
    text: '# Blog',
  });
  expect((await shell.exec('cat /blog/nested/post.md')).stdout).toBe('Deep post');
  await shell.exec('echo edited > /blog/INDEX.md');
  expect(Object.keys(overlayBetween(baseline, await snapshot(fs)))).toEqual([
    '/home/web/blog/INDEX.md',
  ]);
});
test('saved edits and deletions mask remote files after reload', async () => {
  const { fetcher } = server();
  const fs = await createFilesystem(base, { '/home/web/blog/INDEX.md': null }, { fetcher });
  expect(await fs.readdir('/blog')).toEqual(['nested']);
  expect(await fs.exists('/blog/INDEX.md')).toBe(false);
});
test('failed directory requests can be retried', async () => {
  const { fetcher } = server();
  let fail = true;
  const fs = await createFilesystem(
    base,
    {},
    { fetcher: async (url) => (fail ? new Response(null, { status: 503 }) : fetcher(url)) },
  );
  await expect(fs.readdir('/blog')).rejects.toThrow();
  fail = false;
  expect(await fs.readdir('/blog')).toContain('INDEX.md');
});
test('untrusted listing names cannot escape the published tree', async () => {
  for (const name of ['..', '../secret', '/etc/passwd', 'a\\b', '%2e%2e', 'a\0b']) {
    const requests: string[] = [];
    const fs = await createFilesystem(
      base,
      {},
      {
        fetcher: async (url) => {
          requests.push(url);
          return Response.json([{ name, type: 'file' }]);
        },
      },
    );
    await expect(fs.readdir('/blog')).rejects.toThrow('Invalid directory entry');
    expect(requests).toEqual(['/_files/home/web/blog/']);
  }
});
test('deleting a published directory keeps it deleted on reload', async () => {
  const { requests, fetcher } = server();
  const fs = await createFilesystem(base, { '/home/web/blog': null }, { fetcher });
  await expect(fs.readdir('/blog')).rejects.toThrow();
  expect(requests).toEqual([]);
});
test('recursive copy hydrates descendants and alias writes preserve canonical files', async () => {
  const { fetcher } = server();
  const fs = await createFilesystem(base, {}, { fetcher });
  await fs.cp('/blog', '/tmp/copy', { recursive: true });
  expect(await fs.readFile('/tmp/copy/nested/post.md')).toBe('Deep post');
  await fs.writeFile('/blog/INDEX.md', 'changed');
  expect(await fs.readFile('/home/web/blog/INDEX.md')).toBe('changed');
});
test('saving an unrelated command retains tombstones for unloaded files', async () => {
  const { fetcher, requests } = server();
  const previous = { '/home/web/blog/INDEX.md': null };
  const baseline = await snapshot(await createFilesystem(base));
  const fs = await createFilesystem(base, previous, { fetcher, baseline });
  const saved = overlayBetween(baseline, await snapshot(fs), previous);
  expect(saved).toEqual(previous);
  expect(requests).toEqual([]);
  const restored = await createFilesystem(base, saved, { fetcher });
  expect(await restored.readdir('/blog')).toEqual(['nested']);
});
test('lightweight raw reader shares lazy hydration and overlay semantics', async () => {
  const { remoteSnapshot } = await import('../src/remote-snapshot');
  const { readRaw } = await import('../src/raw-files');
  const { fetcher, requests } = server();
  const baseSnapshot = await snapshot(await createFilesystem(base));
  const fs = remoteSnapshot(baseSnapshot, {}, { fetcher });
  expect(requests).toEqual([]);
  expect(await (await readRaw('/blog/nested/post.md', fs)).text()).toBe('Deep post');
  const deleted = remoteSnapshot(
    baseSnapshot,
    { '/home/web/blog/nested/post.md': null },
    { fetcher },
  );
  expect((await readRaw('/blog/nested/post.md', deleted)).status).toBe(404);
  const edited = remoteSnapshot(
    baseSnapshot,
    { '/home/web/blog/nested/post.md': { type: 'file', mode: 420, data: btoa('local') } },
    { fetcher },
  );
  expect(await (await readRaw('/blog/nested/post.md', edited)).text()).toBe('local');
});

test('lazy browser programs get executable modes without overriding saved chmod', async () => {
  let fetched = 0;
  const fetcher = async (url: string) => {
    fetched++;
    return url.endsWith('/')
      ? Response.json([{ name: 'hello', type: 'file' }])
      : new Response('#!/usr/bin/env browser-js\napi.print("hi");');
  };
  const baseline = await snapshot(await createFilesystem(base));
  const fs = await createFilesystem(base, {}, { fetcher, baseline });
  expect(fetched).toBe(0);
  expect((await createShell(fs).exec('/blog/hello')).application?.name).toBe('browser');
  expect(fetched).toBe(2);
  expect((await fs.stat('/blog/hello')).mode & 0o111).toBe(0o111);
  await fs.chmod('/blog/hello', 0o644);
  const overlay = overlayBetween(baseline, await snapshot(fs));
  const restored = await createFilesystem(base, overlay, { fetcher });
  expect((await createShell(restored).exec('/blog/hello')).stderr).toContain('Permission denied');
});
