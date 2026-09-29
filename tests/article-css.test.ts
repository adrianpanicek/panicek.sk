import {expect, test} from 'bun:test';
import {renderArticle} from '../src/markdown';

const source = '/home/web/blog/cups/INDEX.md';
const article = (css: string) =>
  renderArticle(
    `---\ncss: |\n${css
      .split('\n')
      .map(line => '  ' + line)
      .join('\n')}\n---\n# Cups`,
    source,
  );

test('article CSS is scoped, resolves assets, and preserves conditional rules', () => {
  const html = article(
    '.cup { background: url(cup.svg) }\n@media (prefers-reduced-motion: reduce) { .cup { color: red } }',
  );
  expect(html).toContain('data-article-scope=');
  expect(html).toContain('<style');
  expect(html).toContain('/home/web/blog/cups/cup.svg');
  expect(html).toContain('prefers-reduced-motion');
  expect(html).toMatch(/\[data-article-scope[^\]]+\] \.cup/);
});

test('article CSS rejects global rules and cannot terminate a style element', () => {
  for (const css of [
    '@import "https://example.com/global.css";',
    '@font-face { font-family: x; src: url(x) }',
    '.x { color: red',
    '.x { content: "</style><script>alert(1)</script>" }',
  ]) {
    const html = article(css);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<h1>Cups</h1>');
  }
});

test('selectors cannot use a scoped ancestor to escape into the terminal', () => {
  const html = article('& + footer { display: none }');
  expect(html).not.toContain('<style');
});

test('leading sibling selectors cannot target content outside an article', () => {
  for (const css of [
    '+ .application-slot { display: none }',
    '/* leading comment */ + footer { display: none }',
    '~ article { display: none }',
    "html[data-animations='off'] + footer { display: none }",
    "html[data-animations='off'] /* comment */ + footer { display: none }",
    '.cup, + footer { display: none }',
  ]) {
    expect(article(css)).not.toContain('<style');
  }
});
