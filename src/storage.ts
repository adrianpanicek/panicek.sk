import type { Overlay } from './filesystem';
import { normalize } from './paths';
export type State = { version: 1; revision: number; overlay: Overlay };
const empty = (): State => ({ version: 1, revision: 0, overlay: {} });

function valid(value: unknown): value is State {
  if (!value || typeof value !== 'object') return false;
  const s = value as State;
  if (
    s.version !== 1 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    !s.overlay ||
    typeof s.overlay !== 'object'
  )
    return false;
  const entries = Object.entries(s.overlay);
  if (entries.length > 8000) return false;
  return entries.every(
    ([p, e]) =>
      p.startsWith('/') &&
      normalize(p) === p &&
      !p.includes('\0') &&
      (e === null ||
        (typeof e === 'object' &&
          Number.isInteger(e.mode) &&
          (e.type === 'directory' ||
            (e.type === 'file' &&
              typeof e.data === 'string' &&
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e.data)) ||
            (e.type === 'symlink' && typeof e.target === 'string' && !e.target.includes('\0'))))),
  );
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('panicek-filesystem', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage unavailable'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another tab'));
  });
}

export async function loadState(): Promise<State> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const req = tx.objectStore('state').get('current');
      req.onsuccess = () =>
        req.result === undefined
          ? resolve(empty())
          : valid(req.result)
            ? resolve(req.result)
            : reject(
                new Error('Saved filesystem is invalid. Use reset to restore published files.'),
              );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function commitState(expectedRevision: number, overlay: Overlay): Promise<State> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const req = store.get('current');
      let next: State;
      let failure: Error | undefined;
      req.onsuccess = () => {
        const current = req.result ?? empty();
        if (!valid(current)) {
          failure = new Error('Saved filesystem is invalid. Use reset to recover.');
          tx.abort();
          return;
        }
        if (current.revision !== expectedRevision) {
          failure = new Error(
            'Files changed in another tab. Reload to use its saved files; this tab’s edits remain in memory.',
          );
          tx.abort();
          return;
        }
        next = { version: 1, revision: current.revision + 1, overlay };
        if (!valid(next)) {
          failure = new Error('Cannot save invalid filesystem data');
          tx.abort();
          return;
        }
        store.put(next, 'current');
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error('Unable to save files'));
    });
  } finally {
    db.close();
  }
}

export async function resetState(): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const req = store.get('current');
      req.onsuccess = () =>
        store.put(
          {
            version: 1,
            revision: valid(req.result) ? req.result.revision + 1 : Date.now(),
            overlay: {},
          },
          'current',
        );
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
