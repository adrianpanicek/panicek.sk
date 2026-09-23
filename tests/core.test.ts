import { describe, expect, test } from 'bun:test';
import { rawPath, resolveLink, catCommand, isBlogPath } from '../src/paths';
import { renderMarkdown } from '../src/markdown';

describe('virtual paths', () => {
  test('blog navigation recognizes canonical, short and home aliases', () => {
    for (const path of ['/blog', '/blog/post/', '/home/web/blog/INDEX.md', '/~/blog/tags/'])
      expect(isBlogPath(path)).toBe(true);
    for (const path of ['/', '/blogger', '/home/web/blog/../ABOUT.md'])
      expect(isBlogPath(path)).toBe(false);
  });
  test('home notation works for arbitrary nested files', () => {
    expect(rawPath('/~/notes/a%20b.md')).toBe('/home/web/notes/a b.md');
    expect(rawPath('/tmp/example.txt')).toBe('/tmp/example.txt');
    expect(rawPath('/%7E/CAREER.md')).toBe('/home/web/CAREER.md');
    expect(() => rawPath('/%00')).toThrow();
    expect(() => rawPath('/%XX')).toThrow();
  });
  test('relative links belong to their document', () => {
    expect(resolveLink('../CAREER.md', '/home/web/notes/index.md')?.path).toBe(
      '/home/web/CAREER.md',
    );
    expect(resolveLink('~/CONTACTS.md', '/tmp/test.md')?.path).toBe('/home/web/CONTACTS.md');
    expect(resolveLink('https://panicek.sk/home/web/CAREER.md', '/tmp/test.md')?.path).toBe(
      '/home/web/CAREER.md',
    );
    expect(resolveLink('https://example.com/a.md', '/tmp/test.md')).toBeNull();
  });
  test('cat operands are safely quoted', () => {
    expect(catCommand("/home/web/a'$(touch hacked).md")).toBe(
      "cat -- '/home/web/a'\"'\"'$(touch hacked).md'",
    );
  });
});

describe('Markdown output', () => {
  test('local links carry the resolved file and a working raw href', () => {
    const html = renderMarkdown('[Career](CAREER.md)', '/home/web/ABOUT.md');
    expect(html).toContain('href="/home/web/CAREER.md"');
    expect(html).toContain('data-file="/home/web/CAREER.md"');
  });
  test('untrusted output cannot become HTML or unsafe links', () => {
    const html = renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert)',
      '/home/web/a.md',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;img');
  });
});

describe('command typing', () => {
  test('reveals every character in order', async () => {
    const { typeText } = await import('../src/typing');
    const frames: string[] = [];
    expect(await typeText('cat ~/', (value) => frames.push(value), { delay: 0 })).toBe(true);
    expect(frames).toEqual(['c', 'ca', 'cat', 'cat ', 'cat ~', 'cat ~/']);
  });
  test('cancellation cannot finish the command', async () => {
    const { typeText } = await import('../src/typing');
    const controller = new AbortController();
    const frames: string[] = [];
    expect(
      await typeText(
        'cat file',
        (value) => {
          frames.push(value);
          controller.abort();
        },
        { delay: 0, signal: controller.signal },
      ),
    ).toBe(false);
    expect(frames).toEqual(['c']);
  });
});

test('large Markdown-looking logs stay cheap to display', async () => {
  const { renderMarkdown } = await import('../src/markdown');
  const text = '# Log\n' + 'value\n'.repeat(50000);
  const start = performance.now();
  const rendered = renderMarkdown(text, '/tmp/log.md');
  expect(rendered).toContain('Large output shown as plain text');
  expect(rendered).toContain('value');
  expect(performance.now() - start).toBeLessThan(1000);
});

describe('contact display tokens', () => {
  test('decodes repeated ROT13 tokens and leaves other text intact', async () => {
    const { decodeContactTokens } = await import('../src/contacts');
    expect(decodeContactTokens('Email {{rot13:nqevna@cnavprx.fx}} / {{rot13:Uryyb}}')).toBe(
      'Email adrian@panicek.sk / Hello',
    );
    expect(decodeContactTokens('{{unknown:abc}} {{rot13:broken')).toBe(
      '{{unknown:abc}} {{rot13:broken',
    );
    const html = renderMarkdown(
      decodeContactTokens('[Email](mailto:{{rot13:nqevna@cnavprx.fx}})'),
      '/home/web/CONTACTS.md',
    );
    expect(html).toContain('href="mailto:adrian@panicek.sk"');
    expect(
      renderMarkdown(decodeContactTokens('{{rot13:<fpevcg>nyreg(1)</fpevcg>}}'), '/tmp/a.md'),
    ).not.toContain('<script>');
  });
});

test('ROT47 contact tokens decode phone and WhatsApp links', async () => {
  const { decodeContactTokens } = await import('../src/contacts');
  const contacts = decodeContactTokens(await Bun.file('content/CONTACTS.md').text());
  expect(contacts).toContain('tel:+421902796000');
  expect(renderMarkdown(contacts, '/home/web/CONTACTS.md')).toContain('href="tel:+421902796000"');
  expect(contacts).toContain('+421 902 796 000');
  expect(contacts).toContain('https://wa.me/421902796000');
});

test('Markdown images resolve relative paths and reject unsafe schemes', () => {
  const html = renderMarkdown('![Portrait](images/me.png "Portrait")', '/home/web/ABOUT.md');
  expect(html).toContain('src="/home/web/images/me.png"');
  expect(html).toContain('alt="Portrait"');
  expect(html).toContain('loading="lazy"');
  expect(
    renderMarkdown('![bad](javascript:alert) ![bad](data:image/svg+xml,test)', '/tmp/a.md'),
  ).not.toContain('<img');
  expect(renderMarkdown('![Remote](https://example.com/photo.jpg)', '/tmp/a.md')).toContain(
    'src="https://example.com/photo.jpg"',
  );
});

test('YouTube image syntax embeds only validated video URLs with a fallback link', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=abcdefghijk',
    'https://youtu.be/abcdefghijk',
    'https://www.youtube.com/shorts/abcdefghijk',
    'https://www.youtube-nocookie.com/embed/abcdefghijk',
  ]) {
    const html = renderMarkdown(`![Demo](${url})`, '/home/web/VIDEO.md');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abcdefghijk"');
    expect(html).toContain('title="Demo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('Open on YouTube');
  }
  for (const url of [
    'https://youtube.com.evil.test/watch?v=abcdefghijk',
    'https://youtube.com@evil.test/watch?v=abcdefghijk',
    'javascript:abcdefghijk',
    'https://youtube.com/watch?v=bad',
  ]) {
    expect(renderMarkdown(`![Demo](${url})`, '/tmp/a.md')).not.toContain('<iframe');
  }
  expect(renderMarkdown('[Demo](https://youtu.be/abcdefghijk)', '/tmp/a.md')).not.toContain(
    '<iframe',
  );
  expect(renderMarkdown('!["<unsafe>"](https://youtu.be/abcdefghijk)', '/tmp/a.md')).not.toContain(
    'title=""<unsafe>',
  );
});

test('Markdown image layout accepts bounded sizes and named alignments', () => {
  const image = (title: string) =>
    renderMarkdown(`![Portrait](portrait.png "${title}")`, '/home/web/ABOUT.md');
  expect(image('width=160 align=right')).toContain('style="width:160px" class="image-right"');
  expect(image('width=480 align=center')).toContain('class="image-center"');
  expect(image('width=9999')).toContain('style="width:4096px"');
  expect(image('A portrait')).toContain('title="A portrait"');
  expect(image('width=160;position:fixed')).not.toContain('style=');
  expect(image('width=160 align=evil')).not.toContain('class=');
  expect(renderMarkdown('![Photo](photo.jpg)', '/tmp/a.md')).not.toContain('style=');
});

test('Markdown reserves local and explicitly sized remote images before loading', () => {
  const local = renderMarkdown(
    '![Portrait](portrait.png "width=224 align=right")',
    '/home/web/ABOUT.md',
    'https://panicek.sk',
    { '/home/web/portrait.png': { width: 400, height: 400 } },
  );
  expect(local).toContain('width="400" height="400"');
  expect(local).toContain('style="width:224px"');
  expect(local).toContain('class="image-right"');
  const remote = renderMarkdown(
    '![Landscape](https://example.com/photo.jpg "width=800 height=450")',
    '/home/web/ABOUT.md',
  );
  expect(remote).toContain('width="800" height="450"');
});
