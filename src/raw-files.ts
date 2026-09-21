import { rawPath, normalize, hrefFor } from './paths';
import { decode } from './bytes';
import type { Snapshot } from './filesystem';
type Stat = { isDirectory: boolean; isSymbolicLink: boolean };
export interface RawFilesystem {
  lstat(path: string): Promise<Stat>;
  stat(path: string): Promise<Stat>;
  readlink(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  readFileBuffer(path: string): Promise<Uint8Array>;
}

export function snapshotReader(entries: Snapshot): RawFilesystem {
  const entry = (path: string) => {
    const value = entries[path];
    if (!value) throw new Error('File not found');
    return value;
  };
  const stat = async (path: string): Promise<Stat> => {
    const value = entry(path);
    return { isDirectory: value.type === 'directory', isSymbolicLink: value.type === 'symlink' };
  };
  return {
    lstat: stat,
    stat,
    async readlink(path) {
      const value = entry(path);
      if (value.type !== 'symlink') throw new Error('Not a link');
      return value.target;
    },
    async readFileBuffer(path) {
      const value = entry(path);
      if (value.type !== 'file') throw new Error('Not a file');
      return decode(value.data);
    },
    async readdir(path) {
      if (entry(path).type !== 'directory') throw new Error('Not a directory');
      const prefix = path === '/' ? '/' : path + '/';
      return Object.keys(entries)
        .filter(
          (p) => p.startsWith(prefix) && p !== prefix && !p.slice(prefix.length).includes('/'),
        )
        .map((p) => p.slice(prefix.length));
    },
  };
}

// Walk components before normalization, so a symlink followed by .. behaves as a filesystem path.
export async function physicalPath(path: string, fs: RawFilesystem): Promise<string> {
  const pending = path.split('/');
  const resolved: string[] = [];
  let links = 0;
  while (pending.length) {
    const part = pending.shift()!;
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    const candidate = '/' + [...resolved, part].join('/');
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink) {
      if (++links > 40) throw new Error('Too many symbolic links');
      const target = await fs.readlink(candidate);
      if (target.startsWith('/')) resolved.length = 0;
      pending.unshift(...target.split('/'));
    } else {
      if (pending.some((p) => p && p !== '.') && !stat.isDirectory)
        throw new Error('Not a directory');
      resolved.push(part);
    }
  }
  return '/' + resolved.join('/');
}

export async function readRaw(pathname: string, fs: RawFilesystem): Promise<Response> {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
  try {
    const path = await physicalPath(rawPath(pathname), fs);
    const stat = await fs.stat(path);
    if (stat.isDirectory) {
      const lines = [
        `${path}\n`,
        ...(await fs.readdir(path)).sort().map((name) => hrefFor(normalize(path + '/' + name))),
      ];
      return new Response(lines.join('\n') + '\n', { headers });
    }
    const bytes = await fs.readFileBuffer(path);
    let text = false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      text = !bytes.includes(0);
    } catch {}
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        ...headers,
        'Content-Type': text ? headers['Content-Type'] : 'application/octet-stream',
      },
    });
  } catch {
    return new Response('File not found\n', { status: 404, headers });
  }
}
