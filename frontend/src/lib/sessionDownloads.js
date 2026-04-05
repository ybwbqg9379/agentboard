/**
 * Must match backend GET /api/sessions/:id/files/:fileName allowlist.
 */
export const SESSION_DOWNLOADABLE_EXT = new Set([
  '.pdf',
  '.csv',
  '.json',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
]);

/**
 * @param {string} name File basename
 */
export function isSessionDownloadableFileName(name) {
  if (!name || typeof name !== 'string') return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return SESSION_DOWNLOADABLE_EXT.has(name.slice(dot).toLowerCase());
}

/**
 * @param {string} sessionId
 * @param {string} fileName Basename only (API resolves with path.basename)
 */
export function sessionFileDownloadHref(sessionId, fileName) {
  return `/api/sessions/${sessionId}/files/${encodeURIComponent(fileName)}`;
}
