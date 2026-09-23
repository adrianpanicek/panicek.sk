import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlog } from '../scripts/build-blog';
import { staticHandler } from '../scripts/static-handler';

// Fixture posts are added only to a disposable deployment, never to authored content.
const root = await mkdtemp(join(tmpdir(), 'blog-browser-'));
await cp('dist', root, { recursive: true, verbatimSymlinks: true });
// Actions artifacts expand symlinks; point the fixture shortcut at its replaced content.
await rm(join(root, 'blog'), { recursive: true, force: true });
await symlink('./home/web/blog', join(root, 'blog'));
const blog = join(root, 'home/web/blog');
await rm(blog, { recursive: true, force: true });
for (let n = 1; n <= 11; n++) {
  const id = `post-${n}`;
  await Bun.write(
    join(blog, id, 'INDEX.md'),
    `---\ntitle: Test post ${n}\ndate: 2026-09-${String(n).padStart(2, '0')}\ntags: [Example]\nthumbnail: cover.svg\n---\n\n# Test post ${n}\n\nOpening paragraph ${n}.\n\nFull post body ${n}.\n`,
  );
  await Bun.write(
    join(blog, id, 'cover.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>',
  );
}
await buildBlog(blog);
await rm(join(root, '_files/home/web/blog'), { recursive: true, force: true });
await cp(blog, join(root, '_files/home/web/blog'), { recursive: true });
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: staticHandler(root) });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
try {
  for (const route of ['/blog', '/home/web/blog']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    const idle = () =>
      page.waitForFunction(
        () =>
          document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false' &&
          !document.querySelector<HTMLTextAreaElement>('#command')?.disabled,
      );
    await page.goto(new URL(route, server.url).href);
    const index = page.locator('article[data-source="/home/web/blog/INDEX.md"]');
    await index.waitFor();
    await page.waitForFunction(
      () => document.querySelector('#command-form')?.getAttribute('aria-busy') === 'false',
    );
    assert.equal(await page.locator('article').count(), 2);
    assert.equal(await page.locator('article[data-source="/home/web/ABOUT.md"]').count(), 1);
    assert.equal(await page.locator('article[data-source="/home/web/CONTACTS.md"]').count(), 0);
    assert.equal(await index.locator('h2').count(), 10);
    assert.equal(await index.locator('h2').first().textContent(), 'Test post 11');
    await index.getByRole('link', { name: 'Opening paragraph 11.', exact: true }).click();
    const post = page.locator('article[data-source$="post-11/INDEX.md"]').last();
    await post.waitFor();
    await idle();
    assert.match((await post.textContent()) || '', /Full post body 11/);
    assert.doesNotMatch((await post.textContent()) || '', /thumbnail:/);
    await index.getByRole('link', { name: 'Older posts' }).click();
    const older = page.locator('article[data-source="/home/web/blog/pages/2/INDEX.md"]');
    await older.waitFor();
    await idle();
    assert.equal(await older.locator('h2').count(), 1);
    assert.match((await older.textContent()) || '', /Test post 1/);
    await older.getByRole('link', { name: 'Tags', exact: true }).click();
    const tags = page.locator('article[data-source="/home/web/blog/tags/INDEX.md"]');
    await tags.waitFor();
    await idle();
    const tagLink = tags.getByRole('link', { name: 'Example', exact: true });
    const tagSource = await tagLink.getAttribute('data-file');
    await tagLink.click();
    const tag = page.locator(`article[data-source="${tagSource}"]`);
    await tag.locator('h1').waitFor({ state: 'attached' });
    assert.equal(await tag.locator('h1').textContent(), 'Tag: Example');
    await idle();
    assert.equal(await tag.locator('h2').count(), 10);
    await tag.locator('a:has(img)').first().click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('article'))
        .at(-1)
        ?.getAttribute('data-source')
        ?.endsWith('post-11/INDEX.md'),
    );
    await idle();
    assert.match((await page.locator('article').last().textContent()) || '', /Full post body 11/);
    const raw = await context.request.get(new URL('/blog/post-11/INDEX.md', server.url).href);
    assert.equal(raw.status(), 200);
    assert.match(await raw.text(), /tags: \[Example\]/);
    await context.close();
  }
  console.log(
    'PASS both blog routes, pagination, tags, clickable paragraphs/thumbnails and raw posts',
  );
} finally {
  await browser.close();
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
