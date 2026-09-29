import {decodeHTML as decodeEntities} from 'entities';
import type {CSSProperties} from 'react';
import type {Tokens} from 'marked';
import {resolveLink} from '../paths';
import {ArticleImage} from './image';
import {youtubeId} from './media';
import type {MarkdownContext} from './tokens';

export function renderImage(token: Tokens.Image, context: MarkdownContext) {
  const {href, text, title} = token;
  const video = youtubeId(href);

  if (video) {
    return (
      <>
        <span className="youtube-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video}`}
            title={title || text || 'YouTube video'}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </span>
        <a
          href={`https://www.youtube.com/watch?v=${video}`}
          rel="noopener noreferrer"
        >
          Open on YouTube
        </a>
      </>
    );
  }

  const local = resolveLink(href, context.source, context.origin);
  const src = local?.href ?? (/^https?:\/\//i.test(href) ? href : null);

  if (!src) {
    return text;
  }

  const layout = title?.match(
    /^width=([0-9]{1,4}(?:\.[0-9]{1,4})?|\.[0-9]{1,4})(px|em)?(?: height=([0-9]{1,4}(?:\.[0-9]{1,4})?|\.[0-9]{1,4})(px|em)?)?(?: align=(left|right|center))?$/,
  );

  const valid =
    layout && Number(layout[1]) > 0 && (!layout[3] || Number(layout[3]) > 0);
  const widthUnit = layout?.[2] || 'px';
  const heightUnit = layout?.[4] || 'px';
  const width = valid
    ? Math.min(Number(layout[1]), widthUnit === 'em' ? 256 : 4096)
    : null;

  const height =
    valid && layout[3]
      ? Math.min(Number(layout[3]), heightUnit === 'em' ? 256 : 4096)
      : null;

  let dimensions = local ? context.imageDimensions[local.path] : undefined;

  if (width && height && widthUnit === 'px' && heightUnit === 'px') {
    dimensions = {width, height};
  }

  const style: CSSProperties | undefined = width
    ? {
        width: `${width}${widthUnit}`,
        ...(height ? {height: `${height}${heightUnit}`} : {}),
      }
    : undefined;

  const portrait =
    context.source === '/home/web/ABOUT.md' &&
    local?.path === '/home/web/portrait.png';

  return (
    <ArticleImage
      src={src}
      alt={decodeEntities(text)}
      style={style}
      className={valid && layout[5] ? `image-${layout[5]}` : undefined}
      title={!width && title ? title : undefined}
      {...dimensions}
      loading={portrait ? 'eager' : 'lazy'}
      fetchPriority={portrait ? 'high' : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}
