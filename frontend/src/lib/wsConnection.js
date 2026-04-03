/**
 * Shared WebSocket keepalive defaults used by useWebSocket and WorkflowEditor.
 */

export const WS_RECONNECT_MS = 3000;
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
export const WS_PONG_TIMEOUT_MS = 45_000;

/**
 * Mark that inbound or handshake activity occurred (resets idle deadline for heartbeat).
 * @param {{ current: number }} lastActivityRef
 */
export function touchWsLastActivity(lastActivityRef) {
  lastActivityRef.current = Date.now();
}

/**
 * Start periodic `ping` and force-close if no inbound traffic within the pong window.
 * Call `clearInterval` on the returned id when the socket is closed or replaced.
 *
 * @param {WebSocket} ws
 * @param {{ current: number }} lastActivityRef
 * @param {object} [options]
 * @param {number} [options.intervalMs]
 * @param {number} [options.pongTimeoutMs]
 * @param {string} [options.logLabel] — if set, logs `pong timeout` before `ws.close()`
 * @returns {ReturnType<typeof setInterval>}
 */
export function startWsHeartbeat(ws, lastActivityRef, options = {}) {
  const intervalMs = options.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const pongTimeoutMs = options.pongTimeoutMs ?? WS_PONG_TIMEOUT_MS;
  const logLabel = options.logLabel;

  touchWsLastActivity(lastActivityRef);

  return setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastActivityRef.current > pongTimeoutMs) {
      if (logLabel) {
        console.warn(`[${logLabel}] pong timeout, forcing reconnect`);
      }
      ws.close();
      return;
    }
    ws.send('ping');
  }, intervalMs);
}

/**
 * @param {() => void} callback
 * @param {number} [delayMs]
 * @returns {ReturnType<typeof setTimeout>}
 */
export function scheduleWsReconnect(callback, delayMs = WS_RECONNECT_MS) {
  return setTimeout(callback, delayMs);
}
