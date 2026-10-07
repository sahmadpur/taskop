import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('accepts same-origin paths', () => {
    expect(safeRedirectPath('/users')).toBe('/users');
    expect(safeRedirectPath('/users?x=1#y')).toBe('/users?x=1#y');
  });
  it('rejects everything else', () => {
    expect(safeRedirectPath('//evil.com')).toBeNull();
    expect(safeRedirectPath('/\\evil.com')).toBeNull();
    expect(safeRedirectPath('https://evil.com')).toBeNull();
    expect(safeRedirectPath('/\nfoo')).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
  });
});
