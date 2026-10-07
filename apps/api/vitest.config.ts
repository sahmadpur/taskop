import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      tsconfigFile: false,
      swcrc: false,
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
});
