// Static serialization is kept at the build/test boundary. The browser imports
// Article directly and reconciles React elements, never serialized Markdown HTML.
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Article, Markdown} from './markdown/article';
import type {ImageDimensions} from './markdown/tokens';

export type {ImageDimensions} from './markdown/tokens';
export {withinMarkdownBudget} from './markdown/media';
export {escapeHtml} from './html';

export function renderMarkdown(
  text: string,
  source: string,
  origin?: string,
  imageDimensions?: ImageDimensions,
) {
  return renderToStaticMarkup(
    createElement(Markdown, {text, source, origin, imageDimensions}),
  );
}

export function renderArticle(
  text: string,
  source: string,
  origin?: string,
  imageDimensions?: ImageDimensions,
  style?: string,
) {
  return renderToStaticMarkup(
    createElement(Article, {text, source, origin, imageDimensions, style}),
  );
}
