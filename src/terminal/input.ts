import type {TerminalStore} from './store';
import {scopedEvents} from './events';

type InputOptions = {
  input: HTMLTextAreaElement;
  highlight: HTMLElement;
  form: HTMLFormElement;
  signal: AbortSignal;
  store: TerminalStore;
  state(): {
    busy: boolean;
    typing: boolean;
    editing: boolean;
    interruptible: boolean;
  };
  run(command: string): Promise<void>;
  interrupt(): void;
  complete(line: string): void;
};

// Native textarea selection and IME stay intact; React renders its highlighted mirror.
export function setupCommandInput({
  input,
  highlight,
  form,
  signal,
  store,
  state,
  run,
  interrupt,
  complete,
}: InputOptions) {
  const listen = scopedEvents(signal);
  let history: string[] = [];
  let historyIndex = 0;
  let draft = '';

  function paintInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 240) + 'px';
    paintHighlight();
  }

  function paintHighlight() {
    store.update({
      input: input.value,
      caret: input.selectionStart,
      selection: input.selectionStart !== input.selectionEnd,
    });
    highlight.scrollLeft = input.scrollLeft;
    highlight.scrollTop = input.scrollTop;
  }

  listen(form, 'submit', event => {
    event.preventDefault();
    void run(input.value);
  });
  listen(input, 'input', paintInput);
  listen(input, 'beforeinput', event => {
    if (state().typing) {
      event.preventDefault();
    }
  });
  listen(input, 'select', paintHighlight);
  listen(input, 'keyup', paintHighlight);
  listen(input, 'click', paintHighlight);
  listen(document, 'selectionchange', () => {
    if (document.activeElement === input) {
      paintHighlight();
    }
  });
  listen(input, 'scroll', () => {
    highlight.scrollLeft = input.scrollLeft;
    highlight.scrollTop = input.scrollTop;
  });
  listen(input, 'keydown', event => {
    if (state().typing) {
      event.preventDefault();

      if (event.key === 'Escape') {
        event.preventDefault();
        interrupt();
      }

      return;
    }

    if (
      state().busy &&
      ['Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
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

      if (historyIndex === history.length) {
        draft = input.value;
      }

      historyIndex = Math.max(
        0,
        Math.min(
          history.length,
          historyIndex + (event.key === 'ArrowUp' ? -1 : 1),
        ),
      );
      input.value =
        historyIndex === history.length ? draft : history[historyIndex];
      paintInput();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      complete(input.value);
    }
  });
  listen(document, 'keydown', event => {
    if (state().editing || !state().interruptible) {
      return;
    }

    if (
      event.ctrlKey &&
      event.key.toLowerCase() === 'c' &&
      !window.getSelection()?.toString()
    ) {
      if (state().busy || state().typing) {
        event.preventDefault();
        interrupt();
      } else if (document.activeElement === input) {
        event.preventDefault();
        input.value = '';
        paintInput();
      }
    }

    if (
      event.ctrlKey &&
      event.key.toLowerCase() === 'l' &&
      document.activeElement === input
    ) {
      event.preventDefault();
      void run('clear');
    }
  });

  return {
    paintInput,

    remember(command: string) {
      history = [...history, command].slice(-200);
      historyIndex = history.length;
    },
  };
}
