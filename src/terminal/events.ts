export function scopedEvents(signal: AbortSignal) {
  function listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void;
  function listen(
    target: EventTarget,
    type: 'popstate',
    listener: (event: PopStateEvent) => void,
  ): void;

  function listen(
    target: EventTarget,
    type: string,
    listener: (event: never) => void,
  ) {
    target.addEventListener(type, listener as EventListener, {signal});
  }

  return listen;
}
