import { escapeHtml } from './markdown';

type Range = { start: number; end: number };

export function commandRanges(line: string): Range[] {
  const ranges: Range[] = [];
  let command = true;
  let redirect = false;
  let offset = 0;
  while (offset < line.length) {
    const start = offset;
    const char = line[offset];
    if (char === '\n' || '|&;()'.includes(char)) {
      const operator =
        char === '\n' ? char : line.slice(offset).match(/^(?:&>>?|\|\||\|&|&&|[|&;()])/)![0];
      offset += operator.length;
      if (operator.startsWith('&>')) redirect = true;
      else {
        command = true;
        redirect = false;
      }
      continue;
    }
    if (/\s/.test(char)) {
      offset++;
      continue;
    }
    if (char === '#') {
      while (offset < line.length && line[offset] !== '\n') offset++;
      continue;
    }
    const redirection = line.slice(offset).match(/^(?:\d+)?(?:[<>]&|>\||>>?|<>|<<<?)/);
    if (redirection) {
      offset += redirection[0].length;
      redirect = true;
      continue;
    }
    let quote = '';
    while (offset < line.length) {
      const current = line[offset];
      if (current === '\\' && quote !== "'") {
        offset = Math.min(offset + 2, line.length);
        continue;
      }
      if (quote) {
        if (current === quote) quote = '';
        offset++;
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        offset++;
        continue;
      }
      if (/\s/.test(current) || '|&;()<>'.includes(current)) break;
      offset++;
    }
    const word = line.slice(start, offset);
    if (redirect) redirect = false;
    else if (command && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      ranges.push({ start, end: offset });
      command = false;
    }
  }
  return ranges;
}

export function highlightCommand(
  line: string,
  ranges = commandRanges(line),
  start = 0,
  end = line.length,
) {
  let html = '';
  let offset = start;
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) continue;
    const left = Math.max(range.start, start);
    const right = Math.min(range.end, end);
    if (left > offset)
      html += `<span class="argument">${escapeHtml(line.slice(offset, left))}</span>`;
    html += `<span class="command-name">${escapeHtml(line.slice(left, right))}</span>`;
    offset = right;
  }
  if (!html) html = '<span class="command-name"></span>';
  if (offset < end) html += `<span class="argument">${escapeHtml(line.slice(offset, end))}</span>`;
  return html;
}
