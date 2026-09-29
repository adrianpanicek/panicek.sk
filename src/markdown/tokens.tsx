import {decodeHTML as decodeEntities} from 'entities';
import {Fragment, createElement, type ReactNode} from 'react';
import {Lexer, type Token, type Tokens} from 'marked';
import {hrefFor, resolveLink} from '../paths';
import {EggCups} from './egg-cups';
import {renderImage} from './render-image';

export type ImageDimensions = Record<string, {width: number; height: number}>;

export type MarkdownContext = {
  source: string;
  origin: string;
  imageDimensions: ImageDimensions;
  breadcrumb?: ReactNode;
  titleSeen: boolean;
};

export function renderTokens(
  tokens: Token[],
  context: MarkdownContext,
): ReactNode {
  return tokens.map((token, index) => (
    <Fragment key={index}>{renderToken(token, context)}</Fragment>
  ));
}

function renderToken(token: Token, context: MarkdownContext): ReactNode {
  const children = (items: Token[] = []) => renderTokens(items, context);

  switch (token.type) {
    case 'space':
      return null;

    case 'heading': {
      const heading = createElement(
        `h${token.depth}`,
        null,
        children(token.tokens),
      );

      if (token.depth !== 1 || context.titleSeen) {
        return heading;
      }

      context.titleSeen = true;

      return (
        <>
          {heading}
          {context.breadcrumb}
        </>
      );
    }

    case 'paragraph': {
      const parts = token.tokens as Token[];

      const category =
        parts.some(
          part => part.type === 'link' && part.title === 'blog-category',
        ) &&
        parts.every(
          part =>
            (part.type === 'link' && part.title === 'blog-category') ||
            (part.type === 'text' && /^\s*>\s*$/.test(part.text)),
        );

      return category ? (
        <nav className="blog-breadcrumb" aria-label="Article category">
          {children(parts)}
        </nav>
      ) : (
        <p>{children(parts)}</p>
      );
    }

    case 'text':
      return token.tokens ? children(token.tokens) : decodeEntities(token.text);

    case 'escape':
      return decodeEntities(token.text);

    case 'html':
      return token.text;

    case 'strong':
      return <strong>{children(token.tokens)}</strong>;

    case 'em':
      return <em>{children(token.tokens)}</em>;

    case 'del':
      return <del>{children(token.tokens)}</del>;

    case 'codespan':
      return <code>{token.text}</code>;

    case 'br':
      return <br />;

    case 'hr':
      return <hr />;

    case 'blockquote':
      return <blockquote>{children(token.tokens)}</blockquote>;

    case 'code': {
      const bits = token.text.trim();

      if (token.lang === 'egg-cups' && /^[01]{1,8}$/.test(bits)) {
        return <EggCups bits={bits} />;
      }

      return (
        <pre>
          <code
            className={
              token.lang ? `language-${token.lang.split(/\s/)[0]}` : undefined
            }
          >
            {token.text + '\n'}
          </code>
        </pre>
      );
    }

    case 'link': {
      const local = resolveLink(token.href, context.source, context.origin);

      if (local) {
        const blog = local.href.match(
          /^\/(?:home\/web\/)?blog\/(.*)INDEX\.md$/,
        );

        return (
          <a
            href={blog ? `${context.origin}/blog/${blog[1]}` : local.href}
            data-file={
              local.path.toLowerCase().endsWith('.md') ? local.path : undefined
            }
          >
            {children(token.tokens)}
          </a>
        );
      }

      return /^(https?:|mailto:|tel:)/i.test(token.href) ? (
        <a href={token.href} rel="noopener noreferrer">
          {children(token.tokens)}
        </a>
      ) : (
        children(token.tokens)
      );
    }

    case 'image':
      return renderImage(token as Tokens.Image, context);

    case 'list': {
      const items = (token.items as Tokens.ListItem[]).map((item, index) => (
        <li key={index}>
          {item.task && (
            <>
              <input
                type="checkbox"
                checked={item.checked}
                disabled
                readOnly
              />{' '}
            </>
          )}
          {children(item.tokens)}
        </li>
      ));

      return token.ordered ? (
        <ol start={token.start === 1 ? undefined : token.start}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      );
    }

    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {(token.header as Tokens.TableCell[]).map((cell, i) => (
                <th key={i} align={token.align[i] || undefined}>
                  {children(cell.tokens)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(token.rows as Tokens.TableCell[][]).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} align={token.align[j] || undefined}>
                    {children(cell.tokens)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    default:
      return 'text' in token ? String(token.text) : null;
  }
}

export const tokenize = (text: string) => Lexer.lex(text, {gfm: true});

export {hrefFor};
