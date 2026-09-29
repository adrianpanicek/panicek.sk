import type {WorkerMessage} from './messages';
import {scopedEvents} from './events';
import {setupCommandInput} from './input';
import {animationsEnabled} from '../animations';
import {typeText} from '../typing';
import {createAutoScroll} from '../auto-scroll';
import {catCommand, displayCat, HOME, isBlogPath} from '../paths';
import {resetState} from '../storage';
import type {BaseFiles} from '../filesystem';
import {createApplicationController} from '../applications';
import type {TerminalStore} from './store';
import {createTranscript, preloadAboutPortrait} from './transcript';

export function startTerminal(store: TerminalStore) {
  const events = new AbortController();
  const listen = scopedEvents(events.signal);
  const transcript = document.querySelector<HTMLElement>('#transcript')!;
  const form = document.querySelector<HTMLFormElement>('#command-form')!;
  const input = document.querySelector<HTMLTextAreaElement>('#command')!;
  const highlight = document.querySelector<HTMLElement>('#input-highlight')!;
  const stop = document.querySelector<HTMLButtonElement>('#stop')!;
  const resetFilesystemButton =
    document.querySelector<HTMLButtonElement>('#reset-filesystem')!;

  let worker: Worker;
  let ready = false;
  let editing = false;

  const editorSaves = new Map<
    number,
    {resolve: () => void; reject: (error: Error) => void}
  >();

  let busy = false;
  let cwd = HOME;
  let sequence = 0;
  let active: HTMLElement | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  let initial = true;
  let navigation = false;

  let historyPath = location.pathname;
  let historyTarget: HTMLElement | undefined;

  const autoScroll = createAutoScroll();
  const scrollSpace = document.querySelector<HTMLElement>('#scroll-space')!;

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

    onStateChange: state => {
      busy = state !== 'idle';
      availability();
    },

    onComplete: exitCode => {
      lastExit = exitCode;
      availability();
      input.focus({preventScroll: true});
      scrollToPrompt();
    },
  });

  const commandInput = setupCommandInput({
    input,
    highlight,
    form,
    signal: events.signal,
    store,

    state: () => ({
      busy,
      typing: Boolean(typing),
      editing,
      interruptible:
        applications.state === 'idle' || applications.interruptible,
    }),

    run,
    interrupt,

    complete(line) {
      completionLine = line;
      worker.postMessage({type: 'complete', line, id: ++sequence});
    },
  });

  const {paintInput} = commandInput;

  function setStatus(message: string, warning = false) {
    store.update({status: message, warning});
  }

  function availability() {
    store.update({
      enabled: ready && !editing && applications.state === 'idle',
      busy: Boolean(!ready || busy || typing),
      stop: !(
        (applications.state !== 'idle' && !applications.interruptible) ||
        (!busy && !typing)
      ),
      cwd,
      exitCode: lastExit,
    });
  }

  const {commandBlock, plain, output, downloadFiles, pruneScrollback} =
    createTranscript(store, () => cwd, transcript);

  function revealShell() {
    delete document.documentElement.dataset.shellBoot;
  }

  function anchorPrompt(node: HTMLElement, animate = true) {
    const main = document.querySelector('main')!;
    const inset = Math.max(
      8,
      parseFloat(getComputedStyle(main).paddingTop) || 0,
    );

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
        (form.getBoundingClientRect().bottom -
          node.getBoundingClientRect().top),
    )}px`;

    if (animate) {
      autoScroll.move(node, inset);
    } else {
      autoScroll.retarget(node);
    }
  }

  function scrollToPrompt() {
    form.scrollIntoView({block: 'nearest', behavior: 'instant'});
  }

  function boot() {
    ready = false;
    busy = false;
    availability();
    setStatus('Starting shell…');
    worker = new Worker('/assets/shell.worker.js', {type: 'module'});
    worker.onmessage = async event => {
      const message = event.data as WorkerMessage;

      if (message.type === 'cwd') {
        cwd = message.cwd;

        if (message.error) {
          setStatus(message.error, true);
        }

        availability();

        return;
      }

      if (message.type === 'editor-saved') {
        const pending = editorSaves.get(message.id);
        editorSaves.delete(message.id);

        if (message.error) {
          pending?.reject(new Error(message.error));
        } else {
          pending?.resolve();
        }

        return;
      }

      if (message.type === 'ready') {
        ready = true;
        cwd = message.cwd;

        if (initial) {
          // Keep static content available until the shell can replay its startup.
          store.clear();
          initial = false;
          revealShell();

          for (const result of message.startup) {
            const shown =
              result.documents?.length === 1
                ? displayCat(result.documents[0].path) + ' | render'
                : result.command;

            if (!(await typeCommand(shown, false))) {
              break;
            }

            input.value = '';
            paintInput();
            const block = commandBlock(shown, result.cwd || cwd);
            output(block, result);
          }

          if (transcript.firstElementChild) {
            window.history.replaceState(
              {terminalEntry: transcript.firstElementChild.id},
              '',
            );
          }
        }

        setStatus(
          message.warning || 'web · files stay in this browser',
          Boolean(message.warning),
        );
        availability();

        if (
          document.activeElement === document.body ||
          document.activeElement === input ||
          document.activeElement === stop
        ) {
          input.focus({preventScroll: true});
        }
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

        if (message.editor) {
          void launchEditor(message.editor);
        }

        pruneScrollback();
        setStatus(
          message.warning || 'web · files stay in this browser',
          Boolean(message.warning),
        );
        let programOutput: number | undefined;
        let programError = false;

        if (message.application) {
          void applications.launch(
            message.application,
            error => {
              if (block) {
                plain(block, error + '\n', true);
              }

              lastExit = 1;
              busy = false;
            },
            (text, error) => {
              if (block && text) {
                if (!programOutput || programError !== error) {
                  programOutput = store.append(block.id, {
                    kind: 'text',
                    text: '',
                    error,
                  });
                  programError = error;
                }

                store.stream(block.id, programOutput, text);
                pruneScrollback();
              }
            },
          );
        }

        availability();
        input.focus({preventScroll: true});

        if (historyTarget) {
          anchorPrompt(historyTarget);
          historyTarget = undefined;
        } else if (navigation && block) {
          anchorPrompt(block, false);
        } else {
          scrollToPrompt();
        }

        navigation = false;
      } else if (message.type === 'completion') {
        if (input.value !== completionLine || busy || typing) {
          return;
        }

        input.value = message.line;

        if (message.choices.length > 1) {
          plain(commandBlock(input.value), message.choices.join('  ') + '\n');
        }

        paintInput();
      } else if (message.type === 'error') {
        if (initial) {
          revealShell();
        }

        clearTimeout(timeout);
        busy = false;
        setStatus(message.message, true);
        availability();
      }
    };
    worker.onerror = () => {
      revealShell();

      for (const pending of editorSaves.values()) {
        pending.reject(
          new Error(
            'Shell worker stopped. Keep or copy the editor buffer before reloading.',
          ),
        );
      }

      editorSaves.clear();
      clearTimeout(timeout);
      worker.terminate();
      busy = false;
      ready = false;
      availability();
      setStatus(
        'Shell unavailable. You can still read the portfolio and open raw files.',
        true,
      );
    };
    const startingWorker = worker;
    void fetch('/filesystem.json', {
      credentials: 'same-origin',
      priority: 'high',
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error('Could not load portfolio files');
        }

        const base: BaseFiles = await response.json();

        if (worker === startingWorker) {
          startingWorker.postMessage({
            type: 'init',
            base,
            pathname: location.pathname,
          });
        }
      })
      .catch(() => {
        if (worker !== startingWorker) {
          return;
        }

        startingWorker.terminate();
        revealShell();
        setStatus('Could not load portfolio files. Reload to try again.', true);
      });
  }

  async function launchEditor(file: {
    path: string;
    text: string;
    isNew: boolean;
  }) {
    editing = true;
    availability();

    try {
      const url = '/assets/vim.js';
      const module: typeof import('../vim') = await import(url);
      module.openEditor(
        file,
        (path, text) =>
          new Promise<void>((resolve, reject) => {
            if (!ready) {
              reject(
                new Error(
                  'Shell worker is unavailable. Keep or copy your buffer before reloading.',
                ),
              );

              return;
            }

            const id = ++sequence;
            editorSaves.set(id, {resolve, reject});

            try {
              worker.postMessage({type: 'editor-save', id, path, text});
            } catch (error) {
              editorSaves.delete(id);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          }),
        () => {
          editing = false;
          availability();
          input.focus({preventScroll: true});
          scrollToPrompt();
        },
      );
    } catch (error) {
      editing = false;
      setStatus(`Could not open editor: ${String(error)}`, true);
      availability();
      input.focus({preventScroll: true});
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

    if (!busy) {
      return;
    }

    clearTimeout(timeout);
    worker.terminate();

    if (active) {
      plain(
        active,
        '^C\nStopped. Previously saved files are intact; unfinished changes may be lost.\n',
        true,
      );
    }

    active = undefined;
    boot();
  }

  async function run(command: string, shown = command, navigate = false) {
    if (!ready || busy || typing || editing || !command.trim()) {
      return;
    }

    commandInput.remember(shown);
    input.value = '';
    paintInput();

    if (command.trim() === 'clear') {
      store.clear();
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
    worker.postMessage({type: 'exec', command, id: ++sequence});

    if (navigate) {
      anchorPrompt(active, false);
    } else {
      scrollToPrompt();
    }
  }

  async function resetFilesystem() {
    if (!ready || busy || typing || editing) {
      return;
    }

    if (
      !confirm(
        'Delete your saved shell files and edits, and restore the published portfolio?',
      )
    ) {
      return;
    }

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
    if (navigate) {
      autoScroll.begin();
    }

    const previous = input.value;
    const controller = new AbortController();
    typing = controller;
    input.value = '';
    paintInput();
    availability();
    input.focus({preventScroll: true});

    if (navigate) {
      anchorPrompt(form);
    }

    const delay = !animationsEnabled()
      ? 0
      : Math.min(35, 1600 / Array.from(shown).length);

    const completed = await typeText(
      shown,
      value => {
        input.value = value;
        input.setSelectionRange(value.length, value.length);
        paintInput();
      },
      {delay, signal: controller.signal},
    );

    typing = undefined;

    if (!completed) {
      availability();
      input.value = previous;
      paintInput();
      input.focus({preventScroll: true});
    }

    return completed;
  }

  async function animatedRun(command: string, shown = command, url?: string) {
    if (!ready || busy || typing || editing) {
      return;
    }

    if (await typeCommand(shown)) {
      await run(command, shown, true);

      if (url && active) {
        window.history.pushState({terminalEntry: active.id}, '', url);
        historyPath = location.pathname;
      }
    }
  }

  listen(document, 'click', event => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>(
      'a[data-file]',
    );

    if (
      !anchor ||
      !ready ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    if (!busy && !typing) {
      preloadAboutPortrait(anchor.dataset.file!);

      if (isBlogPath(anchor.dataset.file!)) {
        worker.postMessage({type: 'blog-directory'});
      }

      void animatedRun(
        catCommand(anchor.dataset.file!) + ' | render',
        displayCat(anchor.dataset.file!) + ' | render',
        new URL(anchor.href).pathname.startsWith('/blog/')
          ? anchor.href
          : undefined,
      );
    }
  });
  window.history.scrollRestoration = 'manual';
  listen(window, 'popstate', event => {
    const changedPath = historyPath !== location.pathname;
    historyPath = location.pathname;

    // Hash-only history belongs to the current document or embedded application.
    if (!changedPath && !event.state?.terminalEntry) {
      return;
    }

    if (isBlogPath(location.pathname)) {
      worker.postMessage({type: 'blog-directory'});
    }

    const target = document.getElementById(event.state?.terminalEntry);

    if (!target) {
      // A reloaded page or trimmed scrollback has no retained entry to restore.
      location.reload();

      return;
    }

    if (typing) {
      typing.abort();
    }

    autoScroll.begin();

    if (busy) {
      historyTarget = target;
    } else {
      anchorPrompt(target);
    }
  });
  listen(document.querySelector('.terminal')!, 'click', event => {
    const target = event.target as Element;

    if (
      !ready ||
      busy ||
      typing ||
      window.getSelection()?.toString() ||
      target.closest('a, button, input, textarea, label')
    ) {
      return;
    }

    input.focus({preventScroll: true});
  });
  listen(stop, 'click', interrupt);
  listen(resetFilesystemButton, 'click', () => void resetFilesystem());
  store.update({interactive: true});
  paintInput();
  boot();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service-worker.js', {scope: '/'})
      .catch(() => {
        setStatus(
          'Raw local-file URLs need service worker support. Published files remain available.',
          true,
        );
      });
  }

  return () => {
    events.abort();
    typing?.abort();
    clearTimeout(timeout);
    worker?.terminate();
    autoScroll.dispose();
  };
}
