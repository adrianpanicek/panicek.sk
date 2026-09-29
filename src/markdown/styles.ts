import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import type {CSSProperties} from 'react';
import {resolveLink} from '../paths';

export function inlineStyle(css: string): CSSProperties | undefined {
  if (!css) {
    return;
  }

  try {
    const rule = postcss.parse(`a{${css}}`).first;

    if (rule?.type !== 'rule') {
      return;
    }

    const result: Record<string, string> = {};
    const priorities = new Set<string>();
    rule.walkDecls(({prop, value, important}) => {
      if (priorities.has(prop) && !important) {
        return;
      }

      if (important) {
        priorities.add(prop);
      }

      const name = prop.startsWith('--')
        ? prop
        : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

      result[name] = value + (important ? ' !important' : '');
    });

    return result;
  } catch {
    return;
  }
}

// Hash content as well as path: edited copies in scrollback keep their own styles.
export function articleStyles(css: unknown, source: string, origin: string) {
  if (
    typeof css !== 'string' ||
    !css.trim() ||
    css.length > 16384 ||
    /</.test(css)
  ) {
    return;
  }

  let hash = 2166136261;

  for (const char of source + css) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  }

  const scope = `article-${(hash >>> 0).toString(36)}`;
  const boundary = `[data-article-scope="${scope}"]`;

  try {
    const root = postcss.parse(css);
    root.walkAtRules(rule => {
      if (!['media', 'supports'].includes(rule.name.toLowerCase())) {
        throw new Error('Unsupported article rule');
      }
    });
    root.walkRules(rule => {
      if (rule.parent?.type === 'rule') {
        throw new Error('Use flat selectors');
      }

      const selectors = selectorParser().astSync(rule.selector);
      selectors.walkNesting(() => {
        throw new Error('Nesting can escape the article');
      });
      rule.selector = selectors.nodes
        .map(selector => {
          const text = selector.toString().trim();
          // This one documented ancestor condition supports the site's motion toggle.
          const motion = text.match(/^html\[data-animations=['"]off['"]\]\s+/);
          const local = motion ? text.slice(motion[0].length) : text;
          const parsed = selectorParser().astSync(local);

          if (parsed.first?.first?.type === 'combinator') {
            throw new Error('Article selectors must start inside the article');
          }

          return motion
            ? `${motion[0]}${boundary} ${local}`
            : `${boundary} ${local}`;
        })
        .join(', ');
    });
    root.walkDecls(decl => {
      if (decl.parent?.type !== 'rule') {
        throw new Error('Declarations need a selector');
      }

      const value = valueParser(decl.value);
      value.walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') {
          return;
        }

        const url = valueParser
          .stringify(node.nodes)
          .replace(/^(['"])(.*)\1$/, '$2');
        const local = resolveLink(url, source, origin);

        if (!local) {
          throw new Error('Article assets must be local');
        }

        node.nodes = [
          {
            type: 'string',
            quote: '"',
            value: local.href,
            sourceIndex: 0,
            sourceEndIndex: 0,
          },
        ];
      });
      decl.value = value.toString();
    });

    return {scope, css: root.toString()};
  } catch {
    return;
  }
}
