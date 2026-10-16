import base from '@taskop/config/eslint';
import globals from 'globals';

// .astro files are not linted (no parser configured); the TypeScript beside them is.
export default [...base, { ignores: ['.astro/**'] }, { files: ['**/*.mjs', '**/*.ts'], languageOptions: { globals: { ...globals.browser, ...globals.node } } }];
