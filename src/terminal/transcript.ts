import {preload} from 'react-dom';
import {HOME} from '../paths';
import {decodeContactTokens} from '../contacts';
import {cleanOutput, type TerminalStore} from './store';
import type {OutputResult} from './messages';

export function preloadAboutPortrait(source: string) {
  if (source === HOME + '/ABOUT.md') {
    preload(HOME + '/portrait.png', {
      as: 'image',
      fetchPriority: 'high',
      referrerPolicy: 'no-referrer',
    });
  }
}

export function createTranscript(
  store: TerminalStore,
  getCwd: () => string,
  transcript: HTMLElement,
) {
  let historyEntry = 0;
  const historyPrefix = crypto.randomUUID();

  function commandBlock(command: string, at = getCwd()) {
    const previous = transcript.lastElementChild as HTMLElement | null;

    if (previous) {
      previous.style.containIntrinsicSize = `auto ${previous.getBoundingClientRect().height}px`;
    }

    const id = `command-${historyPrefix}-${++historyEntry}`;
    store.add({id, command, cwd: at, outputs: []});

    return document.getElementById(id)!;
  }

  function plain(block: HTMLElement, text: string, error = false) {
    if (text) {
      store.append(block.id, {kind: 'text', text: cleanOutput(text), error});
    }
  }

  function formatted(
    block: HTMLElement,
    text: string,
    source: string,
    force = false,
    error = false,
    style?: string,
  ) {
    const clean = decodeContactTokens(cleanOutput(text));

    if (!clean) {
      return;
    }

    if (force) {
      preloadAboutPortrait(source);
      store.append(block.id, {
        kind: 'article',
        text: clean,
        source,
        error,
        style,
      });
    } else {
      plain(block, clean, error);
    }
  }

  function downloadFiles(
    block: HTMLElement,
    files: {name: string; bytes: Uint8Array}[],
  ) {
    if (files.length) {
      store.append(block.id, {kind: 'downloads', files});
    }
  }

  function output(block: HTMLElement, result: OutputResult) {
    const fallbackSource =
      (result.cwd || getCwd()).replace(/\/$/, '') + '/.terminal-output.md';

    if (result.documents?.length) {
      for (const doc of result.documents) {
        formatted(block, doc.text, doc.path, true, false, doc.style);
      }
    } else {
      formatted(block, result.stdout, fallbackSource);
    }

    formatted(block, result.stderr, fallbackSource, false, true);

    for (const hook of result.renderCommands || []) {
      output(commandBlock(hook.command, result.cwd || getCwd()), hook.result);
    }
  }

  function pruneScrollback() {
    store.prune();
  }

  return {commandBlock, plain, output, downloadFiles, pruneScrollback};
}
