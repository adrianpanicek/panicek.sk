import { parse } from 'yaml';
import { splitFrontmatter } from './frontmatter';

export function renderHook(text: string): string | undefined {
  const { metadata } = splitFrontmatter(text);
  if (!metadata || !/^on_render\s*:/m.test(metadata)) return;
  if (metadata.length > 16384) throw new Error('on_render metadata exceeds 16 KiB');
  const value = parse(metadata, { maxAliasCount: 10 })?.on_render;
  if (typeof value !== 'string' || !value.trim() || value.length > 4096)
    throw new Error('on_render must be a nonempty command string of at most 4096 characters');
  return value;
}
