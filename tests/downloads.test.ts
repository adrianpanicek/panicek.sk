import { test, expect } from 'bun:test';
import { createFilesystem } from '../src/filesystem';
import { createShell } from '../src/shell';

test('save and /usr/sbin/save download exact bytes with cwd, glob and quoted arguments', async () => {
  const fs = await createFilesystem({ '/home/web/a.txt': 'héllo\n', '/home/web/b.txt': 'second' });
  await fs.writeFile('/tmp/image data.bin', new Uint8Array([0, 255, 128, 1]));
  const shell = createShell(fs);
  expect((await fs.stat('/usr/sbin/save')).mode & 0o111).toBeTruthy();
  expect((await shell.exec('which save')).stdout.trim()).toBe('/usr/sbin/save');
  expect(await fs.exists('/sbin/save')).toBe(false);
  const texts = await shell.exec('save *.txt');
  expect(texts.downloads.map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
  expect(new TextDecoder().decode(texts.downloads[0].bytes)).toBe('héllo\n');
  await shell.exec('cd /tmp');
  const binary = await shell.exec('/usr/sbin/save "image data.bin"');
  expect(binary.exitCode).toBe(0);
  expect(binary.downloads[0]?.bytes).toEqual(new Uint8Array([0, 255, 128, 1]));
  expect((await shell.exec('echo next')).downloads).toEqual([]);
});

test('save reports invalid arguments but retains successful downloads', async () => {
  const shell = createShell(await createFilesystem({ '/tmp/good': 'ok' }));
  expect((await shell.exec('save')).exitCode).toBe(1);
  const result = await shell.exec('save /tmp/missing /tmp /tmp/good');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Is a directory');
  expect(result.downloads.map((file) => file.name)).toEqual(['good']);
});
