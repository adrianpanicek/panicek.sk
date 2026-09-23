import { animationsEnabled } from './animations';

/** Quadratic scrolling that yields to user input for the rest of a navigation. */
export function createAutoScroll() {
  let frame = 0;
  let interrupted = false;
  let target: HTMLElement;
  const cancel = () => {
    interrupted = true;
    cancelAnimationFrame(frame);
  };
  for (const event of ['wheel', 'touchstart', 'pointerdown'])
    document.addEventListener(event, cancel, { passive: true, capture: true });
  document.addEventListener(
    'keydown',
    (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        cancel();
    },
    true,
  );
  return {
    begin() {
      cancelAnimationFrame(frame);
      interrupted = false;
    },
    retarget(node: HTMLElement) {
      target = node;
    },
    move(node: HTMLElement, inset: number) {
      target = node;
      if (interrupted) return;
      cancelAnimationFrame(frame);
      const main = document.querySelector('main')!;
      const nested = /auto|scroll/.test(getComputedStyle(main).overflowY);
      const scroller = nested ? main : document.scrollingElement!;
      const start = scroller.scrollTop;
      const destination = () =>
        Math.max(
          0,
          Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            scroller.scrollTop +
              target.getBoundingClientRect().top -
              (nested ? main.getBoundingClientRect().top : 0) -
              inset,
          ),
        );
      if (!animationsEnabled()) {
        scroller.scrollTop = destination();
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / 450);
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
        scroller.scrollTop = start + (destination() - start) * eased;
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
  };
}
