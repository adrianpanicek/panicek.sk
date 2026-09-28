import { markdownStyle } from './render-options';
import { renderEggCups } from './egg-cups';
import { Marked, Renderer } from 'marked';
import { resolveLink } from './paths';
import { splitFrontmatter } from './frontmatter';

export type ImageDimensions = Record<string, { width: number; height: number }>;
declare const IMAGE_DIMENSIONS: ImageDimensions;

export const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function youtubeId(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.port) return null;
    const host = url.hostname;
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)
    ) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)$/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function withinMarkdownBudget(text: string): boolean {
  if (text.length > 32768) return false;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n' && ++lines > 300) return false;
  return true;
}

export function renderMarkdown(
  text: string,
  source: string,
  origin = 'https://panicek.sk',
  imageDimensions: ImageDimensions = typeof IMAGE_DIMENSIONS === 'undefined'
    ? {}
    : IMAGE_DIMENSIONS,
): string {
  if (!withinMarkdownBudget(text))
    return `<p class="scrollback-note">Large output shown as plain text to keep the terminal responsive.</p><pre class="output">${escapeHtml(text)}</pre>`;
  text = splitFrontmatter(text).body;
  const renderer = new Renderer();
  renderer.code = function (token) {
    const bits = token.text.trim();
    if (token.lang === 'egg-cups' && /^[01]{1,8}$/.test(bits)) return renderEggCups(bits);
    return Renderer.prototype.code.call(this, token);
  };
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.image = ({ href, text, title }) => {
    const video = youtubeId(href);
    if (video) {
      const label = escapeHtml(title || text || 'YouTube video');
      return `<span class="youtube-video"><iframe src="https://www.youtube-nocookie.com/embed/${video}" title="${label}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></span><a href="https://www.youtube.com/watch?v=${video}" rel="noopener noreferrer">Open on YouTube</a>`;
    }
    const local = resolveLink(href, source, origin);
    const src = local?.href ?? (/^https?:\/\//i.test(href) ? href : null);
    if (!src) return escapeHtml(text);
    const layout = title?.match(
      /^width=([0-9]{1,4}(?:\.[0-9]{1,4})?|\.[0-9]{1,4})(px|em)?(?: height=([0-9]{1,4}(?:\.[0-9]{1,4})?|\.[0-9]{1,4})(px|em)?)?(?: align=(left|right|center))?$/,
    );
    const valid = layout && Number(layout[1]) > 0 && (!layout[3] || Number(layout[3]) > 0);
    const widthUnit = layout?.[2] || 'px';
    const heightUnit = layout?.[4] || 'px';
    const width = valid ? Math.min(Number(layout[1]), widthUnit === 'em' ? 256 : 4096) : null;
    const height =
      valid && layout[3] ? Math.min(Number(layout[3]), heightUnit === 'em' ? 256 : 4096) : null;
    const alignment = valid ? layout[5] : undefined;
    // HTML dimensions are pixel counts. Relative CSS sizes retain the image's
    // intrinsic pixel dimensions for aspect-ratio reservation.
    const size =
      width && height && widthUnit === 'px' && heightUnit === 'px'
        ? { width, height }
        : local
          ? imageDimensions[local.path]
          : undefined;
    const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
    const attributes = width
      ? ` style="width:${width}${widthUnit}${height ? `;height:${height}${heightUnit}` : ''}"${alignment ? ` class="image-${alignment}"` : ''}`
      : title
        ? ` title="${escapeHtml(title)}"`
        : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${attributes}${dimensions} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  };
  renderer.link = function ({ href, tokens }) {
    const label = this.parser.parseInline(tokens);
    const local = resolveLink(href, source, origin);
    if (local) {
      const attr = local.path.toLowerCase().endsWith('.md')
        ? ` data-file="${escapeHtml(local.path)}"`
        : '';
      const blog = local.href.match(/^\/(?:home\/web\/)?blog\/(.*)INDEX\.md$/);
      const destination = blog ? `${origin}/blog/${blog[1]}` : local.href;
      return `<a href="${escapeHtml(destination)}"${attr}>${label}</a>`;
    }
    if (!/^(https?:|mailto:|tel:)/i.test(href)) return label;
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`;
  };
  return new Marked({ renderer, gfm: true, breaks: false }).parse(text, { async: false });
}

// Keep prerendered pages and interactive rendering on the same article element.
export function renderArticle(
  text: string,
  source: string,
  origin = 'https://panicek.sk',
  imageDimensions?: ImageDimensions,
  style?: string,
): string {
  const css = markdownStyle(text, style);
  return `<article class="markdown" data-source="${escapeHtml(source)}"${css ? ` style="${escapeHtml(css)}"` : ''}>${renderMarkdown(text, source, origin, imageDimensions)}</article>`;
}
