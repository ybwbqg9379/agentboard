/**
 * Last path segment after normalizing `\` to `/` (agent paths may be POSIX or Windows-style).
 */
export function fileBasename(p) {
  if (typeof p !== 'string' || !p) return '';
  const normalized = p.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const last = parts[parts.length - 1];
  return last || normalized;
}
