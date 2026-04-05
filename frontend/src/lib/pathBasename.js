/**
 * Last path segment after normalizing `\` to `/` (agent paths may be POSIX or Windows-style).
 * Trailing slashes are stripped so directory-like paths do not yield an empty segment.
 */
export function fileBasename(p) {
  if (typeof p !== 'string' || !p) return '';
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/');
  const last = parts[parts.length - 1];
  return last || normalized;
}
