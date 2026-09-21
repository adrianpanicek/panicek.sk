import type { IFileSystem } from 'just-bash/browser';
import { normalize } from './paths';

export async function readEditorFile(fs: IFileSystem, path: string) {
  if (!(await fs.exists(path))) {
    await rejectDanglingLink(fs, path);
    return { path, text: '', isNew: true };
  }
  const stat = await fs.stat(path);
  if (stat.isDirectory) throw new Error('Cannot edit a directory');
  const bytes = await fs.readFileBuffer(path);
  if (bytes.length > 1024 * 1024) throw new Error('Editor limit is 1 MiB per file');
  if (bytes.includes(0)) throw new Error('Cannot edit a binary file');
  return { path, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), isNew: false };
}

export async function writeEditorFile(fs: IFileSystem, path: string, text: string) {
  if (new TextEncoder().encode(text).length > 1024 * 1024)
    throw new Error('Editor limit is 1 MiB per file');
  await fs.writeFile(path, text);
}

export async function saveEditorFile(
  fs: IFileSystem,
  path: string,
  text: string,
  persist: () => Promise<void>,
) {
  await rejectDanglingLink(fs, path);
  const absolute = normalize(path);
  const canonical = (await fs.exists(path))
    ? await fs.realpath(path)
    : normalize(
        (await fs.realpath(absolute.slice(0, absolute.lastIndexOf('/')) || '/')) +
          '/' +
          absolute.slice(absolute.lastIndexOf('/') + 1),
      );
  if (/^\/(dev|proc|sys)(\/|$)/.test(canonical))
    throw new Error('Cannot persist files in /dev, /proc, or /sys');
  const before = (await fs.exists(path)) ? await fs.readFileBuffer(path) : null;
  await writeEditorFile(fs, path, text);
  try {
    await persist();
  } catch (error) {
    if (before === null) await fs.rm(path);
    else await fs.writeFile(path, before);
    throw error;
  }
}

async function rejectDanglingLink(fs: IFileSystem, path: string) {
  const stat = await fs.lstat(path).catch(() => null);
  if (stat?.isSymbolicLink && !(await fs.exists(path)))
    throw new Error('Cannot edit a dangling symbolic link');
}
