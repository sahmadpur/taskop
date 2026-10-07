import auth from './auth.js';
import common from './common.js';
import errors from './errors.js';

// Each UI namespace is a file in this folder; register new ones here.
export const az = { common, errors, auth } as const;
export type Translations = typeof az;
