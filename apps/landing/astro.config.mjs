// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig, envField } from 'astro/config';

const locales = ['az', 'en', 'ru'];

export default defineConfig({
  site: 'https://taskop.app',
  output: 'static',
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'az',
    locales,
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap({ i18n: { defaultLocale: 'az', locales: Object.fromEntries(locales.map((l) => [l, l])) } })],
  env: {
    schema: {
      /** The platform web app the Login and Sign up links go to: https://admin.taskop.app in production, the Vite dev server locally. */
      PLATFORM_URL: envField.string({ context: 'client', access: 'public', url: true, default: 'http://localhost:5173' }),
    },
  },
});
