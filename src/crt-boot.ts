import {readDisplayConfig} from './display-config';
import {defaultBloom} from './crt-bloom';

const config = readDisplayConfig();
document.documentElement.dataset.shellBoot = 'pending';
document.documentElement.dataset.crt = config.crt ? 'on' : 'off';
document.documentElement.dataset.bloom =
  config.crt && defaultBloom() ? 'on' : 'off';
document.documentElement.dataset.animations = config.animations ? 'on' : 'off';
setTimeout(() => delete document.documentElement.dataset.shellBoot, 8000);
