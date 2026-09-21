import type { Snapshot, Overlay } from './filesystem';

export function applyOverlay(base: Snapshot, overlay: Overlay): Snapshot {
  const merged: Snapshot = Object.assign(Object.create(null), base);
  for (const [path, entry] of Object.entries(overlay)) {
    // A deleted directory or replacement with a file/link masks all published descendants,
    // including files added in a later deployment.
    if (entry === null || entry.type !== 'directory') {
      for (const candidate of Object.keys(merged))
        if (candidate.startsWith(path + '/')) delete merged[candidate];
    }
    if (entry === null) delete merged[path];
    else merged[path] = entry;
  }
  for (const path of Object.keys(merged)) {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent) {
      if (Object.hasOwn(overlay, parent) && overlay[parent]?.type !== 'directory') {
        delete merged[path];
        break;
      }
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  }
  return merged;
}
