const DEFAULT_USER_ID = 'default';
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function getLocationSearch(search) {
  if (typeof search === 'string') return search;
  if (typeof window !== 'undefined') return window.location.search;
  return '';
}

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined') return window.localStorage;
  return null;
}

function getQueryParam(search, keys) {
  const params = new URLSearchParams(getLocationSearch(search));
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

export function normalizeUserId(rawUserId) {
  if (typeof rawUserId !== 'string') return null;
  const userId = rawUserId.trim();
  if (!userId) return null;
  return USER_ID_PATTERN.test(userId) ? userId : null;
}

export function getAuthToken({ search, storage } = {}) {
  const queryToken = getQueryParam(search, ['token']);
  if (queryToken) return queryToken;
  return getStorage(storage)?.getItem('agentboard_api_key') || '';
}

export function getUserId({ search, storage } = {}) {
  const resolvedStorage = getStorage(storage);
  const queryUserId = normalizeUserId(getQueryParam(search, ['user_id', 'userId']));
  if (queryUserId) {
    resolvedStorage?.setItem('agentboard_user_id', queryUserId);
    return queryUserId;
  }

  const storedUserId = normalizeUserId(resolvedStorage?.getItem('agentboard_user_id') || '');
  return storedUserId || DEFAULT_USER_ID;
}

export function buildAuthHeaders(initHeaders, options) {
  const headers = new globalThis.Headers(initHeaders || {});
  const token = getAuthToken(options);
  const userId = getUserId(options);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('x-user-id', userId);
  return headers;
}

export function withClientAuth(init = {}, options) {
  return {
    ...init,
    headers: buildAuthHeaders(init.headers, options),
  };
}

export function buildWsUrl(path = '/ws', options = {}) {
  const location =
    options.location ||
    (typeof window !== 'undefined'
      ? window.location
      : { protocol: 'http:', host: 'localhost', search: '' });
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${location.host}${path}`);
  const token = getAuthToken({
    search: options.search ?? location.search,
    storage: options.storage,
  });
  const userId = getUserId({ search: options.search ?? location.search, storage: options.storage });

  if (token) {
    url.searchParams.set('token', token);
  }
  if (userId) {
    url.searchParams.set('user_id', userId);
  }

  return url.toString();
}
