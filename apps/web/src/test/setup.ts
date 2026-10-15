import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { LANGUAGE_STORAGE_KEY } from '@taskop/i18n';

// The default 1s for findBy*/waitFor is too tight for heavy pages on loaded CI runners.
configure({ asyncUtilTimeout: 3000 });

// jsdom does not implement scrolling; the router calls it on navigation and logs "Not implemented" otherwise.
window.scrollTo = () => undefined;

afterEach(() => cleanup());

// jsdom reports navigator.languages as English; the tests assert the Azerbaijani UI, so the stored choice pins it.
localStorage.setItem(LANGUAGE_STORAGE_KEY, 'az');
await import('@/lib/i18n');
