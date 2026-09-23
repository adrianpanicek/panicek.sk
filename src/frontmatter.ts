// Keep parsing YAML out of the browser bundle; only the build needs metadata.
export function splitFrontmatter(text: string): { metadata: string | null; body: string } {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match
    ? { metadata: match[1], body: text.slice(match[0].length) }
    : { metadata: null, body: text };
}
