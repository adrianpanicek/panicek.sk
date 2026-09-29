import {mountPanel} from './ui/panel';
import {EditorState} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  lineNumbers,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import {history, defaultKeymap, historyKeymap} from '@codemirror/commands';
import {vim, Vim} from '@replit/codemirror-vim';

export function openEditor(
  file: {path: string; text: string; isNew: boolean},
  save: (path: string, text: string) => Promise<void>,
  onClose: () => void,
) {
  const panel = mountPanel(document.querySelector('#application-root')!);
  let title = file.path;
  let status =
    'i insert · Esc normal · :w save · :q quit · :q! discard · :wq save & quit';

  const render = () =>
    panel.render(
      <section
        id="vim-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Vim editor: ${file.path}`}
      >
        <div className="vim-title">{title}</div>
        <div className="vim-document" />
        <div className="vim-status" role="status">
          {status}
        </div>
      </section>,
    );

  const setStatus = (message: string) => {
    status = message;
    render();
  };

  render();
  const host = document.querySelector<HTMLElement>('.vim-document')!;
  document.querySelector('main')!.inert = true;
  let saved = file.text;
  let saving = false;
  let closed = false;

  const dirty = () => view.state.sliceDoc() !== saved;

  const updateTitle = () => {
    title = `${file.path}${dirty() ? ' [+]' : ''}${file.isNew ? ' [New File]' : ''}`;
    render();
  };

  const unload = (event: BeforeUnloadEvent) => {
    if (dirty() || saving) {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  window.addEventListener('beforeunload', unload);

  const close = (force = false) => {
    if (saving) {
      setStatus('Write in progress…');

      return;
    }

    if (dirty() && !force) {
      setStatus('E37: No write since last change (use :w or :q!)');

      return;
    }

    closed = true;
    window.removeEventListener('beforeunload', unload);
    queueMicrotask(() => {
      view.destroy();
      panel.dispose();
      document.querySelector('main')!.inert = false;
      onClose();
    });
  };

  const write = async (quit = false) => {
    if (saving || closed) {
      return;
    }

    saving = true;
    const text = view.state.sliceDoc();
    setStatus('Writing…');

    try {
      await save(file.path, text);
      saved = text;
      file.isNew = false;
      updateTitle();
      setStatus(`${file.path} written`);
      saving = false;

      if (quit) {
        close();
      }
    } catch (error) {
      saving = false;
      setStatus(`Write failed: ${String(error)}. Buffer remains open.`);
    }
  };

  const noArgs = (args = '') => {
    if (args.trim()) {
      setStatus(
        'This editor writes the current file only; open another path from the shell.',
      );

      return false;
    }

    return true;
  };

  Vim.defineEx('write', 'w', (_cm, params) => {
    if (noArgs(params.argString)) {
      void write();
    }
  });
  Vim.defineEx('quit', 'q', (_cm, params) => {
    if (params.argString?.trim() === '!') {
      close(true);
    } else if (noArgs(params.argString)) {
      close();
    }
  });
  Vim.defineEx('wq', 'wq', (_cm, params) => {
    if (noArgs(params.argString)) {
      void write(true);
    }
  });
  Vim.defineEx('xit', 'x', (_cm, params) => {
    if (noArgs(params.argString)) {
      if (dirty() || file.isNew) {
        void write(true);
      } else {
        close();
      }
    }
  });

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: file.text,
      extensions: [
        ...(file.text.includes('\r\n')
          ? [EditorState.lineSeparator.of('\r\n')]
          : []),
        vim({status: true}),
        history(),
        drawSelection({cursorBlinkRate: 0}),
        lineNumbers(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({'aria-label': 'Vim file contents'}),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            updateTitle();
          }
        }),
        EditorView.theme(
          {
            '&': {
              height: '100%',
              backgroundColor: 'var(--bg)',
              color: 'var(--text)',
            },
            '.cm-scroller': {
              fontFamily: '"Ubuntu Mono", monospace',
              fontSize: '16px',
              lineHeight: '1',
              overflow: 'auto',
            },
            '.cm-content': {padding: '4px 0'},
            '.cm-gutters': {
              backgroundColor: 'var(--bg)',
              color: 'var(--muted)',
              border: 'none',
            },
            '.cm-activeLine': {backgroundColor: 'var(--surface)'},
            '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--bright)'},
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              backgroundColor: 'var(--selection)',
            },
            '.cm-panels': {
              backgroundColor: 'var(--surface)',
              color: 'var(--text)',
            },
          },
          {dark: true},
        ),
      ],
    }),
  });

  updateTitle();
  view.focus();
}
