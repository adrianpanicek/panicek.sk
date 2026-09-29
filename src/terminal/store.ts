import {flushSync} from 'react-dom';
import {HOME} from '../paths';
import {pruneEntries} from './scrollback';
import type {ImageDimensions} from '../markdown/tokens';

type OutputDraft =
  | {kind: 'text'; text: string; error: boolean}
  | {
      kind: 'article';
      text: string;
      source: string;
      style?: string;
      error?: boolean;
    }
  | {kind: 'downloads'; files: {name: string; bytes: Uint8Array}[]};

export type Output = OutputDraft & {id: number};

export type Entry = {
  id: string;
  command?: string;
  cwd: string;
  outputs: Output[];
};

export type TerminalState = {
  entries: Entry[];
  trimmed: boolean;
  cwd: string;
  enabled: boolean;
  busy: boolean;
  stop: boolean;
  interactive: boolean;
  exitCode: number;
  status: string;
  warning: boolean;
  input: string;
  caret: number;
  selection: boolean;
};

export type InitialPage = {
  imageDimensions?: ImageDimensions;
  entries: Entry[];
  origin: string;
  directory: boolean;
};

export const cleanOutput = (text: string) =>
  text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(0, 1048576);

export function createTerminalStore(initial: InitialPage) {
  let state: TerminalState = {
    entries: initial.entries,
    trimmed: false,
    cwd: HOME,
    enabled: false,
    busy: false,
    stop: false,
    interactive: false,
    exitCode: 0,
    status: 'Personal portfolio · plain files, open to explore',
    warning: false,
    input: '',
    caret: 0,
    selection: false,
  };

  const listeners = new Set<() => void>();
  let outputId = 0;

  const update = (patch: Partial<TerminalState>) => {
    state = {...state, ...patch};
    flushSync(() => {
      for (const listener of listeners) {
        listener();
      }
    });
  };

  const changeEntry = (id: string, change: (entry: Entry) => Entry) =>
    update({
      entries: state.entries.map(entry =>
        entry.id === id ? change(entry) : entry,
      ),
    });

  return {
    getSnapshot: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    update,

    clear: () => update({entries: [], trimmed: false}),

    add(entry: Entry) {
      update({entries: [...state.entries, entry]});
    },

    append(id: string, output: OutputDraft) {
      const next: Output = {...output, id: ++outputId};
      changeEntry(id, entry => ({...entry, outputs: [...entry.outputs, next]}));

      return next.id;
    },

    stream(id: string, outputId: number, text: string) {
      changeEntry(id, entry => ({
        ...entry,
        outputs: entry.outputs.map(output =>
          output.id === outputId && output.kind === 'text'
            ? {...output, text: output.text + cleanOutput(text)}
            : output,
        ),
      }));
    },

    prune() {
      const result = pruneEntries(state.entries);

      update({
        entries: result.entries,
        trimmed: state.trimmed || result.trimmed,
      });
    },
  };
}

export type TerminalStore = ReturnType<typeof createTerminalStore>;
