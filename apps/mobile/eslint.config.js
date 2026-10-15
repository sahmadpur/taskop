import base from '@taskop/config/eslint';
export default [
  ...base,
  { ignores: ['metro.config.js', '.expo/**', 'ios/**', 'android/**'] },
  // Expo config plugins are loaded with require(), so they stay CommonJS.
  {
    files: ['plugins/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
