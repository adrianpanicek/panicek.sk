import { expect, test } from 'bun:test';
import { brotliCompressSync, constants } from 'node:zlib';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const nginx = process.env.NGINX_PATH || Bun.which('nginx');

for (const site of ['portfolio', 'experiment']) {
  test.skipIf(!nginx)(
    `${site} nginx serves typed Wasm with negotiated Brotli and an intact fallback`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'doom-nginx-'));
      const socket = join(root, 'http.sock');
      let server: ReturnType<typeof Bun.spawn> | undefined;
      try {
        await mkdir(join(root, 'assets/doom'), { recursive: true });
        await mkdir(join(root, 'logs'));
        const bytes = await Bun.file('vendor/doom/doom.wasm').bytes();
        const compressed = brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        });
        await Bun.write(join(root, 'assets/doom/doom.wasm'), bytes);
        await Bun.write(join(root, 'assets/doom/doom.wasm.br'), compressed);
        await Bun.write(join(root, 'assets/doom/fallback.wasm'), bytes);
        const config =
          site === 'portfolio'
            ? `${await Bun.file('deploy/nginx/portfolio-http.conf').text()}
          server { listen unix:${socket}; root ${root};
          ${await Bun.file('deploy/nginx/portfolio-locations.conf').text()} }`
            : (await Bun.file('deploy/nginx/experiment.panicek.sk.conf').text())
                .replace(/    listen .*;\n/g, '')
                .replace(/    (?:http[23]|ssl_\w+) .*;\n/g, '')
                .replace('server {', `server {\n    listen unix:${socket};`)
                .replace('root /srv/http/panicek-experiment/current;', `root ${root};`);
        const path = join(root, 'nginx.conf');
        await Bun.write(
          path,
          `daemon off; master_process off; pid ${root}/nginx.pid;
        error_log ${root}/error.log; events {} http { access_log off;
        client_body_temp_path ${root}/body; proxy_temp_path ${root}/proxy;
        fastcgi_temp_path ${root}/fastcgi; uwsgi_temp_path ${root}/uwsgi; scgi_temp_path ${root}/scgi;
        ${config} }`,
        );
        const check = Bun.spawn([nginx!, '-p', root, '-c', path, '-t'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const diagnostics = await new Response(check.stderr).text();
        expect(await check.exited, diagnostics).toBe(0);
        server = Bun.spawn([nginx!, '-p', root, '-c', path], { stdout: 'pipe', stderr: 'pipe' });
        const deadline = Date.now() + 3000;
        while (true) {
          try {
            await fetch('http://localhost/', { unix: socket });
            break;
          } catch (error) {
            if (Date.now() > deadline || server.exitCode !== null) throw error;
            await Bun.sleep(20);
          }
        }
        for (const [file, encoding, expectedEncoding] of [
          ['doom.wasm', 'br', 'br'],
          ['doom.wasm', 'identity', null],
          ['doom.wasm', 'br;q=0', null],
          ['fallback.wasm', 'br', null],
        ] as const) {
          const response = await fetch(`http://localhost/assets/doom/${file}`, {
            unix: socket,
            headers: { 'Accept-Encoding': encoding },
          });
          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toBe('application/wasm');
          expect(response.headers.get('content-encoding')).toBe(expectedEncoding);
          expect(response.headers.get('vary')?.toLowerCase()).toContain('accept-encoding');
          expect(Number(response.headers.get('content-length'))).toBe(
            expectedEncoding ? compressed.byteLength : bytes.byteLength,
          );
          expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        }
      } finally {
        server?.kill();
        if (server) await server.exited;
        await rm(root, { recursive: true, force: true });
      }
    },
    15000,
  );
}
