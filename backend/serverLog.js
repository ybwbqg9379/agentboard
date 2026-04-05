/**
 * HTTP handler logging to stderr. Prefer over ad-hoc console.error so
 * X-Request-Id correlation matches `http/createApp.js` error handler.
 *
 * @param {string} scope Short tag (e.g. 'sessions').
 * @param {import('express').Request | undefined} req
 * @param {string} message
 * @param {unknown} [err]
 */
export function logHttpError(scope, req, message, err) {
  const rid = req?.requestId ?? '(no-request-id)';
  if (err !== undefined) {
    console.error(`[${scope}] ${message}`, rid, err);
  } else {
    console.error(`[${scope}] ${message}`, rid);
  }
}
