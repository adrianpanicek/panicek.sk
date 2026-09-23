import { readDisplayConfig, saveDisplayConfig } from './display-config';
import { defaultBloom } from './crt-bloom';

export function animationsEnabled() {
  return (
    document.documentElement.dataset.animations !== 'off' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function setupAnimations() {
  const toggle = document.querySelector<HTMLButtonElement>('#animations-toggle')!;
  let enabled = readDisplayConfig(defaultBloom()).animations;
  const apply = () => {
    document.documentElement.dataset.animations = enabled ? 'on' : 'off';
    toggle.textContent = `animations: ${enabled ? 'on' : 'off'}`;
    toggle.setAttribute('aria-pressed', String(enabled));
  };
  apply();
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    saveDisplayConfig({ animations: enabled }, defaultBloom());
    apply();
  });
}
