import auth from './auth.js';
import common from './common.js';
import errors from './errors.js';
import nav from './nav.js';
import settings from './settings.js';
import sites from './sites.js';

// Each UI namespace is a file in this folder; register new ones here.
export const az = { common, errors, auth, nav, settings, sites } as const;
export type Translations = typeof az;
