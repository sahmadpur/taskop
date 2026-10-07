import { z } from 'zod';

export const credentialKindSchema = z.enum(['password', 'pin']);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

const WEAK_PINS = new Set(['123123', '112233', '121212', '696969', '101010', '111222', '159753']);

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (WEAK_PINS.has(pin)) return true;
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export const pinSchema = z
  .string()
  .regex(/^\d{6}$/, { error: 'errors.validation.pinFormat' })
  .refine((p) => !isWeakPin(p), { error: 'errors.validation.pinWeak' });

export const passwordSchema = z
  .string()
  .min(10, { error: 'errors.validation.passwordLength' })
  .max(128, { error: 'errors.validation.passwordLength' });

export const secretSchemaFor = (kind: CredentialKind) => (kind === 'pin' ? pinSchema : passwordSchema);

export const orgCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/, { error: 'errors.validation.orgCode' });

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, { error: 'errors.validation.username' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: 'errors.validation.email' })
  .pipe(z.email({ error: 'errors.validation.email' }));
