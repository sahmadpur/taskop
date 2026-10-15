# Taskop redesign: design direction (2026-10-15)

The note that precedes the redesign of the web app, the mobile app, the icons, the language selector and the landing page. The direction board (palette, logo, type, sample components) is rendered from `board.html` in the session scratchpad; the decisions it shows are recorded here.

## What Taskop looks like today

Both apps are unstyled defaults: the web app is the shadcn zero-chroma grey theme with a navy sidebar, black buttons and Geist; the mobile app is a flat electric blue (#1D5BD8) on light grey with the system font. Nothing ties the two together, there is no logo (a stock check-square icon), no favicon, no dark mode, and Chromium renders Azerbaijani dates as `2026 M10 15` because its ICU data has no az month names.

## Direction: "a stamped inspection sheet, read outdoors"

Taskop is paperwork for field work: checklists run on site, often in sunlight and offline, then audited at a desk. The design takes its cues from that: high-contrast ink on light surfaces, one deep working colour, thick legible type, status that is always text plus colour, never colour alone. The one bold element is the colour identity (deep sea-blue plus saffron); everything else stays quiet and dense.

### Palette

| Token | Light | Role |
|---|---|---|
| Caspian | `#005E8C` (oklch 0.45 0.12 232), 7.0:1 on white | primary: buttons, links, focus ring, in-progress state |
| Caspian deep | `#004A72` | hover and pressed |
| Deep | `#021B2B` | web sidebar, mobile headers, dark-mode canvas |
| Saffron | `#ECAA0B` | brand only: the logo's accent variant, the landing page, the current-page tick in the sidebar. Never a status colour. |
| Ink / Ink 2 | `#162235` / `#5F6A7B` (5.5:1) | text and secondary text |
| Line / Canvas / Surface | `#D8DFE6` / `#F4F7FB` / `#FFFFFF` | borders, page, cards and tables |

Status colours, each with a solid step (text, icon) and a soft step (chip background): planned slate, in progress Caspian, completed green `#05893E`, late and partial amber `#945000` on `#FFEFC7`, missed and problem red `#D01D21`, audit pending violet `#7A4ABA`, audit passed/failed reuse green/red. Problem severities: normal amber, critical red. Every status chip carries text, so colour is never the only signal.

Dark mode: canvas `#0A111F`, surface `#151D2B`, text `#EAEFF5`, primary lightened to `#59B7E4` with Deep text, status softs become 20 % tints of the solid. Web gets light, dark and system with a toggle in the user menu. Mobile ships light only in this round: workers use it outdoors where a light surface reads best, and every mobile screen uses static StyleSheets, so dark would be a separate pass. The mobile tokens are defined for both so that pass is mechanical.

### Type

IBM Plex Sans, one family on all three surfaces, variable weight 300–700. Chosen because it covers Azerbaijani Latin (ə, ğ, ı, ş) and Cyrillic in one file, has tabular numerals for tables and tiles, and its engineered terminals fit an operations tool better than a geometric sans. Scale: 13 / 14 / 16 / 20 / 24 / 32 on the web, 15 / 17 / 20 / 24 / 30 on mobile (larger base for outdoor reading), display 40–56 on the landing page at weight 600 with tight tracking. No all-caps labels, no monospace, no eyebrows.

### Components

- Web shell: Deep sidebar with the logo, a saffron tick on the current item, groups separated by spacing not rules; a white header with organisation name, language, notifications, user menu. Radius 10 px for controls, 14 px for cards, 6 px for chips. One shadow level (a 1 px line plus a faint ink tint) for cards; dialogs and popovers get a second, stronger level.
- Tables: 44 px rows, sticky header, sortable heads with a visible arrow, right-aligned tabular numbers, hover tint. Filters sit in one wrapping toolbar with labelled controls.
- Dialogs and run-dialog tabs: a line-style tab bar (underline, not pills), 24 px padding, titled sections.
- Charts: due bars in slate, completed in Caspian, the completion line in saffron; the hidden data table stays.
- Empty, loading and error states: one shared block with an icon, a one-line explanation and the next action; skeleton rows for loading.
- Mobile: Deep header block with the day and the greeting, cards with 1.5 px borders and a 5 px status edge (Caspian active, red overdue, amber rework), 52 px primary buttons, 48 px minimum touch targets, chips at 40 px height. Execution screen: section pager pinned at the bottom, progress bar in the header, rework banner in amber with the manager's comment inline.
- Accessibility: AA contrast on every pair above, 2 px Caspian focus ring on an offset, labels on every input, `aria-live` on sync and save states, `accessibilityRole`/`Label` on every mobile control.

### Logo

A ring with a check whose long stroke breaks out through the ring at the top right. The check reads as the two hands of a clock, scheduled checks, which is what Taskop does; the break says the job is done and reported. Single colour, so it works at 16 px and as a monochrome icon. Variants: Caspian tile with a white mark (iOS light, Android), Deep tile with a white mark (iOS dark), Deep tile with a saffron mark (landing), grey mono (iOS tinted and Android monochrome). Source SVG lives in a new `packages/brand` with the token CSS and a script that generates every PNG, the ICO and the OG image, so the three apps never drift.

## Languages

Azerbaijani (default), English, Russian, as asked. The `intlLocale` map already knows Turkish but it is not added. The choice is stored locally (`localStorage` on the web and the landing page, AsyncStorage/SecureStore on mobile) and read before i18next initialises. Dates, numbers and percentages format with the UI language through a shared `@taskop/i18n` formatter, which also fixes the Chromium az month-name gap with its own month and weekday names. No server-side preference in this round; if you want one, the API gets a nullable `locale` on the user profile and the web/mobile selectors write it in a follow-up.

Server-generated text (emails, the audit PDF, push notifications, exports) stays Azerbaijani; it is listed as a follow-up.

## Landing page: Astro

`apps/landing` is an Astro site, not Vite + React. The page is static marketing content in three languages: Astro prerenders `/`, `/en/` and `/ru/` with the right `<html lang>`, title, description, Open Graph tags and `hreflang` links at build time and ships no JavaScript except a few lines for the language memory and the FAQ, which is what makes Lighthouse ≥ 90 on performance and accessibility easy. The selector is three plain links, so it works without JavaScript and search engines index every language. Strings come from a new `landing` namespace in `@taskop/i18n`; the design tokens, logo and favicons come from `packages/brand`, so it shares the system without sharing React. Tests use Vitest with Astro's container renderer: the page renders, each language renders its own strings, and the Login link points at `VITE_PLATFORM_URL` (configured as `PLATFORM_URL` in Astro's env).

Structure, top to bottom: header (logo, section links, language, Login, Sign up); hero with the one-sentence promise and a phone built in HTML from the real design tokens showing a checklist run, not a screenshot that goes stale; six features as a two-column list with short copy; how it works in three numbered steps (it is a sequence: set up checklists and schedules, the team runs them on the phone, managers review, audit and send back); the mobile app section with placeholder store badges; FAQ with native `<details>`; footer with contact email, privacy and terms placeholder pages. Login goes to `${PLATFORM_URL}/login`, Sign up to `${PLATFORM_URL}/signup`.

## Delivery

Three pull requests against `main`, in this order: (1) `packages/brand`, the web redesign, favicons, the en/ru translations with the key-parity test, the web selector and per-language formatting; (2) the landing page with CI and turbo wiring; (3) the mobile redesign, app icons and splash, the mobile selector. Before each PR: screenshots of the key screens, and all suites green.
