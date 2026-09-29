import {expect, test} from 'bun:test';
import {createTerminalStore, type Entry} from '../src/terminal/store';

const entry = (id: string, text: string): Entry => ({
  id,
  cwd: '/home/web',
  outputs: [{id: 1, kind: 'text', text, error: false}],
});

function store(entries: Entry[]) {
  return createTerminalStore({
    entries,
    origin: 'https://panicek.sk',
    directory: false,
  });
}

test('scrollback keeps exactly 2000 entries and reports when older entries are removed', () => {
  const terminal = store(
    Array.from({length: 2001}, (_, index) => entry(String(index), 'output')),
  );
  terminal.prune();

  expect(terminal.getSnapshot().entries).toHaveLength(2000);
  expect(terminal.getSnapshot().entries[0].id).toBe('1');
  expect(terminal.getSnapshot().trimmed).toBe(true);

  terminal.clear();
  expect(terminal.getSnapshot().entries).toEqual([]);
  expect(terminal.getSnapshot().trimmed).toBe(false);
});

test('scrollback preserves the tail of the newest oversized output without mutating older snapshots', () => {
  const newest = entry('latest', 'old\n'.repeat(50000) + 'tail');
  const terminal = store([newest]);
  terminal.prune();

  const output = terminal.getSnapshot().entries[0].outputs[0];
  expect(output.kind).toBe('text');
  if (output.kind !== 'text') {
    throw new Error('Expected text output');
  }

  expect(output.text).toStartWith('[Earlier lines trimmed]\n');
  expect(output.text).toEndWith('tail');
  expect(output.text.split('\n')).toHaveLength(49991);
  expect(newest.outputs[0]).toEqual({
    id: 1,
    kind: 'text',
    text: 'old\n'.repeat(50000) + 'tail',
    error: false,
  });
});

test('streaming updates only the selected output and strips ANSI control sequences', () => {
  const terminal = store([{id: 'command', cwd: '/home/web', outputs: []}]);
  terminal.append('command', {kind: 'text', text: 'first', error: false});
  const outputId = terminal.append('command', {
    kind: 'text',
    text: '',
    error: true,
  });
  terminal.stream('command', outputId, '\u001b[31merror\u001b[0m');

  expect(terminal.getSnapshot().entries[0].outputs[0]).toMatchObject({
    text: 'first',
    error: false,
  });
  expect(terminal.getSnapshot().entries[0].outputs.at(-1)).toMatchObject({
    text: 'error',
    error: true,
  });
});
