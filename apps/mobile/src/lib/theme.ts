import { fontFamily, light, radius as brandRadius, space, type as typeScale } from '@taskop/brand';

/**
 * The mobile theme, read from @taskop/brand so the phone and the web app share one colour system. Light only in this
 * round: workers use the app outdoors, where a light surface reads best; the dark tokens exist in the brand package
 * for a later pass. The first block keeps the names the screens already use.
 */
export const colors = {
  primary: light.primary,
  primaryDeep: light.primaryDeep,
  primaryText: light.onPrimary,
  primarySoft: light.primarySoft,
  background: light.canvas,
  surface: light.surface,
  text: light.ink,
  muted: light.ink2,
  border: light.line,
  borderStrong: light.lineStrong,
  danger: light.status.bad.solid,
  dangerText: light.status.bad.text,
  dangerSoft: light.status.bad.soft,
  warning: light.status.late.solid,
  warningText: light.status.late.text,
  warningSoft: light.status.late.soft,
  success: light.status.ok.solid,
  successText: light.status.ok.text,
  successSoft: light.status.ok.soft,
  audit: light.status.audit.solid,
  auditText: light.status.audit.text,
  auditSoft: light.status.audit.soft,
  planned: light.status.planned.solid,
  plannedText: light.status.planned.text,
  plannedSoft: light.status.planned.soft,
  deep: light.deep,
  onDeep: light.onDeep,
  onDeepMuted: light.onDeepMuted,
  saffron: light.saffron,
} as const;

export const spacing = { xs: space.xs, sm: space.sm, md: space.lg, lg: space.xl, xl: space.xxl } as const;
export const radius = brandRadius;
/** Font sizes for outdoor reading: 15 base, 17 for controls and card titles. */
export const type = typeScale.mobile;
/** Registered by the expo-font config plugin (app.json) in four weights; RN picks the weight from `fontWeight`. */
export const font = fontFamily;

/** Chip colours by status tone, matching the web's badge variants. */
export const TONES = {
  neutral: { bg: colors.plannedSoft, fg: colors.plannedText },
  active: { bg: colors.primarySoft, fg: colors.primaryDeep },
  success: { bg: colors.successSoft, fg: colors.successText },
  warning: { bg: colors.warningSoft, fg: colors.warningText },
  danger: { bg: colors.dangerSoft, fg: colors.dangerText },
  audit: { bg: colors.auditSoft, fg: colors.auditText },
} as const;
export type Tone = keyof typeof TONES;

/** Base text style: the brand face and the outdoor size. */
export const text = { fontFamily: font, fontSize: type.base, color: colors.text } as const;
