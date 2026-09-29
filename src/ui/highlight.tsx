import {commandRanges} from '../terminal/command-ranges';

export function Highlight({
  line,
  ranges = commandRanges(line),
  start = 0,
  end = line.length,
}: {
  line: string;
  ranges?: ReturnType<typeof commandRanges>;
  start?: number;
  end?: number;
}) {
  const parts = [];
  let offset = start;

  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      continue;
    }

    const left = Math.max(range.start, start),
      right = Math.min(range.end, end);

    if (left > offset) {
      parts.push(
        <span key={`a${offset}`} className="argument">
          {line.slice(offset, left)}
        </span>,
      );
    }

    parts.push(
      <span key={`c${left}`} className="command-name">
        {line.slice(left, right)}
      </span>,
    );
    offset = right;
  }

  if (!parts.length) {
    parts.push(<span key="empty" className="command-name" />);
  }

  if (offset < end) {
    parts.push(
      <span key={`a${offset}`} className="argument">
        {line.slice(offset, end)}
      </span>,
    );
  }

  return <>{parts}</>;
}
