import type {ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';

// Lazy application bundles own one React root inside an otherwise empty slot.
// External engines may only mutate the canvas/editor element supplied to them.
export function mountPanel(host: Element) {
  const root = createRoot(host);

  return {
    render(node: ReactNode) {
      flushSync(() => root.render(node));
    },

    dispose() {
      flushSync(() => root.unmount());
    },
  };
}
