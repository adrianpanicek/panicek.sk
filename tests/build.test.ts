import { compile } from 'sass';
import { expect, test } from 'bun:test';
import { readdir, stat } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { imageSize } from 'image-size';
test('build contains prerendered content, raw bytes, shortcuts and discovery metadata', async () => {
  const html = await Bun.file('dist/index.html').text();
  expect(html).toContain('Adrián Paníček');
  expect(html).toContain('Expert Embedded Software Engineer');
  expect(html).toContain('data-file="/home/web/CAREER.md"');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('rel="canonical"');
  for (const name of await readdir('content')) {
    if ((await stat(`content/${name}`)).isDirectory()) continue;
    const original = await Bun.file(`content/${name}`).text();
    expect(await Bun.file(`dist/home/web/${name}`).text()).toBe(original);
    expect(await Bun.file(`dist/~/${name}`).text()).toBe(original);
  }
  expect(await Bun.file('dist/~/EXPERIENCE.md').exists()).toBe(false);
  expect(await Bun.file('dist/robots.txt').text()).toContain(
    'Sitemap: https://panicek.sk/sitemap.xml',
  );
  expect(await Bun.file('dist/sitemap.xml').text()).toContain(
    'https://panicek.sk/home/web/CAREER.md',
  );
  expect(await Bun.file('dist/llms-full.txt').text()).toContain('Ciklum');
});

test('published assets keep contacts encoded and omit the contacts prerender', async () => {
  const html = await Bun.file('dist/index.html').text();
  expect(html).not.toContain('data-source="/home/web/CONTACTS.md"');
  expect(html).not.toContain('mailto:');
  for (const path of new Bun.Glob('**/*').scanSync({ cwd: 'dist', onlyFiles: true })) {
    const text = await Bun.file(`dist/${path}`).text();
    for (const clear of ['adrian@panicek.sk', '+421 902 796 000', '421902796000'])
      expect(text).not.toContain(clear);
  }
  expect(await Bun.file('dist/home/web/CONTACTS.md').text()).toContain(
    '{{rot13:nqevna@cnavprx.fx}}',
  );
  expect(await Bun.file('dist/llms.txt').text()).toContain('ROT13');
});

test('build compresses HTML and SCSS and preloads the encoded filesystem', async () => {
  const html = await Bun.file('dist/index.html').text();
  expect(html).toContain(
    'rel="preload" href="/filesystem.json" as="fetch" crossorigin="anonymous" fetchpriority="high"',
  );
  expect(html).not.toContain('\n<html');
  const css = await Bun.file('dist/assets/styles.css').text();
  expect(css.length).toBeLessThan(compile('src/styles.scss', { style: 'expanded' }).css.length);
  expect(css).toContain('font-size:16px');
  expect(css).toContain('line-height:1');
  const files = await Bun.file('dist/filesystem.json').json();
  expect(files['/home/web/CONTACTS.md']).toBe(await Bun.file('content/CONTACTS.md').text());
});

test('worker transfer variants preserve every byte and stay within download budgets', async () => {
  const original = new Uint8Array(await Bun.file('dist/assets/shell.worker.js').arrayBuffer());
  const gzip = new Uint8Array(await Bun.file('dist/assets/shell.worker.js.gz').arrayBuffer());
  const brotli = new Uint8Array(await Bun.file('dist/assets/shell.worker.js.br').arrayBuffer());
  expect(Bun.gunzipSync(gzip)).toEqual(original);
  expect(new Uint8Array(brotliDecompressSync(brotli))).toEqual(original);
  expect(gzip.byteLength).toBeLessThan(450000);
  expect(brotli.byteLength).toBeLessThan(350000);
});

test('social previews are available in static HTML with a valid large image', async () => {
  const html = await Bun.file('dist/index.html').text();
  const origin = process.env.SITE_ORIGIN || 'https://panicek.sk';
  expect(html).toContain(`property="og:image" content="${origin}/assets/social-card.png"`);
  expect(html).toContain('property="og:image:width" content="1200"');
  expect(html).toContain('property="og:image:height" content="630"');
  expect(html).toContain('property="og:image:alt"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain(`name="twitter:image" content="${origin}/assets/social-card.png"`);
  const bytes = new Uint8Array(await Bun.file('dist/assets/social-card.png').arrayBuffer());
  expect(imageSize(bytes)).toMatchObject({ width: 1200, height: 630, type: 'png' });
  expect(bytes.length).toBeLessThan(300000);
});

test('Doom ships as a separate compressed application outside the portfolio filesystem', async () => {
  for (const name of [
    'doom.wasm',
    'LICENSE-GPL-2.0.txt',
    'DOOM-SHAREWARE-NOTICE.txt',
    'SOURCE.md',
  ]) {
    expect(await Bun.file(`dist/assets/doom/${name}`).bytes()).toEqual(
      await Bun.file(`vendor/doom/${name}`).bytes(),
    );
  }
  const game = await Bun.file('dist/assets/doom/app.js').text();
  expect(game).toContain('launchDoom');
  const client = await Bun.file('dist/assets/client.js').text();
  expect(client).not.toContain('drawFrame');
  expect(client).not.toContain('u_curve');
  expect(client).not.toContain('initGame');
  for (const path of [
    'files.json',
    'filesystem.json',
    'snapshot.json',
    'service-worker.js',
    'index.html',
  ]) {
    expect(await Bun.file(`dist/${path}`).text()).not.toContain('/assets/doom/');
  }
  const compressed = await Bun.file('dist/assets/doom/doom.wasm.br').bytes();
  expect(compressed.length).toBeLessThan(1700000);
  expect(new Uint8Array(brotliDecompressSync(compressed))).toEqual(
    await Bun.file('vendor/doom/doom.wasm').bytes(),
  );
});

test('startup contains shallow directory markers and symlinks without nested page bodies', async () => {
  const text = await Bun.file('dist/filesystem.json').text();
  const startup = JSON.parse(text);
  expect(startup['/blog']).toEqual({ target: '/home/web/blog' });
  expect(startup['/home/web/blog']).toEqual({ directory: true });
  expect(startup['/home/web/blog/INDEX.md']).toBeUndefined();
  expect(text).not.toContain('No posts yet.');
  const snapshot = await Bun.file('dist/snapshot.json').json();
  expect(snapshot['/home/web/blog/INDEX.md']).toBeUndefined();
  expect(atob(snapshot['/llms-full.txt'].data)).not.toContain('No posts yet.');
  expect(await Bun.file('dist/_files/home/web/blog/INDEX.md').text()).toContain('# Blog');
  expect(await Bun.file('dist/blog/index.html').text()).toContain('/assets/client.js');
});

test('raw URL service worker stays small without bundling the shell engine', () => {
  expect(Bun.file('dist/service-worker.js').size).toBeLessThan(50000);
});

test('direct blog HTML contains only its index and the directory shell has no intro', async () => {
  const blog = await Bun.file('dist/blog/index.html').text();
  expect(blog).toContain('data-source="/home/web/blog/INDEX.md"');
  expect(blog).not.toContain('data-source="/home/web/ABOUT.md"');
  expect(blog).not.toContain('data-source="/home/web/CONTACTS.md"');
  const shell = await Bun.file('dist/assets/directory.html').text();
  expect(shell).not.toContain('data-source="/home/web/ABOUT.md"');
  expect(shell).toContain('id="command-form"');
});
