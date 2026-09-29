import {hydrateRoot} from 'react-dom/client';
import {CrtFilterDefinitions} from './ui/crt-filter';

hydrateRoot(document.querySelector('.crt-filter')!, <CrtFilterDefinitions />);
