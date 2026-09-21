import { expect, test } from 'bun:test';
import { commandRanges, highlightCommand } from '../src/highlight';

const commands = (line: string) =>
  commandRanges(line).map((range) => line.slice(range.start, range.end));

test('highlights commands throughout pipelines and command lists', () => {
  expect(commands('cat ABOUT.md|render && echo done; pwd || ls\nwhoami')).toEqual([
    'cat',
    'render',
    'echo',
    'pwd',
    'ls',
    'whoami',
  ]);
  expect(commands('A=1 B="two words" cat ABOUT.md | render')).toEqual(['cat', 'render']);
});

test('distinguishes redirection targets from programs and handles quoted operators', () => {
  expect(commands('> out.txt cat ABOUT.md 2>&1 | render >> rendered.txt')).toEqual([
    'cat',
    'render',
  ]);
  expect(commands('echo "a | b > c" \'x; y\' a\\|b | "render"')).toEqual(['echo', '"render"']);
  expect(commands('echo hi # | ignored\npwd')).toEqual(['echo', 'pwd']);
  expect(commands('cat ABOUT.md &>out.txt && render')).toEqual(['cat', 'render']);
});

test('handles incomplete input and safely highlights slices around a caret', () => {
  const line = 'cat ABOUT.md | render';
  const ranges = commandRanges(line);
  expect(highlightCommand(line, ranges, 16)).toContain('<span class="command-name">ender</span>');
  expect(commands('cat |')).toEqual(['cat']);
  expect(commands('echo "unfinished | render')).toEqual(['echo']);
  expect(highlightCommand('echo "<script>"')).not.toContain('<script>');
});
