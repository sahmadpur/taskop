import base from '@taskop/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, reactHooks.configs.flat['recommended-latest'], { ignores: ['src/components/ui/**'] });
