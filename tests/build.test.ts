import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
test('build contains prerendered content, raw bytes, shortcuts and discovery metadata', async () => {
  const html = await Bun.file('dist/index.html').text();
  expect(html).toContain('Adrián Paníček');
  expect(html).toContain('Expert Embedded Software Engineer');
  expect(html).toContain('data-file="/home/web/CAREER.md"');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('rel="canonical"');
  for (const name of await readdir('content')) {
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
  expect(css.length).toBeLessThan((await Bun.file('src/styles.scss').text()).length);
  expect(css).toContain('font-size:16px');
  expect(css).toContain('line-height:1');
  const files = await Bun.file('dist/filesystem.json').json();
  expect(files['/home/web/CONTACTS.md']).toBe(await Bun.file('content/CONTACTS.md').text());
});
