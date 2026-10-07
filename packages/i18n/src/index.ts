import { az } from './az/index.js';

export { az };
export type { Translations } from './az/index.js';
export * from './format.js';

export const DEFAULT_LOCALE = 'az';
export const resources = { az: { translation: az } } as const;
