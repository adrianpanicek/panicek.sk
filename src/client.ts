import { commandRanges, highlightCommand } from './highlight';
import { decodeContactTokens } from './contacts';
import { typeText } from './typing';
import { renderMarkdown, escapeHtml } from './markdown';
import { catCommand, displayCat, displayPath, HOME } from './paths';
import { resetState } from './storage';
import type { BaseFiles } from './filesystem';

const transcript = document.querySelector<HTMLElement>('#transcript')!;
const form = document.querySelector<HTMLFormElement>('#command-form')!;
const input = document.querySelector<HTMLTextAreaElement>('#command')!;
const highlight = document.querySelector<HTMLElement>('#input-highlight')!;
const prompt = document.querySelector<HTMLElement>('#cwd')!;
const status = document.querySelector<HTMLElement>('#status')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const shellControls = document.querySelector<HTMLElement>('#shell-controls')!;
let worker: Worker;
let ready = false;
let editing = false;
const editorSaves = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
let busy = false;
let cwd = HOME;
let sequence = 0;
let active: HTMLElement | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let initial = true;
let history: string[] = [];
let historyIndex = 0;
let draft = '';
let lastExit = 0;
let completionLine = '';
let typing: AbortController | undefined;

function paintInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 240) + 'px';
  paintHighlight();
}
function paintHighlight() {
  const value = input.value;
  const ranges = commandRanges(value);
  const caret = input.selectionStart;
  const segment = (start: number, end: number) => highlightCommand(value, ranges, start, end);
  const marker =
    input.selectionStart === input.selectionEnd
      ? '<span class="block-caret" aria-hidden="true"></span>'
      : '';
  highlight.innerHTML = segment(0, caret) + marker + segment(caret, value.length);
  highlight.scrollLeft = input.scrollLeft;
  highlight.scrollTop = input.scrollTop;
}

function setStatus(message: string, warning = false) {
  status.textContent = message;
  status.classList.toggle('warning', warning);
}
function availability() {
  input.disabled = !ready || busy || editing;
  input.readOnly = Boolean(typing);
  form.setAttribute('aria-busy', String(busy || typing));
  stop.hidden = !busy && !typing;
  prompt.textContent = displayPath(cwd);
  document.querySelector('#exit-status')!.textContent = lastExit ? `[${lastExit}] ` : '';
}
function commandBlock(command: string, at = cwd) {
  const block = document.createElement('section');
  block.className = 'entry';
  const line = document.createElement('div');
  line.className = 'prompt-line';
  line.innerHTML = `<span class="user">web</span>@<span class="host">panicek.sk</span> <span class="cwd">${escapeHtml(displayPath(at))}</span> $ ${highlightCommand(command)}`;
  block.append(line);
  transcript.append(block);
  return block;
}
function plain(block: HTMLElement, text: string, error = false) {
  if (!text) return;
  const pre = document.createElement('pre');
  pre.className = error ? 'output error' : 'output';
  // ANSI control sequences are not executable markup; strip them for the HTML transcript.
  pre.textContent = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(0, 1048576);
  block.append(pre);
}
function formatted(block: HTMLElement, text: string, source: string, force = false, error = false) {
  const clean = decodeContactTokens(text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(0, 1048576));
  if (!clean) return;
  if (force) {
    const article = document.createElement('article');
    article.className = error ? 'markdown error' : 'markdown';
    article.dataset.source = source;
    article.innerHTML = renderMarkdown(clean, source, location.origin);
    block.append(article);
  } else plain(block, clean, error);
}
function releaseDownloads(root: Element) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-download]'))
    URL.revokeObjectURL(link.href);
}
function downloadFiles(block: HTMLElement, files: { name: string; bytes: Uint8Array }[]) {
  if (!files.length) return;
  const list = document.createElement('div');
  list.className = 'downloads';
  for (const file of files) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([new Uint8Array(file.bytes)], { type: 'application/octet-stream' }),
    );
    link.download = file.name;
    link.dataset.download = '';
    link.textContent = `Download ${file.name}`;
    list.append(link);
  }
  block.append(list);
  for (const link of list.querySelectorAll<HTMLAnchorElement>('a')) link.click();
}
function output(
  block: HTMLElement,
  result: {
    documents?: { path: string; text: string }[];
    stdout: string;
    stderr: string;
    cwd?: string;
  },
) {
  const fallbackSource = (result.cwd || cwd).replace(/\/$/, '') + '/.terminal-output.md';
  if (result.documents?.length) {
    for (const doc of result.documents) formatted(block, doc.text, doc.path, true);
  } else formatted(block, result.stdout, fallbackSource);
  formatted(block, result.stderr, fallbackSource, false, true);
}
// Retain substantial scrollback without growing the DOM indefinitely.
// Large outputs remain a single text node; content-visibility skips offscreen layout.
function pruneScrollback() {
  const newest = transcript.lastElementChild;
  // Keep the tail of an oversized result rather than dropping the command itself.
  for (const node of newest?.querySelectorAll<HTMLElement>('.output') ?? []) {
    const lines = (node.textContent || '').split('\n');
    if (lines.length > 49990)
      node.textContent = '[Earlier lines trimmed]\n' + lines.slice(-49990).join('\n');
  }
  const entries = Array.from(transcript.children);
  let lines = 0,
    bytes = 0;
  let keepFrom = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const text = entries[i].textContent || '';
    lines += text.split('\n').length;
    bytes += text.length;
    if (
      i < entries.length - 1 &&
      (lines > 50000 || bytes > 8 * 1024 * 1024 || entries.length - i > 2000)
    ) {
      keepFrom = i + 1;
      break;
    }
  }
  if (keepFrom > 0) {
    for (const entry of entries.slice(0, keepFrom)) {
      releaseDownloads(entry);
      entry.remove();
    }
    const notice = document.createElement('p');
    notice.className = 'scrollback-note';
    notice.textContent = '[Older output trimmed: scrollback retains up to 50,000 lines / 8 MiB.]';
    transcript.prepend(notice);
  }
}
function scrollToPrompt() {
  form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
function boot() {
  ready = false;
  busy = false;
  availability();
  setStatus('Starting shell…');
  worker = new Worker('/assets/shell.worker.js', { type: 'module' });
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'editor-saved') {
      const pending = editorSaves.get(message.id);
      editorSaves.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error));
      else pending?.resolve();
      return;
    }
    if (message.type === 'ready') {
      ready = true;
      cwd = message.cwd;
      if (initial) {
        // Replace the build-time transcript only when the live startup commands finish.
        releaseDownloads(transcript);
        transcript.replaceChildren();
        for (const result of message.startup) output(commandBlock(result.command, HOME), result);
        initial = false;
      }
      setStatus(message.warning || 'web · files stay in this browser', Boolean(message.warning));
      availability();
      if (
        document.activeElement === document.body ||
        document.activeElement === input ||
        document.activeElement === stop
      )
        input.focus({ preventScroll: true });
    } else if (message.type === 'result') {
      clearTimeout(timeout);
      busy = false;
      cwd = message.cwd;
      lastExit = message.exitCode;
      if (active) {
        output(active, message);
        downloadFiles(active, message.downloads || []);
      }
      active = undefined;
      if (message.editor) void launchEditor(message.editor);
      pruneScrollback();
      setStatus(message.warning || 'web · files stay in this browser', Boolean(message.warning));
      availability();
      input.focus({ preventScroll: true });
      scrollToPrompt();
    } else if (message.type === 'completion') {
      if (input.value !== completionLine || busy || typing) return;
      input.value = message.line;
      if (message.choices.length > 1)
        plain(commandBlock(input.value), message.choices.join('  ') + '\n');
      paintInput();
    } else if (message.type === 'error') {
      clearTimeout(timeout);
      busy = false;
      setStatus(message.message, true);
      availability();
    }
  };
  worker.onerror = () => {
    for (const pending of editorSaves.values())
      pending.reject(
        new Error('Shell worker stopped. Keep or copy the editor buffer before reloading.'),
      );
    editorSaves.clear();
    clearTimeout(timeout);
    worker.terminate();
    busy = false;
    ready = false;
    availability();
    setStatus('Shell unavailable. You can still read the portfolio and open raw files.', true);
  };
  const startingWorker = worker;
  void fetch('/filesystem.json', { credentials: 'same-origin', priority: 'high' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Could not load portfolio files');
      const base: BaseFiles = await response.json();
      if (worker === startingWorker) startingWorker.postMessage({ type: 'init', base });
    })
    .catch(() => {
      if (worker !== startingWorker) return;
      startingWorker.terminate();
      setStatus('Could not load portfolio files. Reload to try again.', true);
    });
}
async function launchEditor(file: { path: string; text: string; isNew: boolean }) {
  editing = true;
  availability();
  try {
    const url = '/assets/vim.js';
    const module: typeof import('./vim') = await import(url);
    module.openEditor(
      file,
      (path, text) =>
        new Promise<void>((resolve, reject) => {
          if (!ready) {
            reject(
              new Error('Shell worker is unavailable. Keep or copy your buffer before reloading.'),
            );
            return;
          }
          const id = ++sequence;
          editorSaves.set(id, { resolve, reject });
          try {
            worker.postMessage({ type: 'editor-save', id, path, text });
          } catch (error) {
            editorSaves.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }),
      () => {
        editing = false;
        availability();
        input.focus({ preventScroll: true });
        scrollToPrompt();
      },
    );
  } catch (error) {
    editing = false;
    setStatus(`Could not open editor: ${String(error)}`, true);
    availability();
    input.focus({ preventScroll: true });
  }
}
function interrupt() {
  if (typing) {
    typing.abort();
    return;
  }
  if (!busy) return;
  clearTimeout(timeout);
  worker.terminate();
  if (active)
    plain(
      active,
      '^C\nStopped. Previously saved files are intact; unfinished changes may be lost.\n',
      true,
    );
  active = undefined;
  boot();
}
async function run(command: string, shown = command) {
  if (!ready || busy || typing || editing || !command.trim()) return;
  history.push(shown);
  history = history.slice(-200);
  historyIndex = history.length;
  input.value = '';
  paintInput();
  if (command.trim() === 'clear') {
    releaseDownloads(transcript);
    transcript.replaceChildren();
    lastExit = 0;
    availability();
    return;
  }
  if (command.trim() === 'reset') {
    if (!confirm('Delete your saved shell files and edits, and restore the published portfolio?'))
      return;
    busy = true;
    availability();
    try {
      await resetState();
      worker.terminate();
      initial = true;
      lastExit = 0;
      boot();
    } catch (error) {
      busy = false;
      setStatus(String(error), true);
      availability();
    }
    return;
  }
  active = commandBlock(shown);
  busy = true;
  availability();
  timeout = setTimeout(interrupt, 7000);
  worker.postMessage({ type: 'exec', command, id: ++sequence });
  scrollToPrompt();
}
async function animatedRun(command: string, shown = command) {
  if (!ready || busy || typing || editing) return;
  const previous = input.value;
  const controller = new AbortController();
  typing = controller;
  input.value = '';
  paintInput();
  availability();
  input.focus({ preventScroll: true });
  scrollToPrompt();
  const delay = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : Math.min(35, 1600 / Array.from(shown).length);
  const completed = await typeText(
    shown,
    (value) => {
      input.value = value;
      input.setSelectionRange(value.length, value.length);
      paintInput();
    },
    { delay, signal: controller.signal },
  );
  typing = undefined;
  availability();
  if (completed) await run(command, shown);
  else {
    input.value = previous;
    paintInput();
    input.focus({ preventScroll: true });
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(input.value);
});
input.addEventListener('input', paintInput);
input.addEventListener('select', paintHighlight);
input.addEventListener('keyup', paintHighlight);
input.addEventListener('click', paintHighlight);
document.addEventListener('selectionchange', () => {
  if (document.activeElement === input) paintHighlight();
});
input.addEventListener('scroll', () => {
  highlight.scrollLeft = input.scrollLeft;
  highlight.scrollTop = input.scrollTop;
});
input.addEventListener('keydown', (event) => {
  if (typing) {
    if (event.key === 'Escape') {
      event.preventDefault();
      interrupt();
    }
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void run(input.value);
  } else if (
    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
    !input.value.includes('\n')
  ) {
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(
      0,
      Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)),
    );
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    paintInput();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    completionLine = input.value;
    worker.postMessage({ type: 'complete', line: input.value, id: ++sequence });
  }
});
document.addEventListener('keydown', (event) => {
  if (editing) return;
  if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    if (busy || typing) {
      event.preventDefault();
      interrupt();
    } else if (document.activeElement === input) {
      event.preventDefault();
      input.value = '';
      paintInput();
    }
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'l' && document.activeElement === input) {
    event.preventDefault();
    void run('clear');
  }
});
document.addEventListener('click', (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[data-file]');
  if (
    !anchor ||
    !ready ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  if (!busy && !typing)
    void animatedRun(
      catCommand(anchor.dataset.file!) + ' | render',
      displayCat(anchor.dataset.file!) + ' | render',
    );
});
document.querySelector('.terminal')!.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (
    !ready ||
    busy ||
    typing ||
    window.getSelection()?.toString() ||
    target.closest('a, button, input, textarea, label')
  )
    return;
  input.focus({ preventScroll: true });
});
stop.addEventListener('click', interrupt);
document.querySelector('#help')!.addEventListener('click', () => void animatedRun('help'));
shellControls.hidden = false;
form.hidden = false;
paintInput();
boot();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
    setStatus(
      'Raw local-file URLs need service worker support. Published files remain available.',
      true,
    );
  });
}
