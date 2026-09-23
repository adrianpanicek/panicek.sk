import { setupCrt } from './crt';
import { setupCrtImages } from './crt-image';
import { countVisitor } from './visitors';
import { commandRanges, highlightCommand } from './highlight';
import { decodeContactTokens } from './contacts';
import { animationsEnabled, setupAnimations } from './animations';
import { typeText } from './typing';
import { createAutoScroll } from './auto-scroll';
import { renderMarkdown, escapeHtml } from './markdown';
import { catCommand, displayCat, displayPath, HOME, isBlogPath } from './paths';
import { resetState } from './storage';
import type { BaseFiles } from './filesystem';
import { createApplicationController } from './applications';

setupAnimations();
setupCrt();
setupCrtImages(document);
void countVisitor();

const transcript = document.querySelector<HTMLElement>('#transcript')!;
const form = document.querySelector<HTMLFormElement>('#command-form')!;
const input = document.querySelector<HTMLTextAreaElement>('#command')!;
const highlight = document.querySelector<HTMLElement>('#input-highlight')!;
const prompt = document.querySelector<HTMLElement>('#cwd')!;
const status = document.querySelector<HTMLElement>('#status')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const resetFilesystemButton = document.querySelector<HTMLButtonElement>('#reset-filesystem')!;
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
let navigation = false;
let historyEntry = 0;
const historyPrefix = crypto.randomUUID();
let historyTarget: HTMLElement | undefined;
const autoScroll = createAutoScroll();
const scrollSpace = document.createElement('div');
scrollSpace.setAttribute('aria-hidden', 'true');
scrollSpace.style.flexShrink = '0';
document.querySelector('.shell-status')!.before(scrollSpace);
let history: string[] = [];
let historyIndex = 0;
let draft = '';
let lastExit = 0;
let completionLine = '';
let typing: AbortController | undefined;
const applications = createApplicationController({
  environment: () => ({
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    finePointer: matchMedia('(pointer: fine)').matches,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    webAssembly: typeof WebAssembly === 'object',
  }),
  onStateChange: (state) => {
    busy = state !== 'idle';
    availability();
  },
  onComplete: (exitCode) => {
    lastExit = exitCode;
    availability();
    input.focus({ preventScroll: true });
    scrollToPrompt();
  },
});

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
  status.classList.toggle('sr-only', !warning);
}
function availability() {
  input.disabled = !ready || editing || applications.state !== 'idle';
  form.setAttribute('aria-busy', String(Boolean(busy || typing)));
  stop.hidden =
    (applications.state !== 'idle' && !applications.interruptible) || (!busy && !typing);
  prompt.textContent = displayPath(cwd);
  document.querySelector('#exit-status')!.textContent = lastExit ? `[${lastExit}] ` : '';
}
function commandBlock(command: string, at = cwd) {
  const previous = transcript.lastElementChild as HTMLElement | null;
  if (previous)
    previous.style.containIntrinsicSize = `auto ${previous.getBoundingClientRect().height}px`;
  const block = document.createElement('section');
  block.className = 'entry';
  block.id = `command-${historyPrefix}-${++historyEntry}`;
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
    setupCrtImages(article);
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
type OutputResult = {
  documents?: { path: string; text: string }[];
  stdout: string;
  stderr: string;
  cwd?: string;
  renderCommands?: { command: string; result: OutputResult }[];
};
function output(block: HTMLElement, result: OutputResult) {
  const fallbackSource = (result.cwd || cwd).replace(/\/$/, '') + '/.terminal-output.md';
  if (result.documents?.length) {
    for (const doc of result.documents) formatted(block, doc.text, doc.path, true);
  } else formatted(block, result.stdout, fallbackSource);
  formatted(block, result.stderr, fallbackSource, false, true);
  for (const hook of result.renderCommands || [])
    output(commandBlock(hook.command, result.cwd || cwd), hook.result);
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
function revealShell() {
  delete document.documentElement.dataset.shellBoot;
}
function anchorPrompt(node: HTMLElement, animate = true) {
  const main = document.querySelector('main')!;
  const inset = Math.max(8, parseFloat(getComputedStyle(main).paddingTop) || 0);
  const footerSpace =
    document.querySelector('footer')!.getBoundingClientRect().bottom -
    scrollSpace.getBoundingClientRect().bottom;
  // Keep the prompt beside its output and reserve the bottom of the viewport for the footer.
  scrollSpace.style.height = `${Math.max(
    0,
    innerHeight -
      inset * 2 -
      footerSpace -
      (parseFloat(getComputedStyle(form).marginBottom) || 0) -
      (form.getBoundingClientRect().bottom - node.getBoundingClientRect().top),
  )}px`;
  if (animate) autoScroll.move(node, inset);
  else autoScroll.retarget(node);
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
  worker.onmessage = async (event) => {
    const message = event.data;
    if (message.type === 'cwd') {
      cwd = message.cwd;
      if (message.error) setStatus(message.error, true);
      availability();
      return;
    }
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
        // Keep static content available until the shell can replay its startup.
        releaseDownloads(transcript);
        transcript.replaceChildren();
        initial = false;
        revealShell();
        for (const result of message.startup) {
          const shown =
            result.documents?.length === 1
              ? displayCat(result.documents[0].path) + ' | render'
              : result.command;
          if (!(await typeCommand(shown, false))) break;
          input.value = '';
          paintInput();
          const block = commandBlock(shown, result.cwd || cwd);
          output(block, result);
        }
        if (transcript.firstElementChild)
          window.history.replaceState({ terminalEntry: transcript.firstElementChild.id }, '');
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
      const block = active;
      if (block) {
        output(block, message);
        downloadFiles(block, message.downloads || []);
      }
      active = undefined;
      if (message.editor) void launchEditor(message.editor);
      pruneScrollback();
      setStatus(message.warning || 'web · files stay in this browser', Boolean(message.warning));
      let programOutput: HTMLPreElement | undefined;
      let programError = false;
      if (message.application)
        void applications.launch(
          message.application,
          (error) => {
            if (block) plain(block, error + '\n', true);
            lastExit = 1;
            busy = false;
          },
          (text, error) => {
            if (block && text) {
              if (!programOutput || programError !== error) {
                programOutput = document.createElement('pre');
                programOutput.className = error ? 'output error' : 'output';
                block.append(programOutput);
                programError = error;
              }
              const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
              if (programOutput.firstChild instanceof Text)
                programOutput.firstChild.appendData(clean);
              else programOutput.textContent = clean;
              pruneScrollback();
            }
          },
        );
      availability();
      input.focus({ preventScroll: true });
      if (historyTarget) {
        anchorPrompt(historyTarget);
        historyTarget = undefined;
      } else if (navigation && block) anchorPrompt(block, false);
      else scrollToPrompt();
      navigation = false;
    } else if (message.type === 'completion') {
      if (input.value !== completionLine || busy || typing) return;
      input.value = message.line;
      if (message.choices.length > 1)
        plain(commandBlock(input.value), message.choices.join('  ') + '\n');
      paintInput();
    } else if (message.type === 'error') {
      if (initial) revealShell();
      clearTimeout(timeout);
      busy = false;
      setStatus(message.message, true);
      availability();
    }
  };
  worker.onerror = () => {
    revealShell();
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
      if (worker === startingWorker)
        startingWorker.postMessage({ type: 'init', base, pathname: location.pathname });
    })
    .catch(() => {
      if (worker !== startingWorker) return;
      startingWorker.terminate();
      revealShell();
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
  if (applications.state !== 'idle') {
    applications.interrupt();
    return;
  }
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
async function run(command: string, shown = command, navigate = false) {
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
    await resetFilesystem();
    return;
  }
  navigation = navigate;
  active = commandBlock(shown);
  busy = true;
  availability();
  timeout = setTimeout(interrupt, 7000);
  worker.postMessage({ type: 'exec', command, id: ++sequence });
  if (navigate) anchorPrompt(active, false);
  else scrollToPrompt();
}
async function resetFilesystem() {
  if (!ready || busy || typing || editing) return;
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
}
async function typeCommand(shown: string, navigate = true) {
  if (navigate) autoScroll.begin();
  const previous = input.value;
  const controller = new AbortController();
  typing = controller;
  input.value = '';
  paintInput();
  availability();
  input.focus({ preventScroll: true });
  if (navigate) anchorPrompt(form);
  const delay = !animationsEnabled() ? 0 : Math.min(35, 1600 / Array.from(shown).length);
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
  if (!completed) {
    availability();
    input.value = previous;
    paintInput();
    input.focus({ preventScroll: true });
  }
  return completed;
}
async function animatedRun(command: string, shown = command, url?: string) {
  if (!ready || busy || typing || editing) return;
  if (await typeCommand(shown)) {
    await run(command, shown, true);
    if (url && active) window.history.pushState({ terminalEntry: active.id }, '', url);
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(input.value);
});
input.addEventListener('input', paintInput);
input.addEventListener('beforeinput', (event) => {
  if (typing) event.preventDefault();
});
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
    event.preventDefault();
    if (event.key === 'Escape') {
      event.preventDefault();
      interrupt();
    }
    return;
  }
  if (busy && ['Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
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
  if (editing || (applications.state !== 'idle' && !applications.interruptible)) return;
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
  if (!busy && !typing) {
    if (isBlogPath(anchor.dataset.file!)) worker.postMessage({ type: 'blog-directory' });
    void animatedRun(
      catCommand(anchor.dataset.file!) + ' | render',
      displayCat(anchor.dataset.file!) + ' | render',
      new URL(anchor.href).pathname.startsWith('/blog/') ? anchor.href : undefined,
    );
  }
});
window.history.scrollRestoration = 'manual';
window.addEventListener('popstate', (event) => {
  if (isBlogPath(location.pathname)) worker.postMessage({ type: 'blog-directory' });
  const target = document.getElementById(event.state?.terminalEntry);
  if (!target) {
    // A reloaded page or trimmed scrollback has no retained entry to restore.
    location.reload();
    return;
  }
  if (typing) typing.abort();
  autoScroll.begin();
  if (busy) historyTarget = target;
  else anchorPrompt(target);
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
resetFilesystemButton.addEventListener('click', () => void resetFilesystem());
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
