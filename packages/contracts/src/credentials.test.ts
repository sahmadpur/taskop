import { describe, expect, it } from 'vitest';
import { emailSchema, isWeakPin, orgCodeSchema, passwordSchema, pinSchema, usernameSchema } from './index.js';

describe('isWeakPin', () => {
  it.each(['000000', '111111', '123456', '654321', '234567', '987654', '123123', '112233', '121212'])(
    'flags %s as weak',
    (pin) => expect(isWeakPin(pin)).toBe(true),
  );
  it.each(['482915', '730184', '102938'])('accepts %s', (pin) => expect(isWeakPin(pin)).toBe(false));
});

describe('pinSchema', () => {
  it('requires exactly 6 digits', () => {
    expect(pinSchema.safeParse('12345').error?.issues[0]?.message).toBe('errors.validation.pinFormat');
    expect(pinSchema.safeParse('12a456').error?.issues[0]?.message).toBe('errors.validation.pinFormat');
  });
  it('rejects weak pins with a dedicated key', () => {
    expect(pinSchema.safeParse('123456').error?.issues[0]?.message).toBe('errors.validation.pinWeak');
  });
  it('accepts a strong pin', () => expect(pinSchema.parse('482915')).toBe('482915'));
});

describe('passwordSchema', () => {
  it('enforces 10..128 characters', () => {
    expect(passwordSchema.safeParse('short').error?.issues[0]?.message).toBe('errors.validation.passwordLength');
    expect(passwordSchema.safeParse('x'.repeat(129)).error?.issues[0]?.message).toBe(
      'errors.validation.passwordLength',
    );
    expect(passwordSchema.parse('long enough pw')).toBe('long enough pw');
  });
});

describe('identifier normalisation', () => {
  it('trims and lowercases org codes', () => expect(orgCodeSchema.parse('  ACME-1 ')).toBe('acme-1'));
  it('rejects org codes with invalid characters', () =>
    expect(orgCodeSchema.safeParse('acme_1').error?.issues[0]?.message).toBe('errors.validation.orgCode'));
  it('trims and lowercases usernames', () => expect(usernameSchema.parse(' Elvin.M ')).toBe('elvin.m'));
  it('rejects Azerbaijani letters in usernames', () =>
    expect(usernameSchema.safeParse('əli').error?.issues[0]?.message).toBe('errors.validation.username'));
  it('trims and lowercases emails', () => expect(emailSchema.parse(' Owner@Acme.AZ ')).toBe('owner@acme.az'));
  it('rejects invalid emails', () =>
    expect(emailSchema.safeParse('not-an-email').error?.issues[0]?.message).toBe('errors.validation.email'));
});
