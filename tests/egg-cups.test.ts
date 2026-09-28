import { expect, test } from 'bun:test';
import { renderMarkdown } from '../src/markdown';

test('egg-cup blocks render accessible binary controls and the decimal value', () => {
  const html = renderMarkdown('```egg-cups\n0101\n```', '/home/web/blog/test/INDEX.md');
  expect(html).toContain('data-egg-cups');
  expect(html.match(/<button /g)).toHaveLength(4);
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="8\'s place"');
  expect(html).toContain('aria-live="polite">5</output>');
});

test('invalid egg-cup blocks remain escaped code', () => {
  for (const value of ['1234', '111111111', '<script>alert(1)</script>']) {
    const html = renderMarkdown('```egg-cups\n' + value + '\n```', '/home/web/test.md');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<script>');
  }
});
