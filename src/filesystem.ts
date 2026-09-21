import { SYSTEM_FILES } from './downloads';
import { InMemoryFs, type IFileSystem } from 'just-bash/browser';
import { HOME } from './paths';
import { encode, decode } from './bytes';
import { applyOverlay } from './overlay';
export { readRaw } from './raw-files';

export type Entry =
  | { type: 'file'; data: string; mode: number }
  | { type: 'directory'; mode: number }
  | { type: 'symlink'; target: string; mode: number };
export type Snapshot = Record<string, Entry>;
export type Overlay = Record<string, Entry | null>;
export type BaseFiles = Record<string, string | { base64: string }>;
const ordinary = (path: string) => !/^\/(dev|proc|sys)(\/|$)/.test(path);

export async function createFilesystem(base: BaseFiles, overlay: Overlay = {}) {
  const initial = new InMemoryFs(
    Object.fromEntries(
      Object.entries({ ...SYSTEM_FILES, ...base } as BaseFiles).map(([path, content]) => [
        path,
        typeof content === 'string' ? content : decode(content.base64),
      ]),
    ),
    { maxTotalBytes: 8 * 1024 * 1024 },
  );
  await initial.chmod('/usr/sbin/save', 0o755);
  await initial.mkdir(HOME, { recursive: true });
  await initial.mkdir('/tmp', { recursive: true });
  const entries = applyOverlay(await snapshot(initial), overlay);
  const fs = new InMemoryFs({}, { maxTotalBytes: 8 * 1024 * 1024 });
  for (const [path, entry] of Object.entries(entries).sort(
    ([a], [b]) => a.split('/').length - b.split('/').length,
  )) {
    if (path === '/') continue;
    if (entry.type === 'directory') await fs.mkdir(path, { recursive: true });
    else if (entry.type === 'file') await fs.writeFile(path, decode(entry.data));
    else await fs.symlink(entry.target, path);
    await fs.chmod(path, entry.mode).catch(() => {});
  }
  return fs;
}

export async function snapshot(fs: IFileSystem): Promise<Snapshot> {
  const result: Snapshot = Object.create(null);
  const paths = fs.getAllPaths().filter(ordinary);
  if (paths.length > 4000)
    throw new Error('Filesystem contains too many entries to save (limit: 4000).');
  for (const path of paths) {
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink)
      result[path] = { type: 'symlink', target: await fs.readlink(path), mode: stat.mode };
    else if (stat.isDirectory) result[path] = { type: 'directory', mode: stat.mode };
    else
      result[path] = { type: 'file', data: encode(await fs.readFileBuffer(path)), mode: stat.mode };
  }
  return result;
}

export function overlayBetween(base: Snapshot, current: Snapshot): Overlay {
  const overlay: Overlay = Object.create(null);
  for (const path of new Set([...Object.keys(base), ...Object.keys(current)])) {
    if (JSON.stringify(base[path]) !== JSON.stringify(current[path]))
      overlay[path] = current[path] ?? null;
  }
  return overlay;
}
