import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Highlight} from './ui/highlight';
import {commandRanges} from './terminal/command-ranges';

export {commandRanges} from './terminal/command-ranges';

export function highlightCommand(
  line: string,
  ranges = commandRanges(line),
  start = 0,
  end = line.length,
) {
  return renderToStaticMarkup(
    createElement(Highlight, {line, ranges, start, end}),
  );
}
