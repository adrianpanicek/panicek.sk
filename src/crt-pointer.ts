export function setupCrtPointer() {
  const viewport = document.querySelector<HTMLElement>('.crt-viewport');

  if (!viewport) {
    return;
  }

  const root = document.documentElement;
  const pointer = viewport.querySelector<HTMLElement>('.crt-pointer')!;
  const events = new AbortController();
  let frame = 0;
  let x = 0;
  let y = 0;

  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    delete root.dataset.crtPointer;
  };

  const draw = () => {
    frame = 0;
    pointer.style.transform = `translate(${x}px, ${y}px)`;
    root.dataset.crtPointer = 'visible';
  };

  document.addEventListener(
    'pointermove',
    event => {
      if (
        event.pointerType !== 'mouse' ||
        root.dataset.crt !== 'on' ||
        root.dataset.crtCurved !== 'ready'
      ) {
        hide();

        return;
      }

      x = event.clientX;
      y = event.clientY;
      pointer.dataset.link = String(
        Boolean(
          (event.target as Element).closest('a, button, [role="button"]'),
        ),
      );

      if (!frame) {
        frame = requestAnimationFrame(draw);
      }
    },
    {passive: true, signal: events.signal},
  );
  document.documentElement.addEventListener('pointerleave', hide, {
    signal: events.signal,
  });
  document.addEventListener(
    'pointerdown',
    event => {
      if (event.pointerType !== 'mouse') {
        hide();
      }
    },
    {passive: true, signal: events.signal},
  );
  window.addEventListener('blur', hide, {signal: events.signal});
  window.addEventListener('resize', hide, {signal: events.signal});
  document.addEventListener('visibilitychange', hide, {signal: events.signal});

  return () => {
    hide();
    events.abort();
  };
}
