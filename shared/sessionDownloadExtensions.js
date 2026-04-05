/**
 * Single source of truth for session file download allowlist (basename-only API).
 * Imported by `backend/http/routes/sessions.js` and `frontend/src/lib/sessionDownloads.js`.
 */
export const SESSION_FILE_DOWNLOAD_EXTENSIONS = [
  '.pdf',
  '.csv',
  '.json',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
];
