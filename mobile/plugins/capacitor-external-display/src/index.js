import { registerPlugin } from '@capacitor/core';
import { ExternalDisplayWeb } from './web.js';

const ExternalDisplay = registerPlugin('ExternalDisplay', {
  web: () => new ExternalDisplayWeb(),
});

export { ExternalDisplay };
