import { resolve, extname } from 'node:path';
const root = resolve('dist');
const port = Number(process.env.PORT || 4321);
const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('\0')) return new Response('Bad path', { status: 400 });
      const path = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!path.startsWith(root + '/')) return new Response('Not found', { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists()))
        return new Response('File not found\n', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      const etag = `W/"${file.size.toString(16)}-${file.lastModified.toString(16)}"`;
      if (request.headers.get('If-None-Match') === etag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Cache-Control': 'no-cache' },
        });
      }
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
          'Content-Type': types[extname(path)] || file.type || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
          ETag: etag,
        },
      });
    } catch {
      return new Response('File not found\n', { status: 404 });
    }
  },
});
console.log(`Portfolio preview: ${server.url}`);
