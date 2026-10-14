import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@/lib/i18n';

// The default 1s for findBy*/waitFor is too tight for heavy pages on loaded CI runners.
configure({ asyncUtilTimeout: 3000 });

// jsdom does not implement scrolling; the router calls it on navigation and logs "Not implemented" otherwise.
window.scrollTo = () => undefined;

afterEach(() => cleanup());
