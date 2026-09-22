import { publishedMode } from './program-format';
import type { IFileSystem } from 'just-bash/browser';
import type { BaseFiles, Overlay, Snapshot } from './filesystem';
import { encode, decode } from './bytes';
import { HOME, hrefFor } from './paths';

export interface RemoteOptions {
  fetcher?: (url: string) => Promise<Response>;
  baseline?: Snapshot;
}
type RemoteLocal = Pick<IFileSystem, 'readlink' | 'readdir' | 'exists' | 'mkdir' | 'writeFile'> & {
  chmod(path: string, mode: number): Promise<void>;
  lstat(path: string): Promise<{ isDirectory: boolean; isSymbolicLink: boolean }>;
  stat(path: string): Promise<{ isDirectory: boolean; isSymbolicLink: boolean }>;
};
const locals = new WeakMap<object, object>();
export const localFilesystem = <T extends object>(fs: T): T => (locals.get(fs) as T) || fs;

// nginx names are individual components, never URLs or traversal instructions.
export function validRemoteName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/\x00-\x1f\x7f%]/.test(name)
  );
}
export function lazyFilesystem<T extends RemoteLocal>(
  local: T,
  base: BaseFiles,
  overlay: Overlay,
  options: RemoteOptions,
): T {
  const pending = new Set(
    Object.entries(base)
      .filter(([, value]) => typeof value !== 'string' && 'directory' in value)
      .map(([path]) => path),
  );
  const loading = new Map<string, Promise<void>>();
  const fetcher =
    options.fetcher || ((url: string) => fetch(url, { cache: 'no-cache', redirect: 'error' }));
  const masked = (path: string) => {
    for (let part = path; part; part = part.slice(0, part.lastIndexOf('/'))) {
      if (Object.hasOwn(overlay, part) && overlay[part]?.type !== 'directory') return true;
    }
    return false;
  };
  async function load(path: string): Promise<void> {
    if (!pending.has(path) || !path.startsWith(HOME + '/')) return;
    if (!(await local.lstat(path).catch(() => null))?.isDirectory) return;
    if (loading.has(path)) return loading.get(path)!;
    const task = (async () => {
      const url = '/_files' + hrefFor(path) + '/';
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Cannot list ${path}: HTTP ${response.status}`);
      const listing: unknown = await response.json();
      if (!Array.isArray(listing) || listing.length > 4000)
        throw new Error('Invalid directory listing');
      const entries: Snapshot = {};
      for (const entry of listing) {
        if (!entry || !validRemoteName(entry.name) || !['file', 'directory'].includes(entry.type))
          throw new Error('Invalid directory entry');
        const child = path + '/' + entry.name;
        if (entry.type === 'directory') entries[child] = { type: 'directory', mode: 0o755 };
        else {
          const file = await fetcher('/_files' + hrefFor(child));
          if (!file.ok) throw new Error(`Cannot read ${child}: HTTP ${file.status}`);
          const bytes = new Uint8Array(await file.arrayBuffer());
          entries[child] = { type: 'file', data: encode(bytes), mode: publishedMode(child, bytes) };
        }
      }
      // Finish fetching before changing the filesystem, so a failed request is retryable.
      for (const [child, entry] of Object.entries(entries)) {
        if (options.baseline) options.baseline[child] = entry;
        if (masked(child)) continue;
        if (!(await local.exists(child))) {
          if (entry.type === 'directory') await local.mkdir(child, { recursive: true });
          else if (entry.type === 'file') {
            await local.writeFile(child, decode(entry.data));
            await local.chmod(child, entry.mode);
          }
        }
        if (entry.type === 'directory') pending.add(child);
      }
      pending.delete(path);
    })();
    loading.set(path, task);
    try {
      await task;
    } finally {
      loading.delete(path);
    }
  }
  async function prepare(path: string, follow = true): Promise<string> {
    const parts = path.split('/');
    const resolved: string[] = [];
    let links = 0;
    while (parts.length) {
      const part = parts.shift()!;
      if (!part || part === '.') continue;
      if (part === '..') {
        resolved.pop();
        continue;
      }
      const parent = '/' + resolved.join('/');
      await load(parent);
      const candidate = parent.replace(/\/$/, '') + '/' + part;
      const stat = await local.lstat(candidate).catch(() => null);
      if (stat?.isSymbolicLink && (follow || parts.length)) {
        if (++links > 40) throw new Error('Too many symbolic links');
        const target = await local.readlink(candidate);
        if (target.startsWith('/')) resolved.length = 0;
        parts.unshift(...target.split('/'));
      } else {
        if (stat && !stat.isDirectory && parts.some((p) => p && p !== '.'))
          throw new Error('Not a directory');
        resolved.push(part);
      }
    }
    return '/' + resolved.join('/');
  }
  async function tree(path: string) {
    if (!(await local.stat(path).catch(() => null))?.isDirectory) return;
    await load(path);
    for (const name of await local.readdir(path)) {
      const child = path + '/' + name;
      if ((await local.lstat(child)).isDirectory) await tree(child);
    }
  }
  const fs = new Proxy(local, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (['getAllPaths', 'resolvePath'].includes(String(property))) return value.bind(target);
      return async (...args: any[]) => {
        const method = String(property);
        if (typeof args[0] === 'string') {
          if (method === 'symlink') args[1] = await prepare(args[1], false);
          else {
            const path = await prepare(
              args[0],
              !['lstat', 'readlink', 'rm', 'mv'].includes(method),
            );
            args[0] = path;
            if (['readdir', 'readdirWithFileTypes'].includes(method)) await load(path);
            if (['rm', 'cp', 'mv'].includes(method)) await tree(path);
            if (['cp', 'mv', 'link'].includes(method)) args[1] = await prepare(args[1], false);
          }
        }
        return value.apply(target, args);
      };
    },
  });
  locals.set(fs, local);
  return fs;
}
