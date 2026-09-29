import type {Entry, Output} from './store';

const MAX_ENTRIES = 2000;
const MAX_LINES = 50000;
const MAX_CHARACTERS = 8 * 1024 * 1024;
const NEWEST_OUTPUT_LINES = 49990;

function trimTextOutput(output: Output): Output {
  if (output.kind !== 'text') {
    return output;
  }

  const lines = output.text.split('\n');

  if (lines.length <= NEWEST_OUTPUT_LINES) {
    return output;
  }

  return {
    ...output,
    text:
      '[Earlier lines trimmed]\n' +
      lines.slice(-NEWEST_OUTPUT_LINES).join('\n'),
  };
}

function trimNewestEntry(entries: Entry[]): Entry[] {
  return entries.map((entry, index) => {
    if (index !== entries.length - 1) {
      return entry;
    }

    return {...entry, outputs: entry.outputs.map(trimTextOutput)};
  });
}

function entryText(entry: Entry): string {
  return entry.outputs
    .map(output => (output.kind === 'downloads' ? '' : output.text))
    .join('\n');
}

export function pruneEntries(previousEntries: Entry[]) {
  const entries = trimNewestEntry(previousEntries);
  let lineCount = 0;
  let characterCount = 0;
  let keepFrom = 0;

  for (let index = entries.length - 1; index >= 0; index--) {
    const text = entryText(entries[index]);
    lineCount += text.split('\n').length;
    characterCount += text.length;

    const retainedCount = entries.length - index;

    const exceedsLimit =
      lineCount > MAX_LINES ||
      characterCount > MAX_CHARACTERS ||
      retainedCount > MAX_ENTRIES;

    // Always retain the newest entry, even if that result alone exceeds a limit.
    if (index < entries.length - 1 && exceedsLimit) {
      keepFrom = index + 1;
      break;
    }
  }

  return {entries: entries.slice(keepFrom), trimmed: keepFrom > 0};
}
