import type {ApplicationRequest} from '../executables';

export type DocumentOutput = {path: string; text: string; style?: string};

export type OutputResult = {
  documents?: DocumentOutput[];
  stdout: string;
  stderr: string;
  cwd?: string;
  renderCommands?: {command: string; result: OutputResult}[];
};

export type EditorFile = {path: string; text: string; isNew: boolean};

export type WorkerMessage =
  | {type: 'cwd'; cwd: string; error?: string}
  | {type: 'editor-saved'; id: number; error?: string}
  | {
      type: 'ready';
      cwd: string;
      startup: (OutputResult & {command: string})[];
      warning?: string;
    }
  | (OutputResult & {
      type: 'result';
      id: number;
      cwd: string;
      exitCode: number;
      warning?: string;
      editor?: EditorFile;
      application?: ApplicationRequest;
      downloads?: {name: string; bytes: Uint8Array}[];
    })
  | {type: 'completion'; id: number; line: string; choices: string[]}
  | {type: 'error'; message: string};
