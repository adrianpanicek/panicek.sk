import { resolve, extname, sep } from 'node:path';
import { realpath, stat, readdir } from 'node:fs/promises';

export function safeRequestPath(url: string): string {
  // Inspect the raw spelling as well: URL parsers normalize literal dot segments.
  const raw = url.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0];
  if (/%(?:2e|2f|5c|25|00)/i.test(raw) || /[\\\x00-\x1f]/.test(raw)) throw new Error('Bad path');
  const path = decodeURIComponent(raw);
  if (path.split('/').some((part) => part === '.' || part === '..')) throw new Error('Bad path');
  return path;
}
export function staticHandler(directory: string) {
  const root = resolve(directory);
  return async (request: Request): Promise<Response> => {
    try {
      const decoded = safeRequestPath(request.url);
      const path = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!path.startsWith(root + sep)) return new Response(null, { status: 404 });
      const physical = await realpath(path);
      const physicalRoot = await realpath(root);
      if (!physical.startsWith(physicalRoot + sep)) return new Response(null, { status: 404 });
      const remote = decoded.startsWith('/_files/');
      if (
        remote &&
        (physical !== physicalRoot + decoded.replace(/\/$/, '') ||
          !decoded.startsWith('/_files/home/web/'))
      )
        return new Response(null, { status: 404 });
      const info = await stat(physical);
      if (info.isDirectory()) {
        if (!decoded.endsWith('/'))
          return new Response(null, {
            status: 301,
            headers: { Location: new URL(request.url).pathname + '/' },
          });
        if (remote) {
          const entries = await readdir(physical, { withFileTypes: true });
          return Response.json(
            await Promise.all(
              entries
                .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
                .map(async (entry) => ({
                  name: entry.name,
                  type: entry.isDirectory() ? 'directory' : 'file',
                  mtime: (await stat(resolve(physical, entry.name))).mtime.toISOString(),
                  ...(entry.isFile()
                    ? { size: (await stat(resolve(physical, entry.name))).size }
                    : {}),
                })),
            ),
            { headers: { 'Cache-Control': 'no-cache' } },
          );
        }
        return new Response(Bun.file(resolve(root, 'index.html')), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }
      const file = Bun.file(physical);
      const etag = `W/"${file.size.toString(16)}-${file.lastModified.toString(16)}"`;
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Cache-Control': 'no-cache' },
        });
      const types: Record<string, string> = {
        '.md': 'text/plain; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.wasm': 'application/wasm',
      };
      return new Response(request.method === 'HEAD' ? null : file, {
        headers: {
          'Content-Type': types[extname(physical)] || file.type || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
          ETag: etag,
        },
      });
    } catch {
      return new Response('File not found\n', { status: 404 });
    }
  };
}
