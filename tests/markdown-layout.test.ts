import { expect, test } from 'bun:test';
import { renderMarkdown } from '../src/markdown';
import { createFilesystem } from '../src/filesystem';
import { createShell } from '../src/shell';

const source = '/home/web/post.md';
const markdown = '---\nstyle: "line-height: 1.2; color: red"\n---\n# Heading\n\nBody\n';

test('article styles come from metadata and command overrides preserve other declarations', async () => {
  const { renderArticle } = await import('../src/markdown');
  const html = renderArticle(
    markdown,
    source,
    undefined,
    undefined,
    'line-height: 1.6; padding: 2em',
  );
  expect(html).toContain('<article class="markdown"');
  expect(html).toContain('style="line-height: 1.2; color: red;line-height: 1.6; padding: 2em"');
  expect(html).not.toContain('markdown-body');
  expect(renderArticle('# Default', source)).not.toContain('style=');
  for (const value of ['1.2', '[color, red]', 'true']) {
    expect(renderArticle(`---\nstyle: ${value}\n---\nBody`, source)).not.toContain('style=');
  }
  expect(renderArticle('---\nstyle: [\n---\nBody', source)).toContain('<p>Body</p>');
  const escaped = renderArticle(
    '# Safe',
    source,
    undefined,
    undefined,
    'font-family: "serif"; content: "<script>"',
  );
  expect(escaped).toContain('&quot;serif&quot;');
  expect(escaped).not.toContain('<script>');
});

test('render accepts quoted CSS through --style and -s for files and pipes', async () => {
  const shell = createShell(await createFilesystem({ [source]: markdown }));
  for (const command of [
    'render --style "line-height: 1.5; color: blue" post.md',
    'render -s "line-height: 1.5; color: blue" post.md',
    'cat post.md | render --style="line-height: 1.5; color: blue"',
  ]) {
    const result = await shell.exec(command);
    expect(result.exitCode).toBe(0);
    expect(result.documents).toEqual([
      { path: source, text: markdown, style: 'line-height: 1.5; color: blue' },
    ]);
  }
  for (const command of ['render --style', 'render -s', 'render --line-height 1.2 post.md']) {
    const result = await shell.exec(command);
    expect(result.exitCode).toBe(1);
    expect(result.documents).toEqual([]);
  }
  expect((await shell.exec('render post.md')).documents).toEqual([
    { path: source, text: markdown },
  ]);
});

test('image sizes accept fractional em and px while preserving intrinsic pixel dimensions', () => {
  const html = renderMarkdown('![Cup](cup.gif "width=3em")', source, undefined, {
    '/home/web/cup.gif': { width: 120, height: 192 },
  });
  expect(html).toContain('style="width:3em"');
  expect(html).toContain('width="120" height="192"');
  expect(renderMarkdown('![Cup](cup.gif "width=2.5em height=4em align=center")', source)).toContain(
    'style="width:2.5em;height:4em" class="image-center"',
  );
  expect(renderMarkdown('![Cup](cup.gif "width=48px")', source)).toContain('style="width:48px"');
  for (const value of ['width=3em;color:red', 'width=-3em', 'width=0em', 'width=NaNem']) {
    expect(renderMarkdown(`![Cup](cup.gif "${value}")`, source)).not.toContain('style=');
  }
});
