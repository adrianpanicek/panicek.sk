import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { staticHandler, safeRequestPath } from '../scripts/static-handler';
test('rejects raw, encoded and double-encoded traversal', () => {
  for (const path of [
    '/../etc/passwd',
    '/_files/home/web/../../secret',
    '/%2e%2e/secret',
    '/a%2fb',
    '/a%5cb',
    '/%252e%252e/secret',
    '/a\\b',
    '/a%00b',
  ]) {
    expect(() => safeRequestPath('https://example.test' + path)).toThrow();
  }
});
test('preview matches autoindex and refuses symlink escapes', async () => {
  const root = await mkdtemp('/tmp/portfolio-static-');
  try {
    await mkdir(root + '/_files/home/web/blog', { recursive: true });
    await Bun.write(root + '/index.html', 'app');
    await Bun.write(root + '/_files/home/web/blog/INDEX.md', '# Blog');
    await symlink('/etc/passwd', root + '/leak');
    await symlink('/etc', root + '/outside');
    await symlink('/etc/passwd', root + '/_files/home/web/blog/leak');
    const serve = staticHandler(root);
    const request = (path: string) => serve(new Request('http://localhost' + path));
    expect((await request('/leak')).status).toBe(404);
    expect((await request('/outside/passwd')).status).toBe(404);
    expect((await request('/_files/home/web/blog/leak')).status).toBe(404);
    const listing = await (await request('/_files/home/web/blog/')).json();
    expect(listing.map((entry: any) => entry.name)).toEqual(['INDEX.md']);
    expect(await (await request('/_files/home/web/blog/INDEX.md')).text()).toBe('# Blog');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('directory routes serve their prerendered index rather than the homepage', async () => {
  const root = await mkdtemp('/tmp/portfolio-directory-');
  try {
    await Bun.write(root + '/index.html', 'Homepage');
    await Bun.write(root + '/blog/index.html', 'Blog only');
    const response = await staticHandler(root)(new Request('http://localhost/blog/'));
    expect(await response.text()).toBe('Blog only');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
