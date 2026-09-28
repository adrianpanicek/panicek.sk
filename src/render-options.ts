import { parse } from 'yaml';
import { splitFrontmatter } from './frontmatter';

export function markdownStyle(text: string, override?: string): string {
  const { metadata } = splitFrontmatter(text);
  let style: unknown;
  if (metadata && metadata.length <= 16384) {
    try {
      style = parse(metadata, { maxAliasCount: 10 })?.style;
    } catch {}
  }
  return [style, override]
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map((value) => value.trim())
    .join(';');
}
