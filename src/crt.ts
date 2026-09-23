import { readDisplayConfig, saveDisplayConfig } from './display-config';
import { bloomPreference, defaultBloom, setCrtBloom } from './crt-bloom';
import { setupCrtPointer } from './crt-pointer';

export function setupCrt() {
  setupCrtPointer();
  const bloomToggle = document.querySelector<HTMLButtonElement>('#bloom-toggle');
  if (bloomToggle) {
    let bloom = bloomPreference();
    const paintBloom = () => {
      setCrtBloom(bloom);
      bloomToggle.setAttribute('aria-pressed', String(bloom));
      bloomToggle.textContent = `bloom: ${bloom ? 'on' : 'off'}`;
      bloomToggle.title = 'On: highlight bloom. Off: text shadows and image glow.';
    };
    bloomToggle.hidden = false;
    paintBloom();
    bloomToggle.addEventListener('click', () => {
      bloom = !bloom;
      paintBloom();
      saveDisplayConfig({ bloom }, defaultBloom());
    });
  }
  const toggle = document.querySelector<HTMLButtonElement>('#crt-toggle');
  if (!toggle) return;
  let enabled = readDisplayConfig(defaultBloom()).crt;
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
    const curved = document.documentElement.dataset.crtCurved === 'ready';
    const scroll = enabled && curved ? main.scrollTop : window.scrollY;
    enabled = !enabled;
    paint();
    if (enabled && curved) main.scrollTop = scroll;
    else window.scrollTo(0, scroll);
    saveDisplayConfig({ crt: enabled }, defaultBloom());
  });
}
