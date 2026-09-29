export function youtubeId(href: string): string | null {
  try {
    const url = new URL(href);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    if (url.username || url.password || url.port) {
      return null;
    }

    const host = url.hostname;
    let id: string | null = null;

    if (host === 'youtu.be') {
      id = url.pathname.slice(1);
    } else if (
      [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'www.youtube-nocookie.com',
      ].includes(host)
    ) {
      if (url.pathname === '/watch') {
        id = url.searchParams.get('v');
      } else {
        id =
          url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)$/)?.[1] ?? null;
      }
    }

    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function withinMarkdownBudget(text: string): boolean {
  if (text.length > 32768) {
    return false;
  }

  let lines = 1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n' && ++lines > 300) {
      return false;
    }
  }

  return true;
}
