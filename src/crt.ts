import { setupCrtPointer } from './crt-pointer';

export function setupCrt() {
  setupCrtPointer();
  const toggle = document.querySelector<HTMLButtonElement>('#crt-toggle');
  if (!toggle) return;
  const key = 'portfolio:crt';
  let enabled = true;
  try {
    enabled = localStorage.getItem(key) !== 'off';
  } catch {}
  const paint = () => {
    delete document.documentElement.dataset.crtPointer;
    document.documentElement.dataset.crt = enabled ? 'on' : 'off';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = `crt: ${enabled ? 'on' : 'off'}`;
  };
  toggle.hidden = false;
  paint();
  toggle.addEventListener('click', () => {
    const main = document.querySelector('main')!;
    const scroll = enabled ? main.scrollTop : window.scrollY;
    enabled = !enabled;
    paint();
    if (enabled) main.scrollTop = scroll;
    else window.scrollTo(0, scroll);
    try {
      localStorage.setItem(key, enabled ? 'on' : 'off');
    } catch {}
  });
}
