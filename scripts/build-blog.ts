import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Marked, type Token } from 'marked';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from '../src/frontmatter';
import { validRemoteName } from '../src/remote-filesystem';

const PAGE_SIZE = 10;
const markdown = new Marked();
type Post = {
  directory: string;
  title: string;
  date: string;
  tags: string[];
  thumbnail?: string;
  excerpt: string;
};
const label = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_[\]{}()#!|]/g, '\\$&');
const url = (path: string) =>
  path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[()']/g,
        (character) => '%' + character.charCodeAt(0).toString(16),
      ),
    )
    .join('/');
const plain = (tokens: Token[] = []): string =>
  tokens
    .map((token) => {
      if (token.type === 'html' || token.type === 'image') return '';
      if ('tokens' in token && token.tokens) return plain(token.tokens);
      if (token.type === 'br') return ' ';
      return 'text' in token ? token.text : '';
    })
    .join('');
const tagId = (tag: string) => new Bun.CryptoHasher('sha256').update(tag).digest('hex');

async function readPosts(root: string): Promise<Post[]> {
  const posts: Post[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['INDEX.md', 'pages', 'tags'].includes(entry.name)) continue;
    const file = join(root, entry.name, 'INDEX.md');
    if (!entry.isDirectory() || !validRemoteName(entry.name) || entry.name.startsWith('.'))
      throw new Error(`Expected a publishable post directory: ${join(root, entry.name)}`);
    try {
      const { metadata, body } = splitFrontmatter(await Bun.file(file).text());
      if (metadata === null) throw new Error('Missing YAML frontmatter');
      const value = Bun.YAML.parse(metadata) as Record<string, unknown>;
      if (!value || typeof value !== 'object') throw new Error('Invalid metadata');
      const { title, date, tags, thumbnail } = value;
      if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title))
        throw new Error('title must be a nonempty single line');
      if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        throw new Error('date must be a valid YYYY-MM-DD date');
      if (
        !Array.isArray(tags) ||
        tags.some(
          (tag) => typeof tag !== 'string' || !tag.trim() || /[\r\n]/.test(tag) || tag.length > 80,
        )
      )
        throw new Error(
          'tags must be an array of nonempty single-line strings (up to 80 characters)',
        );
      if (thumbnail !== undefined) {
        if (
          typeof thumbnail !== 'string' ||
          !thumbnail ||
          thumbnail.split('/').some((part) => !part || part === '.' || part === '..') ||
          /[\\\x00-\x1f]/.test(thumbnail) ||
          !/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(thumbnail)
        )
          throw new Error('thumbnail must be an image path inside the post directory');
        if (!(await stat(join(root, entry.name, thumbnail))).isFile())
          throw new Error('thumbnail is not a file');
      }
      const paragraph = markdown
        .lexer(body)
        .find((token) => token.type === 'paragraph' && plain(token.tokens).trim());
      if (!paragraph || paragraph.type !== 'paragraph')
        throw new Error('Post needs a first paragraph');
      posts.push({
        directory: entry.name,
        title: title.trim(),
        date,
        tags: [...new Set((tags as string[]).map((tag) => tag.trim()))],
        thumbnail: thumbnail as string | undefined,
        excerpt: plain(paragraph.tokens).replace(/\s+/g, ' ').trim(),
      });
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return posts.sort(
    (a, b) => b.date.localeCompare(a.date) || a.directory.localeCompare(b.directory),
  );
}

// Run against a staging copy during site builds; pages/ and tags/ are generated-only.
export async function buildBlog(
  root: string,
  templateDirectory = fileURLToPath(new URL('./templates/blog/', import.meta.url)),
): Promise<void> {
  const engine = Handlebars.create();
  engine.registerHelper('md', (value: string) => label(value));
  // Output is Markdown: use the md helper for labels and pre-encoded URLs for targets.
  const [indexSource, tagsSource] = await Promise.all([
    Bun.file(join(templateDirectory, 'index.md.hbs')).text(),
    Bun.file(join(templateDirectory, 'tags.md.hbs')).text(),
  ]);
  const options = { noEscape: true, strict: true };
  const renderIndex = engine.compile(indexSource, options);
  const renderTags = engine.compile(tagsSource, options);
  await mkdir(root, { recursive: true });
  const posts = await readPosts(root);
  const files = new Map<string, string>();
  const tags = [...new Set(posts.flatMap((post) => post.tags))].sort();
  function pages(selected: Post[], base: string, title: string) {
    const count = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
    const pagePath = (page: number) =>
      posix.join(base, page === 1 ? 'INDEX.md' : `pages/${page}/INDEX.md`);
    for (let page = 1; page <= count; page++) {
      const path = pagePath(page);
      const href = (target: string) => url(posix.relative(posix.dirname(path), target));
      files.set(
        path,
        renderIndex({
          title,
          blogUrl: href('INDEX.md'),
          tagsUrl: href('tags/INDEX.md'),
          page,
          pageCount: count,
          newerUrl: page > 1 ? href(pagePath(page - 1)) : null,
          olderUrl: page < count ? href(pagePath(page + 1)) : null,
          posts: selected.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((post) => ({
            title: post.title,
            date: post.date,
            excerpt: post.excerpt,
            url: href(`${post.directory}/INDEX.md`),
            thumbnailUrl: post.thumbnail ? href(`${post.directory}/${post.thumbnail}`) : null,
            tags: post.tags.map((tag) => ({ name: tag, url: href(`tags/${tagId(tag)}/INDEX.md`) })),
          })),
        }),
      );
    }
  }
  pages(posts, '', 'Blog');
  files.set(
    'tags/INDEX.md',
    renderTags({
      blogUrl: '../INDEX.md',
      tags: tags.map((tag) => ({
        name: tag,
        url: `./${tagId(tag)}/INDEX.md`,
        count: posts.filter((post) => post.tags.includes(tag)).length,
      })),
    }),
  );
  for (const tag of tags)
    pages(
      posts.filter((post) => post.tags.includes(tag)),
      `tags/${tagId(tag)}`,
      `Tag: ${tag}`,
    );
  await rm(join(root, 'pages'), { recursive: true, force: true });
  await rm(join(root, 'tags'), { recursive: true, force: true });
  for (const [path, text] of files) await Bun.write(join(root, path), text);
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root || root.startsWith('--'))
    throw new Error('Usage: bun scripts/build-blog.ts <staged-blog-directory>');
  await buildBlog(root);
}
