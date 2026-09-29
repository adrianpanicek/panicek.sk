import {useEffect, useSyncExternalStore} from 'react';
import type {InitialPage, TerminalStore} from '../terminal/store';
import {EntryView} from './transcript';
import {CommandForm} from './command-form';
import {CrtPointer, DisplayControls, useDisplay} from './display';

export function App({
  store,
  initial,
  start,
}: {
  store: TerminalStore;
  initial: InitialPage;
  start?: () => () => void;
}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const display = useDisplay();

  useEffect(() => {
    // Start outside React's commit so the controller can synchronously publish
    // state before measuring/focusing the rendered prompt.
    let dispose: (() => void) | undefined;

    const timer = setTimeout(() => {
      dispose = start?.();
    }, 0);

    return () => {
      clearTimeout(timer);
      dispose?.();
    };
  }, [start]);

  return (
    <>
      <div className="crt-viewport">
        <div className="crt-screen" aria-hidden="true" />
        <main>
          <div className="terminal">
            <div id="transcript" aria-label="Terminal transcript">
              {state.trimmed && (
                <p className="scrollback-note">
                  [Older output trimmed: scrollback retains up to 50,000 lines /
                  8 MiB.]
                </p>
              )}
              {state.entries.map(entry => (
                <EntryView
                  key={entry.id}
                  entry={entry}
                  origin={
                    state.interactive ? window.location.origin : initial.origin
                  }
                  imageDimensions={initial.imageDimensions}
                />
              ))}
            </div>
            <CommandForm state={state} />
            <noscript>
              {initial.directory ? (
                'Enable JavaScript to browse this directory.'
              ) : (
                <p>
                  Read the files above or{' '}
                  <a href="/home/web/CAREER.md">open my career history</a>.
                  Enable JavaScript to explore the interactive shell.
                </p>
              )}
            </noscript>
          </div>
          <div id="scroll-space" aria-hidden="true" style={{flexShrink: 0}} />
          <div className="shell-status">
            <span
              id="status"
              role="status"
              className={state.warning ? 'warning' : 'sr-only'}
            >
              {state.status}
            </span>
            <button id="stop" type="button" hidden={!state.stop}>
              interrupt
            </button>
          </div>
          <footer>
            <a id="home-link" href={`${initial.origin}/`}>
              home
            </a>
            <div className="footer-controls">
              <span id="shell-controls" hidden={!state.interactive}>
                <button id="reset-filesystem" type="button">
                  reset filesystem
                </button>
              </span>
              <DisplayControls display={display} />
            </div>
          </footer>
        </main>
        <CrtPointer />
        <div id="application-root" />
      </div>
      <div className="crt-refresh-overlay" aria-hidden="true" />
    </>
  );
}
