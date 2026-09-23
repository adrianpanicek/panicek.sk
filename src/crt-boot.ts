import { readDisplayConfig } from './display-config';
import { bloomPreference, defaultBloom, setCrtBloom } from './crt-bloom';

function setupCurvature() {
  document.documentElement.dataset.crt = readDisplayConfig(defaultBloom()).crt ? 'on' : 'off';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'crt-filter');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.innerHTML = `<defs>
    <filter id="crt-curve" filterUnits="userSpaceOnUse" x="0" y="0" color-interpolation-filters="sRGB">
      <feImage id="crt-curve-map" x="0" y="0" preserveAspectRatio="none" result="curve"/>
      <feDisplacementMap id="crt-curve-displacement" in="SourceGraphic" in2="curve" xChannelSelector="R" yChannelSelector="G" result="curved"/>
    </filter>
  </defs>`;
  document.head.append(svg);
  setCrtBloom(bloomPreference());
  const filter = document.querySelector('#crt-curve');
  const image = document.querySelector('#crt-curve-map');
  const displacement = document.querySelector('#crt-curve-displacement');
  if (!filter || !image || !displacement) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return;
  const map = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = (x / 255) * 2 - 1;
      const v = (y / 255) * 2 - 1;
      const offset = (y * 256 + x) * 4;
      map.data[offset] = Math.round(127.5 + 127.5 * u * (0.7 * v * v + 0.3 * u * u));
      map.data[offset + 1] = Math.round(127.5 + 127.5 * v * (0.7 * u * u + 0.3 * v * v));
      map.data[offset + 2] = 128;
      map.data[offset + 3] = 255;
    }
  }
  context.putImageData(map, 0, 0);
  image.setAttribute('href', canvas.toDataURL());
  const resize = () => {
    const width = innerWidth;
    const height = innerHeight;
    const curve = Math.min(24, Math.min(width, height) * 0.035);
    for (const node of [filter, image]) {
      node.setAttribute('width', String(width));
      node.setAttribute('height', String(height));
    }
    displacement.setAttribute('scale', String(curve * 2));
    document.documentElement.style.setProperty('--crt-inset', `${Math.ceil(curve + 8)}px`);
    const jump = 12;
    const band = Math.ceil((height * 0.14) / jump) * jump;
    const end = Math.ceil(height / jump) * jump;
    document.documentElement.style.setProperty('--crt-refresh-height', `${band}px`);
    document.documentElement.style.setProperty('--crt-refresh-end', `${end}px`);
    document.documentElement.style.setProperty('--crt-refresh-steps', String((band + end) / jump));
  };
  resize();
  window.addEventListener('resize', resize);
  document.documentElement.dataset.crtCurved = 'ready';
}

setupCurvature();
