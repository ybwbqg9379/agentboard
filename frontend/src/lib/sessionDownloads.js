import { SESSION_FILE_DOWNLOAD_EXTENSIONS } from '@shared/sessionDownloadExtensions.js';

/** Same allowlist as backend `sessions` download route (see `shared/sessionDownloadExtensions.js`; Vite alias `@shared`). */
export const SESSION_DOWNLOADABLE_EXT = new Set(SESSION_FILE_DOWNLOAD_EXTENSIONS);

/**
 * @param {string} name File basename or path
 */
export function isSessionDownloadableFileName(name) {
  if (!name || typeof name !== 'string') return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return SESSION_DOWNLOADABLE_EXT.has(name.slice(dot).toLowerCase());
}

/**
 * @param {string} sessionId
 * @param {string} filePath Session-relative path or workspace path captured in tool events
 */
export function sessionFileDownloadHref(sessionId, filePath) {
  return `/api/sessions/${sessionId}/files?path=${encodeURIComponent(filePath)}`;
}
