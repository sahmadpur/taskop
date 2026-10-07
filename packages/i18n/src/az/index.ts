import common from './common.js';
import errors from './errors.js';

export const az = { common, errors } as const;
export type Translations = typeof az;
