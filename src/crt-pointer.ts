export function setupCrtPointer() {
  const viewport = document.querySelector<HTMLElement>('.crt-viewport');
  if (!viewport) return;
  const root = document.documentElement;
  const pointer = document.createElement('div');
  pointer.className = 'crt-pointer';
  pointer.setAttribute('aria-hidden', 'true');
  const pixels = [
    'x',
    'xx',
    'xox',
    'xoox',
    'xooox',
    'xoooox',
    'xooooox',
    'xoooooox',
    'xooooooox',
    'xoooooooox',
    'xoooooxxxx',
    'xooxoox',
    'xox xoox',
    'xx  xoox',
    'x    xoox',
    '     xxxx',
  ];
  const path = (pixel: string) =>
    pixels
      .flatMap((row, y) =>
        [...row].map((value, x) => (value === pixel ? `M${x} ${y}h1v1h-1z` : '')),
      )
      .join('');
  pointer.innerHTML = `<svg viewBox="0 0 12 16" width="24" height="32" shape-rendering="crispEdges"><path d="${path('x')}" fill="#10151b"/><path d="${path('o')}" fill="currentColor"/></svg>`;
  viewport.append(pointer);
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
    (event) => {
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
        Boolean((event.target as Element).closest('a, button, [role="button"]')),
      );
      if (!frame) frame = requestAnimationFrame(draw);
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', hide);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'mouse') hide();
    },
    { passive: true },
  );
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  document.addEventListener('visibilitychange', hide);
}
