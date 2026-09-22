import type { BaseFiles, Overlay, Snapshot } from './filesystem';
import { applyOverlay } from './overlay';
import { snapshotReader } from './raw-files';
import { lazyFilesystem, type RemoteOptions } from './remote-filesystem';
import { encode } from './bytes';
import { HOME } from './paths';

// A read-only consumer needs no shell engine or writable in-memory filesystem bundle.
export function remoteSnapshot(base: Snapshot, overlay: Overlay, options: RemoteOptions = {}) {
  const entries = applyOverlay(base, overlay);
  const markers: BaseFiles = Object.fromEntries(
    Object.entries(base)
      .filter(([path, entry]) => path.startsWith(HOME + '/') && entry.type === 'directory')
      .map(([path]) => [path, { directory: true }]),
  );
  const local = {
    ...snapshotReader(entries),
    async chmod(path: string, mode: number) {
      entries[path].mode = mode;
    },
    async exists(path: string) {
      return Object.hasOwn(entries, path);
    },
    async mkdir(path: string) {
      entries[path] = { type: 'directory', mode: 0o755 };
    },
    async writeFile(path: string, content: string | Uint8Array) {
      entries[path] = {
        type: 'file',
        mode: 0o644,
        data: encode(typeof content === 'string' ? new TextEncoder().encode(content) : content),
      };
    },
  };
  return lazyFilesystem(local, markers, overlay, options);
}
