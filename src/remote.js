// Supabase REST/Auth adapter. Only a refresh token and its role are persisted;
// access tokens stay in memory, and passwords are never stored.

const EDITABLE_FIELDS = ['title', 'booker', 'starts_at', 'ends_at', 'remark'];
const REFRESH_EARLY_MS = 60_000;
const BOOKING_PAGE_SIZE = 500;
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

function storeError(code, message, cause, dbCode) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  if (dbCode) error.dbCode = dbCode;
  return error;
}

function defaultStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Storage may be disabled by browser privacy settings.
  }
  const memory = new Map();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
}

function configuredUrl(config) {
  try {
    const url = new URL(config?.supabaseUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol');
    return url.href.replace(/\/$/, '');
  } catch {
    throw storeError('CONFIG', 'Supabase URL is missing or invalid.');
  }
}

function validateConfig(config) {
  const baseUrl = configuredUrl(config);
  const key = config?.supabasePublishableKey;
  if (typeof key !== 'string' || !key.trim() || key.startsWith('sb_secret_')) {
    throw storeError('CONFIG', 'A Supabase publishable key is required.');
  }
  return { baseUrl, key };
}

function mapHttpError(status, data, isAuth = false) {
  const dbCode = typeof data?.code === 'string' ? data.code : null;
  const message = data?.message || data?.error_description || data?.error || `HTTP ${status}`;
  if (dbCode === '23P01' || dbCode === '23505' || status === 409) {
    return storeError('CONFLICT', message, null, dbCode);
  }
  if (status === 401 || (isAuth && status === 400)) return storeError('AUTH', message, null, dbCode);
  if (status === 403 || dbCode === '42501') return storeError('PERMISSION', message, null, dbCode);
  if (status === 400 || dbCode?.startsWith('22') || dbCode?.startsWith('23')) {
    return storeError('VALIDATION', message, null, dbCode);
  }
  if (status >= 500) return storeError('NETWORK', 'Supabase is unavailable.', null, dbCode);
  return storeError('REMOTE', message, null, dbCode);
}

function pickEditable(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw storeError('VALIDATION', 'A booking payload is required.');
  }
  return Object.fromEntries(EDITABLE_FIELDS.filter((key) =>
    Object.hasOwn(payload, key)).map((key) => [key, payload[key]]));
}

function validateId(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw storeError('VALIDATION', 'A booking id is required.');
  }
}

function validateRange(fromISO, toISO) {
  const from = Date.parse(fromISO);
  const to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw storeError('VALIDATION', 'A valid UTC time range is required.');
  }
}

function validateTokens(tokens) {
  if (typeof tokens?.access_token !== 'string' || !tokens.access_token ||
      typeof tokens?.refresh_token !== 'string' || !tokens.refresh_token ||
      !Number.isFinite(Number(tokens?.expires_in)) || Number(tokens.expires_in) <= 0) {
    throw storeError('AUTH', 'Supabase returned an incomplete session.');
  }
  return tokens;
}

export function createRemoteStore(config, deps = {}) {
  const { baseUrl, key } = validateConfig(config);
  const clientRole = deps.role;
  if (!['booker', 'display'].includes(clientRole)) {
    throw storeError('CONFIG', 'A booker or display client role is required.');
  }
  const fetchImpl = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImpl !== 'function') throw storeError('CONFIG', 'Fetch is unavailable.');
  const storage = deps.storage ?? defaultStorage();
  const now = deps.now ?? Date.now;
  const legacyStorageKey = `ai-heroes-hall:session:${new URL(baseUrl).host}`;
  const storageKey = `${legacyStorageKey}:${clientRole}`;
  let session = null;
  let refreshPromise = null;

  function clearSession() {
    session = null;
    try { storage.removeItem(storageKey); } catch { /* In-memory state is already cleared. */ }
  }

  function saveSession(tokens, role) {
    validateTokens(tokens);
    session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: now() + Number(tokens.expires_in) * 1000,
      role,
    };
    try {
      storage.setItem(storageKey, JSON.stringify({ refreshToken: session.refreshToken, role }));
    } catch {
      // A storage-denied browser can still use this tab until it closes.
    }
  }

  async function request(path, { method = 'GET', token = null, body, prefer, isAuth = false } = {}) {
    const headers = { apikey: key, Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw storeError('NETWORK', 'Cannot reach Supabase.', cause);
    }
    let data = null;
    try {
      const raw = await response.text();
      if (raw) data = JSON.parse(raw);
    } catch (cause) {
      throw storeError('NETWORK', 'Invalid response from Supabase.', cause);
    }
    if (!response.ok) throw mapHttpError(response.status, data, isAuth);
    return data;
  }

  async function requestTokens(grantType, body) {
    const tokens = await request(`/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST', body, isAuth: true,
    });
    return validateTokens(tokens);
  }

  async function verifyRole(expectedRole, accessToken) {
    const rows = await request('/rest/v1/app_roles?select=role&limit=1', {
      token: accessToken,
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.role !== expectedRole) {
      throw storeError('PERMISSION', 'This account does not have the requested role.');
    }
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const previous = session;
    if (!previous?.refreshToken) throw storeError('AUTH', 'Please sign in again.');
    refreshPromise = (async () => {
      try {
        const tokens = await requestTokens('refresh_token', {
          refresh_token: previous.refreshToken,
        });
        saveSession(tokens, previous.role);
        return session.accessToken;
      } catch (error) {
        if (error.code === 'AUTH') clearSession();
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function ensureAccess() {
    if (!session) {
      const role = await restoreSession();
      if (!role) throw storeError('AUTH', 'Please sign in again.');
    }
    if (session.expiresAt <= now() + REFRESH_EARLY_MS) await refresh();
    return session.accessToken;
  }

  async function authorizedRequest(path, options = {}) {
    const token = await ensureAccess();
    try {
      return await request(path, { ...options, token });
    } catch (error) {
      if (error.code !== 'AUTH') throw error;
      const nextToken = await refresh();
      try {
        return await request(path, { ...options, token: nextToken });
      } catch (retryError) {
        if (retryError.code === 'AUTH') clearSession();
        throw retryError;
      }
    }
  }

  async function requireBooker() {
    await ensureAccess();
    if (session.role !== 'booker') throw storeError('PERMISSION', 'Booking access is required.');
  }

  async function signIn(role, password) {
    if (role !== clientRole || typeof password !== 'string' || !password) {
      throw storeError('VALIDATION', 'A role and password are required.');
    }
    const email = role === 'booker' ? config.bookerEmail : config.displayEmail;
    if (typeof email !== 'string' || !email.trim()) {
      throw storeError('CONFIG', `The ${role} email is not configured.`);
    }
    clearSession();
    const tokens = await requestTokens('password', { email, password });
    try {
      await verifyRole(role, tokens.access_token);
      saveSession(tokens, role);
    } catch (error) {
      clearSession();
      throw error;
    }
    return role;
  }

  async function restoreSession() {
    if (session) return session.role;
    let saved;
    try {
      let raw = storage.getItem(storageKey);
      if (raw === null) {
        const legacyRaw = storage.getItem(legacyStorageKey);
        let legacy = null;
        try { legacy = JSON.parse(legacyRaw); } catch { /* Keep malformed legacy data untouched. */ }
        if (legacy?.role === clientRole &&
            typeof legacy.refreshToken === 'string' && legacy.refreshToken) {
          try {
            storage.setItem(storageKey, legacyRaw);
            storage.removeItem(legacyStorageKey);
          } catch {
            // Keep the old token if storage becomes read-only during migration.
          }
          raw = legacyRaw;
        }
      }
      saved = JSON.parse(raw ?? 'null');
    } catch {
      clearSession();
      return null;
    }
    if (!saved || saved.role !== clientRole ||
        typeof saved.refreshToken !== 'string' || !saved.refreshToken) {
      clearSession();
      return null;
    }
    session = { accessToken: null, refreshToken: saved.refreshToken, expiresAt: 0, role: saved.role };
    try {
      const accessToken = await refresh();
      await verifyRole(saved.role, accessToken);
      return session.role;
    } catch (error) {
      if (error.code === 'AUTH' || error.code === 'PERMISSION') {
        clearSession();
        return null;
      }
      session = null;
      throw error;
    }
  }

  async function signOut() {
    const accessToken = session?.accessToken;
    clearSession();
    if (!accessToken) return;
    try {
      await request('/auth/v1/logout?scope=local', { method: 'POST', token: accessToken });
    } catch {
      // Local sign-out is definitive even while offline.
    }
  }

  function getRole() {
    return session?.role ?? null;
  }

  async function listBookings(fromISO, toISO) {
    validateRange(fromISO, toISO);
    const params = new URLSearchParams({
      select: '*',
      status: 'eq.confirmed',
      starts_at: `lt.${toISO}`,
      ends_at: `gt.${fromISO}`,
      order: 'starts_at.asc',
      limit: String(BOOKING_PAGE_SIZE),
    });
    const rows = [];
    while (true) {
      params.set('offset', String(rows.length));
      const page = await authorizedRequest(`/rest/v1/bookings?${params}`);
      if (!Array.isArray(page)) throw storeError('REMOTE', 'Invalid bookings response.');
      rows.push(...page);
      if (page.length < BOOKING_PAGE_SIZE) break;
    }
    return rows.filter((row) => row.status === 'confirmed')
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  }

  async function listBookerSuggestions() {
    await requireBooker();
    const rows = await authorizedRequest('/rest/v1/booker_suggestions?select=name&order=sort_order.asc');
    if (!Array.isArray(rows) || rows.some((row) =>
      typeof row?.name !== 'string' || !row.name.trim() || row.name.length > 80)) {
      throw storeError('REMOTE', 'Invalid booker suggestions response.');
    }
    return rows.map((row) => row.name.trim())
      .sort((a, b) => NAME_COLLATOR.compare(a, b));
  }

  async function writeBooking(path, method, body) {
    await requireBooker();
    const rows = await authorizedRequest(path, {
      method, body, prefer: 'return=representation',
    });
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw storeError('NOT_FOUND', 'Booking was not found.');
    }
    return rows[0];
  }

  async function createBooking(payload) {
    const body = pickEditable(payload);
    for (const field of ['title', 'booker', 'starts_at', 'ends_at']) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        throw storeError('VALIDATION', `${field} is required.`);
      }
    }
    validateRange(body.starts_at, body.ends_at);
    return writeBooking('/rest/v1/bookings', 'POST', body);
  }

  async function updateBooking(id, payload) {
    validateId(id);
    const body = pickEditable(payload);
    if (!Object.keys(body).length) throw storeError('VALIDATION', 'No booking changes were provided.');
    return writeBooking(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`, 'PATCH', body);
  }

  async function cancelBooking(id) {
    validateId(id);
    return writeBooking(`/rest/v1/bookings?id=eq.${encodeURIComponent(id)}`,
      'PATCH', { status: 'cancelled' });
  }

  return { signIn, restoreSession, signOut, getRole, listBookings, listBookerSuggestions,
    createBooking, updateBooking, cancelBooking };
}
