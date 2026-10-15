/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// The tests assert the Login link target, so the platform URL is pinned here rather than read from .env.
process.env.PLATFORM_URL = 'https://platform.example.test';

export default getViteConfig({
  test: { include: ['test/**/*.test.ts'] },
});
