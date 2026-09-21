import type { IFileSystem } from 'just-bash/browser';

export type Download = { name: string; bytes: Uint8Array };
export const SYSTEM_FILES = {
  '/usr/sbin/save':
    '#!/bin/sh\n# Download virtual files through the browser.\n__portfolio_download "$@"\n',
};

export async function collectDownloads(
  fs: IFileSystem,
  cwd: string,
  args: string[],
  downloads: Download[],
) {
  if (args[0] === '--') args = args.slice(1);
  if (!args.length) return { stdout: '', stderr: 'Usage: save <file> [file ...]\n', exitCode: 1 };
  let stderr = '';
  let total = downloads.reduce((sum, file) => sum + file.bytes.length, 0);
  for (const argument of args) {
    try {
      const path = fs.resolvePath(cwd, argument);
      if ((await fs.stat(path)).isDirectory) throw new Error('Is a directory');
      const bytes = await fs.readFileBuffer(path);
      if (downloads.length >= 100 || total + bytes.length > 8 * 1024 * 1024)
        throw new Error('Download limit: 100 files / 8 MiB per command');
      downloads.push({ name: path.split('/').pop()!, bytes: Uint8Array.from(bytes) });
      total += bytes.length;
    } catch (error) {
      stderr += `save: ${argument}: ${String(error)}\n`;
    }
  }
  return { stdout: '', stderr, exitCode: stderr ? 1 : 0 };
}
