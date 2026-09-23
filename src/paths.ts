export const HOME = '/home/web';
export const ORIGIN = 'https://panicek.sk';

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

export function rawPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) throw new Error('Invalid path');
  const expanded =
    decoded === '/~' ? HOME : decoded.startsWith('/~/') ? HOME + decoded.slice(2) : decoded;
  // Leave dot segments to the filesystem so symlinks resolve in traversal order.
  return expanded.startsWith('/') ? expanded : '/' + expanded;
}

export const hrefFor = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export const catCommand = (path: string) => `cat -- ${quote(path)}`;
export const displayPath = (path: string) =>
  path === HOME ? '~' : path.startsWith(HOME + '/') ? '~' + path.slice(HOME.length) : path;
export const displayCat = (path: string) =>
  /^[\w/ .-]+$/.test(path) && !path.includes(' ') ? `cat ${displayPath(path)}` : catCommand(path);

export function resolveLink(
  href: string,
  source: string,
  origin = ORIGIN,
): { path: string; href: string } | null {
  try {
    let path: string;
    if (href.startsWith('~/')) path = rawPath('/' + href.split(/[?#]/)[0]);
    else {
      const url = new URL(href, origin + hrefFor(source));
      if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)) return null;
      path = rawPath(url.pathname);
    }
    return { path, href: hrefFor(path) };
  } catch {
    return null;
  }
}

export function isBlogPath(path: string): boolean {
  return /^\/(?:home\/web\/)?blog(?:\/|$)/.test(normalize(rawPath(path)));
}
