import {createElement} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {App} from './ui/app';
import {createTerminalStore, type InitialPage} from './terminal/store';
import {startTerminal} from './terminal/controller';

const initial: InitialPage = JSON.parse(
  document.querySelector('#initial-page')!.textContent!,
);
const store = createTerminalStore(initial);
hydrateRoot(
  document.querySelector('#app')!,
  createElement(App, {
    initial,
    store,

    start: () => startTerminal(store),
  }),
);
