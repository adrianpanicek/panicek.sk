import { readEditorFile, saveEditorFile } from './editor-files';
import './browser-runtime';
import {
  createFilesystem,
  snapshot,
  overlayBetween,
  type BaseFiles,
  type Snapshot,
} from './filesystem';
import { loadState, commitState, type State } from './storage';
import { createShell } from './shell';
import { HOME, normalize, quote, rawPath, isBlogPath } from './paths';

let shell: ReturnType<typeof createShell>;
let baseline: Snapshot;
let state: State = { version: 1, revision: 0, overlay: {} };
let persistence = true;
let queue = Promise.resolve();
const send = (value: object) => postMessage(value);

async function init(base: BaseFiles, pathname = '/') {
  const publishedFs = await createFilesystem(base);
  await createShell(publishedFs).exec(':');
  baseline = await snapshot(publishedFs);
  let warning = '';
  try {
    state = await loadState();
  } catch (error) {
    persistence = false;
    warning = String(error);
  }
  let fs;
  try {
    fs = await createFilesystem(base, state.overlay, { baseline });
  } catch {
    fs = await createFilesystem(base, {}, { baseline });
    persistence = false;
    warning = 'Saved files could not be restored. Use reset to restore published files.';
  }
  shell = createShell(fs);
  if (isBlogPath(pathname)) await shell.exec('cd ~/blog');
  const startup = [];
  const commands =
    pathname === '/' || pathname === '/index.html'
      ? ['cat ABOUT.md | render', 'cat CONTACTS.md | render']
      : ['render ' + quote(rawPath(pathname))];
  for (const command of commands) {
    const result = await shell.exec(command);
    startup.push({ command, ...result });
  }
  send({ type: 'ready', cwd: shell.getCwd(), startup, warning });
}

async function execute(command: string, id: number) {
  let result;
  try {
    result = await shell.exec(command);
  } catch (error) {
    result = { stdout: '', stderr: String(error) + '\n', exitCode: 1, documents: [] };
  }
  let warning = '';
  try {
    const overlay = overlayBetween(baseline, await snapshot(shell.fs), state.overlay);
    if (JSON.stringify(overlay) !== JSON.stringify(state.overlay)) {
      if (!persistence)
        throw new Error(
          'Changes are only in memory. Browser storage is unavailable; use reset or reload to recover.',
        );
      state = await commitState(state.revision, overlay);
    }
  } catch (error) {
    warning = String(error);
  }
  let editor;
  if ('editorPath' in result && result.editorPath) {
    try {
      editor = await readEditorFile(shell.fs, result.editorPath);
    } catch (error) {
      result.stderr += `vim: ${String(error)}\n`;
      result.exitCode = 1;
    }
  }
  send({
    type: 'result',
    id,
    ...result,
    application: 'application' in result ? result.application : undefined,
    editor,
    cwd: shell.getCwd(),
    warning,
  });
}

async function complete(line: string, id: number) {
  const token = line.match(/(?:^|\s)([^\s]*)$/)?.[1] ?? '';
  // Quoted/escaped tokens require full shell parsing; leave them untouched.
  if (/["'\\$`]/.test(token)) {
    send({ type: 'completion', id, line, choices: [] });
    return;
  }
  const start = line.slice(0, line.length - token.length);
  const slash = token.lastIndexOf('/');
  const dirToken = slash < 0 ? '' : token.slice(0, slash + 1);
  const partial = token.slice(slash + 1);
  const dir = normalize(
    dirToken.startsWith('~/')
      ? HOME + dirToken.slice(1)
      : dirToken.startsWith('/')
        ? dirToken
        : shell.getCwd() + '/' + dirToken,
  );
  const choices: string[] = [];
  try {
    for (const name of (await shell.fs.readdir(dir)).sort()) {
      if (!name.startsWith(partial)) continue;
      const stat = await shell.fs.stat(dir + '/' + name).catch(() => null);
      choices.push(dirToken + name + (stat?.isDirectory ? '/' : ''));
    }
  } catch {}
  let completed = line;
  if (choices.length === 1) {
    let choice = choices[0];
    if (/[^\w~/.\-]/.test(choice))
      choice = quote(choice.startsWith('~/') ? HOME + choice.slice(1) : choice);
    completed = start + choice;
  }
  send({ type: 'completion', id, line: completed, choices });
}

self.onmessage = (event) => {
  const message = event.data;
  queue = queue
    .then(async () => {
      if (message.type === 'init') await init(message.base, message.pathname);
      else if (message.type === 'blog-directory') {
        const result = await shell.exec('cd ~/blog');
        send({ type: 'cwd', cwd: shell.getCwd(), error: result.stderr });
      } else if (message.type === 'exec') await execute(message.command, message.id);
      else if (message.type === 'editor-save') {
        try {
          if (!persistence) throw new Error('Browser storage is unavailable; file was not saved.');
          await saveEditorFile(shell.fs, message.path, message.text, async () => {
            state = await commitState(
              state.revision,
              overlayBetween(baseline, await snapshot(shell.fs), state.overlay),
            );
          });
          send({ type: 'editor-saved', id: message.id });
        } catch (error) {
          send({ type: 'editor-saved', id: message.id, error: String(error) });
        }
      } else if (message.type === 'complete') await complete(message.line, message.id);
    })
    .catch((error) => send({ type: 'error', message: String(error) }));
};
