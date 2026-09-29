import {mountPanel} from '../ui/panel';
import {
  createDoomCompositor,
  fitFourByThree,
  type DoomCompositor,
} from './compositor';
import {startDoom, type DoomProgress, type DoomSession} from './runtime';

type LaunchOptions = {
  onStateChange(state: 'loading' | 'running' | 'failed'): void;
  onExit(): void;
  onFailure(error: Error): void;
};

function bytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export async function launchDoom(options: LaunchOptions): Promise<void> {
  const html = document.documentElement;
  const viewport = document.querySelector<HTMLElement>('.crt-viewport')!;
  const terminal = document.querySelector<HTMLElement>('main')!;
  const wasHidden = terminal.hidden;
  const wasInert = terminal.inert;
  const scroll = {main: terminal.scrollTop, window: window.scrollY};
  const panel = mountPanel(document.querySelector('#application-root')!);
  let message = '';
  let canvasHidden = true;
  let statusHidden = false;
  let failure: Error | undefined;
  let phase: 'loading' | 'running' | 'failed' = 'loading';

  const render = () =>
    panel.render(
      <section
        id="doom-game"
        tabIndex={-1}
        aria-label="DOOM"
        data-doom-state={phase}
      >
        <canvas
          tabIndex={0}
          aria-label="DOOM game. Use the in-game menu to quit."
          hidden={canvasHidden}
        />
        <p role="status" hidden={statusHidden}>
          {message}
        </p>
        {failure && (
          <div className="doom-actions">
            <button
              type="button"
              onClick={() => {
                failure = undefined;
                void start();
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                const error = failure!;
                cleanup();
                options.onFailure(error);
              }}
            >
              Return to terminal
            </button>
          </div>
        )}
      </section>,
    );

  render();
  const root = document.querySelector<HTMLElement>('#doom-game')!;
  const canvas = root.querySelector('canvas')!;
  terminal.hidden = terminal.inert = true;
  html.dataset.application = 'doom';
  let compositor: DoomCompositor | undefined;
  let runtime: DoomSession | undefined;
  let closed = false;
  let running = false;
  let pendingFailure: Error | undefined;

  const resize = () => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const fitted = fitFourByThree(width, height);

    const properties = {
      '--doom-width': `${fitted.width}px`,
      '--doom-height': `${fitted.height}px`,
      '--doom-left': `${(width - fitted.width) / 2}px`,
      '--doom-top': `${(height - fitted.height) / 2}px`,
      '--doom-refresh-height': `${Math.ceil((fitted.height * 0.14) / 12) * 12}px`,
      '--doom-refresh-end': `${Math.ceil(fitted.height / 12) * 12}px`,
      '--doom-refresh-steps': String(
        Math.ceil((fitted.height * 0.14) / 12) + Math.ceil(fitted.height / 12),
      ),
    };

    for (const [name, value] of Object.entries(properties)) {
      viewport.style.setProperty(name, value);
    }

    compositor?.resize(width, height);
  };

  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    window.removeEventListener('resize', resize);
    compositor?.dispose();
    compositor = undefined;
    runtime = undefined;
    panel.dispose();
    delete html.dataset.application;

    for (const name of Array.from(viewport.style)) {
      if (name.startsWith('--doom-')) {
        viewport.style.removeProperty(name);
      }
    }

    terminal.hidden = wasHidden;
    terminal.inert = wasInert;
    terminal.scrollTop = scroll.main;
    window.scrollTo(0, scroll.window);
  };

  const state = (value: 'loading' | 'running' | 'failed') => {
    phase = value;
    render();
    options.onStateChange(value);
  };

  const progress = ({received, total}: DoomProgress) => {
    message = `Loading DOOM… ${bytes(received)} / ${total === null ? 'unknown' : bytes(total)}`;
    render();
  };

  const startupFailure = (error: Error) => {
    compositor?.dispose();
    compositor = undefined;
    runtime = undefined;
    canvasHidden = true;
    statusHidden = false;
    message = `Could not start DOOM: ${error.message}`;
    failure = error;
    state('failed');
    root.querySelector('button')?.focus({preventScroll: true});
  };

  const exit = (code: number) => {
    if (closed) {
      return;
    }

    if (code === 0) {
      cleanup();
      options.onExit();
    } else {
      const error =
        pendingFailure ?? new Error(`Game stopped with exit status ${code}`);

      if (!running) {
        startupFailure(error);
      } else {
        cleanup();
        options.onFailure(error);
      }
    }
  };

  const start = async () => {
    pendingFailure = undefined;
    running = false;
    canvasHidden = true;
    statusHidden = false;
    progress({received: 0, total: null});
    state('loading');
    root.focus({preventScroll: true});

    try {
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      compositor = createDoomCompositor(canvas, {
        crt: html.dataset.crt === 'on',

        reducedMotion: () => motion.matches,

        onFailure(error) {
          pendingFailure = error;
          runtime?.dispose();
        },
      });
      resize();

      const session = await startDoom({
        canvas,
        onProgress: progress,

        onFrame: (memory, pointer, width, height) =>
          compositor?.draw(memory, pointer, width, height),

        onExit: exit,
      });

      if (closed || root.dataset.doomState === 'failed') {
        return;
      }

      runtime = session;

      if (pendingFailure) {
        runtime.dispose();

        return;
      }

      running = true;
      canvasHidden = false;
      statusHidden = true;
      state('running');
      canvas.focus({preventScroll: true});
    } catch (error) {
      if (!closed) {
        startupFailure(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  };

  window.addEventListener('resize', resize);
  resize();
  await start();
}
