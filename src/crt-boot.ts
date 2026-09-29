import {readDisplayConfig} from './display-config';

const config = readDisplayConfig(!CSS.supports('-moz-appearance', 'none'));
document.documentElement.dataset.shellBoot = 'pending';
document.documentElement.dataset.crt = config.crt ? 'on' : 'off';
document.documentElement.dataset.bloom = config.bloom ? 'on' : 'off';
document.documentElement.dataset.animations = config.animations ? 'on' : 'off';
setTimeout(() => delete document.documentElement.dataset.shellBoot, 8000);
