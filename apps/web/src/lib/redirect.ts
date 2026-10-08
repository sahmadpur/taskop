/** Returns the value only if it is a same-origin absolute path; otherwise null. */
export function safeRedirectPath(value: string | undefined): string | null {
  if (!value || !/^\/(?![/\\])/.test(value)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  return value;
}
