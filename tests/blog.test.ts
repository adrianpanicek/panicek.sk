import {afterEach, expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildBlog} from '../scripts/build-blog';
import {renderMarkdown} from '../src/markdown';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-test-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, {recursive: true, force: true})),
  );
});
const id = (n: number) => `post-${n}`;
async function post(root: string, n: number, extra = '') {
  await Bun.write(
    join(root, id(n), 'INDEX.md'),
    `---\ntitle: Post ${n}\ndate: 2026-09-${String(n).padStart(2, '0')}\ntags: [Rust, C++]\n${extra}---\n\n# Post ${n}\n\nFirst **paragraph** with [a link](attached.txt).\n\nSecond paragraph.\n`,
  );
  await Bun.write(join(root, id(n), 'attached.txt'), 'attachment');
}

test('latest posts paginate at ten and every preview links to its post markdown', async () => {
  const root = await fixture();
  for (let n = 1; n <= 11; n++) {
    await post(root, n, n === 11 ? 'thumbnail: cover.svg\n' : '');
  }
  await Bun.write(
    join(root, id(11), 'cover.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
  );
  await buildBlog(root);
  const index = await Bun.file(join(root, 'INDEX.md')).text();
  expect(index.match(/^## /gm)).toHaveLength(10);
  expect(index).not.toContain('[Blog](INDEX.md)');
  expect(index.indexOf('Post 11')).toBeLessThan(index.indexOf('Post 10'));
  expect(index).not.toContain('Second paragraph');
  const html = renderMarkdown(index, '/home/web/blog/INDEX.md');
  expect(html).toContain(`href="https://panicek.sk/blog/${id(11)}/"`);
  expect(html).toContain(`src="/home/web/blog/${id(11)}/cover.svg"`);
  expect(html).toContain('>First paragraph with a link.</a>');
  expect(html).toContain('/home/web/blog/pages/2/INDEX.md');
  const second = await Bun.file(join(root, 'pages/2/INDEX.md')).text();
  expect(second.match(/^## /gm)).toHaveLength(1);
  expect(second).toContain('Post 1]');
  expect(renderMarkdown(second, '/home/web/blog/pages/2/INDEX.md')).toContain(
    '/home/web/blog/INDEX.md',
  );
  expect(await Bun.file(join(root, id(1), 'attached.txt')).text()).toBe(
    'attachment',
  );
});

test('tag indexes paginate and obsolete indexes disappear after posts are removed', async () => {
  const root = await fixture();
  for (let n = 1; n <= 11; n++) {
    await post(root, n);
  }
  await buildBlog(root);
  const tags = await Bun.file(join(root, 'tags/INDEX.md')).text();
  expect(tags).toContain('Rust');
  expect(tags).toContain('C++');
  const paths = [...tags.matchAll(/\]\(([^)]+)\)/g)]
    .map(match => match[1])
    .filter(path => path.startsWith('./'));
  expect(paths).toHaveLength(2);
  for (const path of paths) {
    const index = await Bun.file(join(root, 'tags', path)).text();
    expect(index.match(/^## /gm)).toHaveLength(10);
  }
  for (let n = 1; n <= 11; n++) {
    await rm(join(root, id(n)), {recursive: true});
  }
  await buildBlog(root);
  expect(await Bun.file(join(root, 'INDEX.md')).text()).toContain(
    'No posts yet.',
  );
  expect(await Bun.file(join(root, 'pages/2/INDEX.md')).exists()).toBe(false);
  for (const path of paths) {
    expect(await Bun.file(join(root, 'tags', path)).exists()).toBe(false);
  }
});

test('invalid metadata and missing thumbnails fail with the post path', async () => {
  const root = await fixture();
  await post(root, 1, 'thumbnail: missing.png\n');
  await expect(buildBlog(root)).rejects.toThrow(id(1));
  await post(root, 1);
  const file = join(root, id(1), 'INDEX.md');
  await Bun.write(
    file,
    (await Bun.file(file).text()).replace('2026-09-01', '2026-02-30'),
  );
  await expect(buildBlog(root)).rejects.toThrow('date');
});

test('manually named directories are indexed without changing the authored post', async () => {
  const root = await fixture();
  const path = join(root, 'My first post', 'INDEX.md');
  const raw =
    '---\ntitle: A new post\ndate: 2026-09-23\ntags: []\n---\n\n# A new post\n\nOpening paragraph.\n';
  await Bun.write(path, raw);
  await buildBlog(root);
  expect(await Bun.file(path).text()).toBe(raw);
  const html = renderMarkdown(raw, '/home/web/blog/My first post/INDEX.md');
  expect(html).toContain('<h1>A new post</h1>');
  expect(html).not.toContain('tags:');
  const index = await Bun.file(join(root, 'INDEX.md')).text();
  expect(index).toContain('(My%20first%20post/INDEX.md)');
});

test('thumbnail filenames with spaces and punctuation remain clickable images', async () => {
  const root = await fixture();
  await post(root, 1, 'thumbnail: "cover ) image.svg"\n');
  await Bun.write(join(root, id(1), 'cover ) image.svg'), '<svg/>');
  await buildBlog(root);
  const html = renderMarkdown(
    await Bun.file(join(root, 'INDEX.md')).text(),
    '/home/web/blog/INDEX.md',
  );
  expect(html).toContain('cover%20)%20image.svg');
  expect(html).toContain('<img ');
});

test('custom Handlebars templates render post and tag indexes from build data', async () => {
  const root = await fixture();
  const templates = await fixture();
  await post(root, 1);
  await Bun.write(
    join(templates, 'index.md.hbs'),
    '# {{md title}}\n{{#each posts}}[{{md title}}]({{url}})\n{{/each}}Page {{page}}/{{pageCount}}\n',
  );
  await Bun.write(
    join(templates, 'tags.md.hbs'),
    '# Topics\n{{#each tags}}[{{md name}}]({{url}}): {{count}}\n{{/each}}',
  );
  await buildBlog(root, templates);
  expect(await Bun.file(join(root, 'INDEX.md')).text()).toBe(
    '# Blog\n[Post 1](post-1/INDEX.md)\nPage 1/1\n',
  );
  const tags = await Bun.file(join(root, 'tags/INDEX.md')).text();
  expect(tags).toStartWith('# Topics\n');
  expect(tags).toContain('[Rust]');
  expect(tags).toContain(': 1');
  const tagLink = tags.match(/\[Rust\]\(([^)]+)\)/)![1];
  expect(await Bun.file(join(root, 'tags', tagLink)).text()).toContain(
    '# Tag: Rust',
  );
});

test('templates escape Markdown labels without double escaping ampersands', async () => {
  const root = await fixture();
  await post(root, 1);
  const path = join(root, 'post-1/INDEX.md');
  await Bun.write(
    path,
    (await Bun.file(path).text()).replace(
      'title: Post 1',
      'title: "[Rust] & <C++>"',
    ),
  );
  await buildBlog(root);
  const index = await Bun.file(join(root, 'INDEX.md')).text();
  expect(index).toContain('\\[Rust\\] &amp; &lt;C++&gt;');
  expect(index).not.toContain('&amp;amp;');
  const html = renderMarkdown(index, '/home/web/blog/INDEX.md');
  expect(html).toContain('>[Rust] &amp; &lt;C++&gt;</a>');
});

test('template errors fail before replacing existing indexes', async () => {
  const root = await fixture();
  const templates = await fixture();
  await post(root, 1);
  await buildBlog(root);
  const previous = await Bun.file(join(root, 'INDEX.md')).text();
  await Bun.write(join(templates, 'index.md.hbs'), '{{missingVariable}}');
  await Bun.write(join(templates, 'tags.md.hbs'), '# Tags\n');
  await expect(buildBlog(root, templates)).rejects.toThrow('missingVariable');
  expect(await Bun.file(join(root, 'INDEX.md')).text()).toBe(previous);
  expect(await Bun.file(join(root, 'tags/INDEX.md')).exists()).toBe(true);
});

test('nested categories include descendants but exclude siblings and root posts', async () => {
  const root = await fixture();
  await post(root, 1);
  await post(join(root, 'tutorials'), 2);
  await post(join(root, 'tutorials', 'cows'), 3, 'thumbnail: cover.svg\n');
  await Bun.write(join(root, 'tutorials/cows/post-3/cover.svg'), '<svg/>');
  await post(join(root, 'tutorials-extra'), 4);
  const article = join(root, 'tutorials/cows/post-3/INDEX.md');
  const original = await Bun.file(article).text();
  await buildBlog(root);
  const index = await Bun.file(join(root, 'INDEX.md')).text();
  expect(index.match(/^## /gm)).toHaveLength(4);
  expect(index).toContain('(tutorials/cows/post-3/INDEX.md)');
  const category = await Bun.file(join(root, 'tutorials/INDEX.md')).text();
  expect(category.match(/^## /gm)).toHaveLength(2);
  expect(category).toContain('(cows/post-3/INDEX.md)');
  expect(category).not.toContain('Post 1');
  expect(category).not.toContain('Post 4');
  const child = await Bun.file(join(root, 'tutorials/cows/INDEX.md')).text();
  expect(child.match(/^## /gm)).toHaveLength(1);
  expect(child).toContain('(post-3/cover.svg');
  expect(child).toContain('[Blog](../../INDEX.md)');
  expect(child).toContain('[Tags](../../tags/INDEX.md)');
  expect(await Bun.file(article).text()).toBe(original);
  await buildBlog(root);
  expect(await Bun.file(join(root, 'tutorials/INDEX.md')).text()).toBe(
    category,
  );
});

test('category pagination and tag pages keep nested links and remove stale pages', async () => {
  const root = await fixture();
  for (let n = 1; n <= 11; n++) {
    await post(join(root, 'tutorials/cows'), n);
  }
  await buildBlog(root);
  const older = await Bun.file(join(root, 'tutorials/pages/2/INDEX.md')).text();
  expect(older).toContain('(../../cows/post-1/INDEX.md)');
  expect(older).toContain('[Newer posts](../../INDEX.md)');
  const tags = await Bun.file(join(root, 'tags/INDEX.md')).text();
  const rust = tags.match(/\[Rust\]\(([^)]+)\)/)![1];
  expect(await Bun.file(join(root, 'tags', rust)).text()).toContain(
    '(../../tutorials/cows/post-11/INDEX.md)',
  );
  await rm(join(root, 'tutorials/cows/post-11'), {recursive: true});
  await buildBlog(root);
  expect(
    await Bun.file(join(root, 'tutorials/pages/2/INDEX.md')).exists(),
  ).toBe(false);
  expect(
    await Bun.file(join(root, 'tutorials/cows/pages/2/INDEX.md')).exists(),
  ).toBe(false);
  for (let n = 1; n <= 10; n++) {
    await rm(join(root, `tutorials/cows/post-${n}`), {recursive: true});
  }
  await buildBlog(root);
  expect(await Bun.file(join(root, 'tutorials/INDEX.md')).text()).toContain(
    'No posts yet.',
  );
});

test('nested article breadcrumbs link every category below the title and escape names', async () => {
  const raw =
    '---\ntitle: Article\ndate: 2026-09-01\ntags: []\n---\n\n# Article\n\nBody.\n';
  for (const prefix of ['/home/web/blog', '/blog']) {
    const html = renderMarkdown(
      raw,
      `${prefix}/Tips & tricks/cows/<calves>/article/INDEX.md`,
    );
    expect(html).toContain('<h1>Article</h1><nav class="blog-breadcrumb"');
    expect(html).toContain(
      'href="https://panicek.sk/blog/Tips%20%26%20tricks/"',
    );
    expect(html).toContain(
      `data-file="${prefix}/Tips &amp; tricks/cows/INDEX.md"`,
    );
    expect(html).toContain('>Tips &amp; tricks</a>');
    expect(html).toContain('>&lt;calves&gt;</a>');
    expect(html.match(/ &gt; /g)).toHaveLength(2);
    expect(html).not.toContain('>article</a>');
  }
  expect(renderMarkdown(raw, '/home/web/blog/article/INDEX.md')).not.toContain(
    'blog-breadcrumb',
  );
  expect(
    renderMarkdown(raw, '/home/web/docs/category/article/INDEX.md'),
  ).not.toContain('blog-breadcrumb');
});

test('listing previews show category breadcrumbs without classifying indexes as articles', async () => {
  const root = await fixture();
  await post(join(root, 'Tips & tricks/cows'), 1);
  await post(root, 2);
  await buildBlog(root);
  const html = renderMarkdown(
    await Bun.file(join(root, 'INDEX.md')).text(),
    '/home/web/blog/INDEX.md',
  );
  expect(html.match(/class="blog-breadcrumb"/g)).toHaveLength(1);
  expect(html).toContain(
    'href="https://panicek.sk/blog/Tips%20%26%20tricks/cows/"',
  );
  const category = renderMarkdown(
    await Bun.file(join(root, 'Tips & tricks/cows/INDEX.md')).text(),
    '/home/web/blog/Tips & tricks/cows/INDEX.md',
  );
  expect(category).not.toMatch(/<h1>.*<\/h1>\n<nav/);
  expect(category).toContain(
    'data-file="/home/web/blog/Tips &amp; tricks/INDEX.md"',
  );
});

test('a malformed nested article fails without overwriting authored content', async () => {
  const root = await fixture();
  const path = join(root, 'tutorials/broken/INDEX.md');
  await Bun.write(path, '# Missing frontmatter\n');
  await expect(buildBlog(root)).rejects.toThrow('Missing YAML frontmatter');
  expect(await Bun.file(path).text()).toBe('# Missing frontmatter\n');
});

test('categorized articles without a body heading use their metadata title above breadcrumbs', async () => {
  const root = await fixture();
  const raw =
    '---\ntitle: "A <cow> & calf"\ndate: 2026-09-01\ntags: []\n---\n\nOpening paragraph.\n';
  await Bun.write(join(root, 'tutorials/article/INDEX.md'), raw);
  await buildBlog(root);
  const html = renderMarkdown(raw, '/home/web/blog/tutorials/article/INDEX.md');
  expect(html).toContain(
    '<h1>A &lt;cow&gt; &amp; calf</h1><nav class="blog-breadcrumb"',
  );
  expect(html).toContain('>tutorials</a>');
  expect(html).toContain('<p>Opening paragraph.</p>');
});

test('category punctuation is literal in preview breadcrumbs', async () => {
  const root = await fixture();
  await post(join(root, '~~draft~~'), 1);
  await buildBlog(root);
  const html = renderMarkdown(
    await Bun.file(join(root, 'INDEX.md')).text(),
    '/home/web/blog/INDEX.md',
  );
  expect(html).toContain('>~~draft~~</a>');
  expect(html).not.toContain('<del>');
});
