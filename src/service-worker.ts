/// <reference lib="webworker" />
import type { Snapshot } from './filesystem';
import { remoteSnapshot } from './remote-snapshot';
import { readRaw, physicalPath } from './raw-files';
import { rawPath } from './paths';
import { loadState } from './storage';
const sw = self as unknown as ServiceWorkerGlobalScope;
let basePromise: Promise<Snapshot> | undefined;
const getBase = () =>
  (basePromise ??= fetch('/snapshot.json', { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error('Published files unavailable');
      return response.json();
    })
    .catch((error) => {
      basePromise = undefined;
      throw error;
    }));
sw.addEventListener('install', (event) => event.waitUntil(sw.skipWaiting()));
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));
sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || !['GET', 'HEAD'].includes(event.request.method)) return;
  if (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/_files/') ||
    url.pathname.startsWith('/api/') ||
    ['/service-worker.js', '/filesystem.json', '/snapshot.json', '/favicon.svg'].includes(
      url.pathname,
    )
  )
    return;
  // Existing services on the same origin belong to nginx, not the virtual filesystem.
  if (/^\/(temp|mqtt|\.well-known)(\/|$)/.test(url.pathname)) return;
  if (!['document', '', 'image'].includes(event.request.destination)) return;
  event.respondWith(
    (async () => {
      try {
        const base = await getBase();
        const state = await loadState();
        const fs = remoteSnapshot(base, state.overlay);
        if (event.request.mode === 'navigate') {
          const path = await physicalPath(rawPath(url.pathname), fs);
          if ((await fs.stat(path)).isDirectory) return fetch('/assets/directory.html');
        }
        const response = await readRaw(url.pathname, fs);
        if (event.request.destination === 'image' && response.ok) {
          const type = (
            {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              gif: 'image/gif',
              webp: 'image/webp',
              avif: 'image/avif',
              svg: 'image/svg+xml',
            } as Record<string, string>
          )[url.pathname.split('.').pop()!.toLowerCase()];
          if (type)
            return new Response(await response.arrayBuffer(), {
              status: response.status,
              headers: {
                'Content-Type': type,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            });
        }
        return event.request.method === 'HEAD'
          ? new Response(null, { status: response.status, headers: response.headers })
          : response;
      } catch {
        // Preserve static access if storage is disabled or damaged; never render app HTML for a raw file.
        return fetch(event.request);
      }
    })(),
  );
});
