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

  const setState = (next: ApplicationState) => {
    state = next;
    options.onStateChange(state);
  };

  return {
    get state() {
      return state;
    },
    async launch(request: ApplicationRequest, onReject: (message: string) => void) {
      if (state !== 'idle') return;
      if (request.name === 'doom' && !canLaunchDoom(options.environment())) {
        onReject(DOOM_REQUIREMENT);
        return;
      }
      setState('loading');
      const fail = (error: unknown) => {
        onReject(`DOOM: ${error instanceof Error ? error.message : String(error)}`);
        setState('idle');
        options.onComplete(1);
      };
      try {
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
        fail(error);
      }
    },
  };
}
