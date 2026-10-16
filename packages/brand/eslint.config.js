import base from '@taskop/config/eslint';
import globals from 'globals';

export default [...base, { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } }];
