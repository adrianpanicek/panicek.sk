import { Marked, Renderer } from 'marked';
import { resolveLink } from './paths';

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
  const renderer = new Renderer();
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
      /^(?:width=([1-9][0-9]{0,3}))(?: height=([1-9][0-9]{0,3}))?(?: align=(left|right|center))?$/,
    );
    const width = layout ? Math.min(Number(layout[1]), 4096) : null;
    const alignment = layout?.[3];
    const size = layout?.[2]
      ? { width: width!, height: Math.min(Number(layout[2]), 4096) }
      : local
        ? imageDimensions[local.path]
        : undefined;
    const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
    const attributes = width
      ? ` style="width:${width}px"${alignment ? ` class="image-${alignment}"` : ''}`
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
      return `<a href="${escapeHtml(local.href)}"${attr}>${label}</a>`;
    }
    if (!/^(https?:|mailto:|tel:)/i.test(href)) return label;
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`;
  };
  return new Marked({ renderer, gfm: true, breaks: false }).parse(text, { async: false });
}
