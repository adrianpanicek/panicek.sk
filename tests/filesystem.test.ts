import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { createFilesystem, snapshot, overlayBetween, readRaw } from '../src/filesystem';
import { loadState, commitState } from '../src/storage';
import { createShell } from '../src/shell';

const base = { '/home/web/ABOUT.md': '# Original\n', '/home/web/CAREER.md': '# Career\n' };
test('shell writes, deletion, binary files and symlinks survive overlay restore', async () => {
  const fs = await createFilesystem(base);
  const before = await snapshot(fs);
  const shell = createShell(fs);
  expect(
    (await shell.exec('echo hello > /tmp/new.txt; rm ~/ABOUT.md; ln -s /tmp/new.txt ~/link.txt'))
      .exitCode,
  ).toBe(0);
  await fs.writeFile('/tmp/data.bin', new Uint8Array([0, 255, 128, 1]));
  const overlay = overlayBetween(before, await snapshot(fs));
  const restored = await createFilesystem({ ...base, '/home/web/NEW.md': 'new release' }, overlay);
  expect(await (await readRaw('/~/link.txt', restored)).text()).toBe('hello\n');
  expect((await readRaw('/~/ABOUT.md', restored)).status).toBe(404);
  expect(await (await readRaw('/~/NEW.md', restored)).text()).toBe('new release');
  expect(new Uint8Array(await (await readRaw('/tmp/data.bin', restored)).arrayBuffer())).toEqual(
    new Uint8Array([0, 255, 128, 1]),
  );
  expect(await (await readRaw('/tmp/', restored)).text()).toContain('/tmp/new.txt');
});
test('raw routes detect symlink cycles', async () => {
  const fs = await createFilesystem(base);
  await fs.symlink('/tmp/b', '/tmp/a');
  await fs.symlink('/tmp/a', '/tmp/b');
  expect((await readRaw('/tmp/a', fs)).status).toBe(404);
});
test('revision transactions reject stale writers and retain the newer data', async () => {
  const initial = await loadState();
  const overlay = { '/tmp/a': { type: 'file' as const, data: 'aGk=', mode: 420 } };
  const next = await commitState(initial.revision, overlay);
  expect(next.revision).toBe(initial.revision + 1);
  await expect(commitState(initial.revision, {})).rejects.toThrow('another tab');
  expect((await loadState()).overlay).toEqual(overlay);
});
test('shell preserves cwd and supports pipes', async () => {
  const shell = createShell(await createFilesystem(base));
  await shell.exec('cd /tmp');
  expect(shell.getCwd()).toBe('/tmp');
  expect((await shell.exec('printf "b\\na\\n" | sort')).stdout).toBe('a\nb\n');
});
test('web identity is reflected by standard commands', async () => {
  const shell = createShell(await createFilesystem(base));
  expect((await shell.exec('whoami')).stdout).toBe('web\n');
  expect((await shell.exec('hostname')).stdout).toBe('panicek.sk\n');
});
test('common shell tools operate on the shared filesystem', async () => {
  const shell = createShell(await createFilesystem(base));
  const checks = [
    ['printf "a\\nb\\na\\n" | sort | uniq -c', '2 a'],
    ['printf "one two\\n" | awk \'{print $2}\'', 'two'],
    ['echo hello | sed s/hello/world/', 'world'],
    ['printf "a,b\\n" | cut -d, -f2', 'b'],
    ['echo hello | tr a-z A-Z', 'HELLO'],
    ['find /home/web -name CAREER.md', '/home/web/CAREER.md'],
    ['for i in 1 2 3; do echo $i; done | wc -l', '3'],
    [
      'mkdir /tmp/test; cp ~/CAREER.md /tmp/test/a; mv /tmp/test/a /tmp/test/b; cat /tmp/test/b',
      '# Career',
    ],
  ];
  for (const [command, expected] of checks) {
    const result = await shell.exec(command);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(expected);
  }
});
test('only explicit render formats output, preserving source and UTF-8', async () => {
  const shell = createShell(await createFilesystem(base));
  expect((await shell.exec('cat ~/CAREER.md')).documents).toEqual([]);
  expect((await shell.exec('cat ~/CAREER.md | render')).documents[0]?.path).toBe(
    '/home/web/CAREER.md',
  );
  expect((await shell.exec("printf '# Héllo\\n' | render")).documents[0]?.text).toBe('# Héllo\n');
  expect((await shell.exec('cat ~/CAREER.md | render | head')).documents).toEqual([]);
  expect((await shell.exec('cat ~/CAREER.md | render > /tmp/plain')).documents).toEqual([]);
  expect((await shell.exec('render < ~/CAREER.md')).documents[0]?.path).toBe('/home/web/CAREER.md');
  expect((await shell.exec('cat ~/CAREER.md | head')).documents).toEqual([]);
});
test('lightweight raw reader agrees with live shell for every persisted entry', async () => {
  const { snapshotReader } = await import('../src/raw-files');
  const fs = await createFilesystem(base);
  await fs.mkdir('/tmp/deep', { recursive: true });
  await fs.writeFile('/tmp/deep/binary', new Uint8Array([0, 255, 1]));
  await fs.symlink('/tmp/deep', '/home/web/deep');
  await fs.symlink('/missing', '/tmp/broken');
  const saved = await snapshot(fs);
  const reader = snapshotReader(saved);
  for (const path of [...fs.getAllPaths(), '/home/web/deep/binary', '/home/web/deep/../broken']) {
    const live = await readRaw(path, fs);
    const stored = await readRaw(path, reader);
    expect(stored.status).toBe(live.status);
    expect(await stored.arrayBuffer()).toEqual(await live.arrayBuffer());
  }
});
test('large output succeeds rather than merely echoing the command', async () => {
  const shell = createShell(await createFilesystem(base));
  const result = await shell.exec('seq 20000');
  expect(result.exitCode).toBe(0);
  expect(result.stdout.split('\n').filter(Boolean)).toHaveLength(20000);
  expect(result.stdout).toEndWith('19999\n20000\n');
});
test('deleting a directory also hides new published descendants', async () => {
  const original = { ...base, '/home/web/nested/old.md': 'old' };
  const fs = await createFilesystem(original);
  const before = await snapshot(fs);
  await fs.rm('/home/web/nested', { recursive: true });
  const overlay = overlayBetween(before, await snapshot(fs));
  const restored = await createFilesystem(
    { ...original, '/home/web/nested/new.md': 'new' },
    overlay,
  );
  expect(await restored.exists('/home/web/nested')).toBe(false);
});
test('a safely quoted cat command still renders Markdown links', async () => {
  const { catCommand } = await import('../src/paths');
  const fs = await createFilesystem(base);
  const path = "/tmp/quote'$(touch bad).md";
  await fs.writeFile(path, '[About](/home/web/ABOUT.md)');
  const shell = createShell(fs);
  const result = await shell.exec(catCommand(path) + ' | render');
  expect(result.exitCode).toBe(0);
  expect(result.documents[0]?.path).toBe(path);
  expect(await fs.exists('/home/web/bad')).toBe(false);
});
test('published binary files preserve bytes in the virtual filesystem', async () => {
  const fs = await createFilesystem({ ...base, '/tmp/asset.bin': { base64: 'AP+A' } });
  expect(await fs.readFileBuffer('/tmp/asset.bin')).toEqual(new Uint8Array([0, 255, 128]));
});
test('corrupt saved state is rejected and reset recovers it', async () => {
  const { resetState } = await import('../src/storage');
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('panicek-filesystem', 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(
        {
          version: 1,
          revision: 2,
          overlay: { '/bad': { type: 'file', data: '!invalid!', mode: 420 } },
        },
        'current',
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
  await expect(loadState()).rejects.toThrow('invalid');
  await resetState();
  expect((await loadState()).overlay).toEqual({});
});
test('storage denial reports failure instead of silently claiming success', async () => {
  const original = indexedDB.open;
  indexedDB.open = () => {
    throw new Error('Storage denied');
  };
  try {
    await expect(loadState()).rejects.toThrow('Storage denied');
  } finally {
    indexedDB.open = original;
  }
});
