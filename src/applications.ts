import type { ApplicationRequest } from './executables';

export const DOOM_REQUIREMENT = 'DOOM: a computer with a physical keyboard is required';

export type LaunchEnvironment = {
  coarsePointer: boolean;
  finePointer: boolean;
  viewportWidth: number;
  viewportHeight: number;
  webAssembly: boolean;
};

export type ApplicationState = 'idle' | 'loading' | 'running' | 'failed';

export function canLaunchDoom(environment: LaunchEnvironment): boolean {
  return (
    environment.finePointer &&
    !environment.coarsePointer &&
    environment.viewportWidth >= 640 &&
    environment.viewportHeight >= 480 &&
    environment.webAssembly
  );
}

export function createApplicationController(options: {
  environment: () => LaunchEnvironment;
  onStateChange: (state: ApplicationState) => void;
  onComplete: (exitCode: number) => void;
}) {
  let state: ApplicationState = 'idle';
  let cancel: (() => void) | undefined;
  let generation = 0;
  let browserProgram = false;

  const setState = (next: ApplicationState) => {
    state = next;
    options.onStateChange(state);
  };

  return {
    get state() {
      return state;
    },
    get interruptible() {
      return browserProgram;
    },
    interrupt() {
      if (!browserProgram) return;
      generation++;
      if (cancel) cancel();
      else {
        browserProgram = false;
        setState('idle');
        options.onComplete(130);
      }
    },
    async launch(
      request: ApplicationRequest,
      onReject: (message: string) => void,
      onOutput: (text: string, error: boolean) => void = () => {},
    ) {
      if (state !== 'idle') return;
      if (request.name === 'doom' && !canLaunchDoom(options.environment())) {
        onReject(DOOM_REQUIREMENT);
        return;
      }
      browserProgram = request.name === 'browser';
      const current = ++generation;
      setState('loading');
      const fail = (error: unknown) => {
        onReject(
          `${request.executablePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        browserProgram = false;
        setState('idle');
        options.onComplete(1);
      };
      try {
        if (request.name === 'browser') {
          const url = '/assets/program.js';
          const module: typeof import('./program') = await import(url);
          if (current !== generation) return;
          cancel = module.launchProgram(request, {
            onOutput,
            onExit: (code) => {
              cancel = undefined;
              browserProgram = false;
              setState('idle');
              options.onComplete(code);
            },
          });
          setState('running');
          return;
        }
        const moduleUrl = '/assets/doom/app.js';
        const module: typeof import('./doom/index') = await import(moduleUrl);
        await module.launchDoom({
          onStateChange: setState,
          onExit: () => {
            setState('idle');
            options.onComplete(0);
          },
          onFailure: fail,
        });
      } catch (error) {
        if (current === generation) fail(error);
      }
    },
  };
}
