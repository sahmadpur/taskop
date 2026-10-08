import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  DATABASE_APP_URL: 'postgres://a:b@localhost:5432/taskop',
  DATABASE_PLATFORM_URL: 'postgres://c:d@localhost:5432/taskop',
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----',
  WEB_URL: 'http://localhost:5173',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'Taskop <no-reply@taskop.local>',
};

describe('loadConfig', () => {
  it('applies defaults and unescapes PEM newlines', () => {
    const c = loadConfig(valid);
    expect(c.PORT).toBe(3000);
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.ARGON2_MEMORY_KIB).toBe(19456);
    expect(c.JWT_PRIVATE_KEY).toContain('\nabc\n');
  });
  it('parses booleans', () => expect(loadConfig({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false));
  it('names missing variables', () => {
    expect(() => loadConfig({ ...valid, DATABASE_APP_URL: undefined })).toThrow(/DATABASE_APP_URL/);
  });
});
