import { readDisplayConfig } from './display-config';

export const defaultBloom = () => !CSS.supports('-moz-appearance', 'none');

export function bloomPreference(): boolean {
  return readDisplayConfig(defaultBloom()).bloom;
}

export function setCrtBloom(enabled: boolean) {
  document.documentElement.dataset.bloom = enabled ? 'on' : 'off';
  const filter = document.querySelector('#crt-curve');
  if (!filter) return;
  // Remove the extra passes entirely in shadow mode: bypassing their output
  // alone still incurs rendering work in Firefox.
  filter.querySelectorAll('[data-crt-bloom]').forEach((node) => node.remove());
  if (!enabled) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = `<filter>
    <feComponentTransfer data-crt-bloom="" in="curved" result="highlights">
      <feFuncR type="linear" slope="1.5" intercept="-0.35"/>
      <feFuncG type="linear" slope="1.5" intercept="-0.35"/>
      <feFuncB type="linear" slope="1.5" intercept="-0.35"/>
    </feComponentTransfer>
    <feGaussianBlur data-crt-bloom="" id="crt-bloom" in="highlights" stdDeviation="2.2" result="bloom"/>
    <feComposite data-crt-bloom="" in="bloom" in2="curved" operator="arithmetic" k1="0" k2="0.3" k3="1" k4="0"/>
  </filter>`;
  filter.append(...svg.firstElementChild!.children);
}
