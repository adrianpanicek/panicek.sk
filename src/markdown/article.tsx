import {Fragment, useCallback} from 'react';
import {parse} from 'yaml';
import {splitFrontmatter} from '../frontmatter';
import {markdownStyle} from '../render-options';
import {CATEGORY_METADATA, postCategories} from '../blog';
import {articleStyles, inlineStyle} from './styles';
import {withinMarkdownBudget} from './media';
import {
  renderTokens,
  tokenize,
  hrefFor,
  type MarkdownContext,
  type ImageDimensions,
} from './tokens';

declare const IMAGE_DIMENSIONS: ImageDimensions;

export type ArticleProps = {
  text: string;
  source: string;
  origin?: string;
  imageDimensions?: ImageDimensions;
  style?: string;
  error?: boolean;
};

function readMetadata(text: string): Record<string, unknown> {
  const {metadata} = splitFrontmatter(text);

  if (metadata && metadata.length <= 16384) {
    try {
      const result = parse(metadata, {maxAliasCount: 10});

      return result && typeof result === 'object' ? result : {};
    } catch {}
  }

  return {};
}

export function Markdown({
  text,
  source,
  origin = 'https://panicek.sk',
  imageDimensions = typeof IMAGE_DIMENSIONS === 'undefined'
    ? {}
    : IMAGE_DIMENSIONS,
}: ArticleProps) {
  if (!withinMarkdownBudget(text)) {
    return (
      <>
        <p className="scrollback-note">
          Large output shown as plain text to keep the terminal responsive.
        </p>
        <pre className="output">{text}</pre>
      </>
    );
  }

  const {metadata: raw, body} = splitFrontmatter(text);

  const article =
    raw !== null && raw !== CATEGORY_METADATA
      ? source.match(/^(\/(?:home\/web\/)?blog)\/(.+)\/INDEX\.md$/)
      : null;

  const categories = article ? postCategories(article[2]) : [];

  const breadcrumb = categories.length ? (
    <nav className="blog-breadcrumb" aria-label="Article category">
      {categories.map(({name, directory}, index) => (
        <Fragment key={directory}>
          {index > 0 && ' > '}
          <a
            href={`${origin}/blog/${hrefFor(directory)}/`}
            data-file={`${article![1]}/${directory}/INDEX.md`}
          >
            {name}
          </a>
        </Fragment>
      ))}
    </nav>
  ) : null;

  const context: MarkdownContext = {
    source,
    origin,
    imageDimensions,
    breadcrumb,
    titleSeen: false,
  };

  const content = renderTokens(tokenize(body), context);
  const title = readMetadata(text).title;

  return (
    <>
      {breadcrumb && !context.titleSeen && (
        <>
          {typeof title === 'string' && <h1>{title}</h1>}
          {breadcrumb}
        </>
      )}
      {content}
    </>
  );
}

export function Article(props: ArticleProps) {
  const css = markdownStyle(props.text, props.style);

  // React's style property setter does not support !important. Let the browser
  // parse authored declarations on commit, matching its static CSS cascade.
  const applyStyle = useCallback(
    (node: HTMLElement | null) => {
      if (node && css) {
        node.style.cssText = css;
      }
    },
    [css],
  );

  const styles = articleStyles(
    readMetadata(props.text).css,
    props.source,
    props.origin || 'https://panicek.sk',
  );

  return (
    <article
      className={props.error ? 'markdown error' : 'markdown'}
      data-source={props.source}
      style={inlineStyle(css)}
      ref={applyStyle}
      data-article-scope={styles?.scope}
    >
      {styles && <style>{styles.css}</style>}
      <Markdown {...props} />
    </article>
  );
}
