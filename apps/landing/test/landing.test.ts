import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { az, en, ru } from '@taskop/i18n';
import { describe, expect, it } from 'vitest';
import Landing from '../src/components/Landing.astro';
import LegalPage from '../src/components/LegalPage.astro';

const render = async (lang: 'az' | 'en' | 'ru') => {
  const container = await AstroContainer.create();
  return container.renderToString(Landing, { props: { lang } });
};

describe('landing page', () => {
  it('renders the Azerbaijani page by default with every section', async () => {
    const html = await render('az');
    expect(html).toContain('<html lang="az"');
    expect(html).toContain(`<title>${az.landing.meta.title}</title>`);
    for (const id of ['features', 'how', 'mobile', 'faq']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain(az.landing.hero.title);
    expect(html).toContain(az.landing.faq.q1.q);
  });

  it('switches language: /en/ and /ru/ render their own strings, titles and hreflang links', async () => {
    const english = await render('en');
    expect(english).toContain('<html lang="en"');
    expect(english).toContain(en.landing.hero.title);
    expect(english).toContain(`<title>${en.landing.meta.title}</title>`);
    expect(english).not.toContain(az.landing.hero.title);
    const russian = await render('ru');
    expect(russian).toContain(ru.landing.hero.title);
    for (const html of [english, russian]) {
      expect(html).toContain('hreflang="az" href="https://taskop.app/"');
      expect(html).toContain('hreflang="en" href="https://taskop.app/en/"');
      expect(html).toContain('hreflang="ru" href="https://taskop.app/ru/"');
    }
    // The switch itself: three links, the current one marked.
    expect(english).toContain('href="/ru/" hreflang="ru"');
    expect(english).toMatch(/href="\/en\/" hreflang="en"[^>]*aria-current="page"/);
  });

  it('points Login and Sign up at the platform URL from the environment', async () => {
    const html = await render('az');
    expect(html).toContain('href="https://platform.example.test/login" data-testid="login"');
    expect(html).toContain('href="https://platform.example.test/login" data-testid="hero-login"');
    expect(html).toContain('href="https://platform.example.test/signup" data-testid="hero-signup"');
  });

  it('renders the placeholder legal pages', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(LegalPage, { props: { lang: 'en', kind: 'privacy' } });
    expect(html).toContain(en.landing.legal.privacyTitle);
    expect(html).toContain('hello@taskop.app');
  });
});
