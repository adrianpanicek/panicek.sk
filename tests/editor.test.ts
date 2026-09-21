import { expect, test } from 'bun:test';
import { createFilesystem } from '../src/filesystem';
import { createShell } from '../src/shell';
import { readEditorFile, saveEditorFile } from '../src/editor-files';

test('vim resolves shell paths and refuses interactive use in pipelines', async () => {
  const fs = await createFilesystem({});
  const shell = createShell(fs);
  expect((await shell.exec('vim ~/hello.md')).editorPath).toBe('/home/web/hello.md');
  await shell.exec('cd /tmp');
  expect((await shell.exec("vi 'file with spaces.md'")).editorPath).toBe(
    '/tmp/file with spaces.md',
  );
  expect((await shell.exec('vim')).editorPath).toBe('/tmp/untitled.txt');
  expect((await shell.exec('vim a b')).exitCode).toBe(1);
  expect((await shell.exec('vim a | cat')).editorPath).toBeUndefined();
  expect((await shell.exec('vim a > /tmp/out')).editorPath).toBeUndefined();
});

test('editor reads UTF-8 and new files, refusing directories and binary files', async () => {
  const fs = await createFilesystem({
    '/home/web/text': 'héllo\n',
    '/tmp/binary': { base64: 'AP8=' },
  });
  expect((await readEditorFile(fs, '/home/web/text')).text).toBe('héllo\n');
  expect((await readEditorFile(fs, '/tmp/new')).isNew).toBe(true);
  await expect(readEditorFile(fs, '/tmp')).rejects.toThrow('directory');
  await expect(readEditorFile(fs, '/tmp/binary')).rejects.toThrow('binary');
});

test('failed editor persistence preserves both new and existing filesystem contents', async () => {
  const fs = await createFilesystem({ '/tmp/existing': 'before' });
  const fail = async () => {
    throw new Error('Another tab saved first');
  };
  await expect(saveEditorFile(fs, '/tmp/existing', 'after', fail)).rejects.toThrow('Another tab');
  expect(await fs.readFile('/tmp/existing')).toBe('before');
  await expect(saveEditorFile(fs, '/tmp/new', 'after', fail)).rejects.toThrow('Another tab');
  expect(await fs.exists('/tmp/new')).toBe(false);
  await saveEditorFile(fs, '/tmp/existing', 'saved', async () => {});
  expect(await fs.readFile('/tmp/existing')).toBe('saved');
});

test('editing a dangling symlink cannot remove it on failure', async () => {
  const fs = await createFilesystem({});
  await fs.symlink('/tmp/missing', '/tmp/link');
  await expect(readEditorFile(fs, '/tmp/link')).rejects.toThrow('dangling');
  await expect(
    saveEditorFile(fs, '/tmp/link', 'new', async () => {
      throw new Error('storage');
    }),
  ).rejects.toThrow('dangling');
  expect(await fs.readlink('/tmp/link')).toBe('/tmp/missing');
});

test('editor refuses pseudo-files and symlinks to nonpersistent paths', async () => {
  const fs = await createFilesystem({});
  await fs.mkdir('/proc');
  await fs.writeFile('/proc/example', 'original');
  await fs.symlink('/proc/example', '/tmp/proc-link');
  await expect(saveEditorFile(fs, '/tmp/proc-link', 'new', async () => {})).rejects.toThrow(
    'Cannot persist',
  );
  await expect(saveEditorFile(fs, '/proc/new', 'new', async () => {})).rejects.toThrow(
    'Cannot persist',
  );
});
