// Small close delay keeps the same socket alive across React StrictMode's dev-only remounts.
const DEFAULT_CLOSE_DELAY_MS = 100;
const SOCKET_EVENT_TYPES = ['open', 'message', 'error', 'close'];

const channels = new Map();

function createChannel(url) {
  return {
    url,
    socket: null,
    refCount: 0,
    closeTimer: null,
    listeners: {
      open: new Set(),
      message: new Set(),
      error: new Set(),
      close: new Set(),
    },
  };
}

function getChannel(url) {
  let channel = channels.get(url);
  if (!channel) {
    channel = createChannel(url);
    channels.set(url, channel);
  }
  return channel;
}

function pruneChannel(url, channel) {
  if (channel.refCount !== 0 || channel.socket || channel.closeTimer) return;
  const hasListeners = SOCKET_EVENT_TYPES.some((type) => channel.listeners[type].size > 0);
  if (!hasListeners) {
    channels.delete(url);
  }
}

function dispatch(channel, type, event) {
  for (const listener of [...channel.listeners[type]]) {
    listener(event);
  }
}

function bindChannelSocket(channel, socket) {
  for (const type of SOCKET_EVENT_TYPES) {
    socket.addEventListener(type, (event) => {
      if (channel.socket !== socket) return;
      if (type === 'close') {
        channel.socket = null;
      }
      dispatch(channel, type, event);
      if (type === 'close') {
        pruneChannel(channel.url, channel);
      }
    });
  }
}

function ensureSocket(channel) {
  const existing = channel.socket;
  if (existing && existing.readyState !== WebSocket.CLOSED) {
    return existing;
  }

  const socket = new WebSocket(channel.url);
  channel.socket = socket;
  bindChannelSocket(channel, socket);
  return socket;
}

export function acquireSharedWebSocket(url, options = {}) {
  const closeDelayMs = options.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
  const channel = getChannel(url);
  let released = false;

  channel.refCount += 1;
  clearTimeout(channel.closeTimer);
  channel.closeTimer = null;
  ensureSocket(channel);

  return {
    addEventListener(type, listener) {
      const listenerSet = channel.listeners[type];
      if (!listenerSet) {
        throw new Error(`unsupported shared websocket event: ${type}`);
      }

      listenerSet.add(listener);
      return () => {
        listenerSet.delete(listener);
        pruneChannel(url, channel);
      };
    },

    getSocket() {
      return ensureSocket(channel);
    },

    release() {
      if (released) return;
      released = true;

      channel.refCount = Math.max(0, channel.refCount - 1);
      if (channel.refCount !== 0) return;

      clearTimeout(channel.closeTimer);
      channel.closeTimer = globalThis.setTimeout(() => {
        channel.closeTimer = null;
        if (channel.refCount !== 0) return;

        const socket = channel.socket;
        channel.socket = null;
        if (socket && socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        } else {
          pruneChannel(url, channel);
        }
      }, closeDelayMs);
    },
  };
}

export function __resetSharedWebSocketsForTests() {
  for (const [url, channel] of channels) {
    clearTimeout(channel.closeTimer);
    channel.closeTimer = null;
    if (channel.socket && channel.socket.readyState !== WebSocket.CLOSED) {
      channel.socket.close();
    }
    channel.socket = null;
    for (const type of SOCKET_EVENT_TYPES) {
      channel.listeners[type].clear();
    }
    channel.refCount = 0;
    channels.delete(url);
  }
}
