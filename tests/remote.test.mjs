import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteStore } from '../src/remote.js';

const config = {
  supabaseUrl: 'https://hall.supabase.co',
  supabasePublishableKey: 'sb_publishable_example',
  bookerEmail: 'booking@example.test',
  displayEmail: 'display@example.test',
  timeZone: 'Asia/Shanghai',
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    contents: () => [...values.values()].join(' '),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authResponse(accessToken = 'access-1', refreshToken = 'refresh-1') {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    user: { id: 'user-1', email: config.bookerEmail },
  };
}

function scriptedFetch(...replies) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    const next = replies.shift();
    assert.ok(next, `Unexpected HTTP request: ${url}`);
    return typeof next === 'function' ? next(url, options) : next;
  };
  return { fetch, calls, remaining: () => replies.length };
}

function makeStore(network, storage = memoryStorage(), now = () => 1_700_000_000_000) {
  return createRemoteStore(config, { fetch: network.fetch, storage, now });
}

async function signedInStore(...laterReplies) {
  const network = scriptedFetch(
    jsonResponse(authResponse()),
    jsonResponse([{ role: 'booker' }]),
    ...laterReplies,
  );
  const storage = memoryStorage();
  const store = makeStore(network, storage);
  await store.signIn('booker', 'department-password');
  return { store, network, storage };
}

test('sign-in resolves the configured email, verifies database role, and never stores the password', async () => {
  const { store, network, storage } = await signedInStore();
  assert.equal(store.getRole(), 'booker');
  assert.equal(network.calls[0].url.pathname, '/auth/v1/token');
  assert.equal(network.calls[0].url.searchParams.get('grant_type'), 'password');
  assert.deepEqual(JSON.parse(network.calls[0].options.body), {
    email: config.bookerEmail,
    password: 'department-password',
  });
  assert.equal(network.calls[1].url.pathname, '/rest/v1/app_roles');
  assert.equal(network.calls[1].options.headers.Authorization, 'Bearer access-1');
  assert.match(storage.contents(), /refresh-1/);
  assert.doesNotMatch(storage.contents(), /department-password/);
  assert.equal(network.remaining(), 0);
});

test('role mismatch rejects sign-in and discards tokens', async () => {
  const network = scriptedFetch(
    jsonResponse(authResponse()),
    jsonResponse([{ role: 'display' }]),
  );
  const storage = memoryStorage();
  const store = makeStore(network, storage);
  await assert.rejects(store.signIn('booker', 'password'), { code: 'PERMISSION' });
  assert.equal(store.getRole(), null);
  assert.equal(storage.contents(), '');
});

test('incomplete auth response cannot create a session', async () => {
  const network = scriptedFetch(jsonResponse({ ...authResponse(), refresh_token: '' }));
  const storage = memoryStorage();
  const store = makeStore(network, storage);
  await assert.rejects(store.signIn('booker', 'password'), { code: 'AUTH' });
  assert.equal(store.getRole(), null);
  assert.equal(storage.contents(), '');
  assert.equal(network.remaining(), 0);
});

test('restoreSession refreshes an expired token and verifies the saved role', async () => {
  const storage = memoryStorage();
  const initialNetwork = scriptedFetch(
    jsonResponse(authResponse()),
    jsonResponse([{ role: 'booker' }]),
  );
  await makeStore(initialNetwork, storage).signIn('booker', 'password');
  const network = scriptedFetch(
    jsonResponse(authResponse('access-2', 'refresh-2')),
    jsonResponse([{ role: 'booker' }]),
  );
  const store = createRemoteStore(config, {
    fetch: network.fetch,
    storage,
    now: () => 1_700_004_000_000,
  });
  assert.equal(await store.restoreSession(), 'booker');
  assert.equal(store.getRole(), 'booker');
  assert.equal(network.calls[0].url.searchParams.get('grant_type'), 'refresh_token');
  assert.deepEqual(JSON.parse(network.calls[0].options.body), { refresh_token: 'refresh-1' });
  assert.equal(network.calls[1].options.headers.Authorization, 'Bearer access-2');
  assert.match(storage.contents(), /refresh-2/);
});

test('expired refresh token clears the saved session', async () => {
  const storage = memoryStorage();
  const initialNetwork = scriptedFetch(
    jsonResponse(authResponse()),
    jsonResponse([{ role: 'booker' }]),
  );
  await makeStore(initialNetwork, storage).signIn('booker', 'password');
  const network = scriptedFetch(jsonResponse({ error: 'invalid_grant' }, 401));
  const store = createRemoteStore(config, {
    fetch: network.fetch,
    storage,
    now: () => 1_700_004_000_000,
  });
  assert.equal(await store.restoreSession(), null);
  assert.equal(store.getRole(), null);
  assert.equal(storage.contents(), '');
});

test('listBookings requests only confirmed overlaps in UTC order', async () => {
  const row = {
    id: 'booking-1', title: 'Planning', booker: 'Lin',
    starts_at: '2026-10-01T01:00:00Z', ends_at: '2026-10-01T02:00:00Z',
    remark: '', status: 'confirmed', created_at: '2026-09-29T01:00:00Z',
    updated_at: '2026-09-29T01:00:00Z',
  };
  const { store, network } = await signedInStore(jsonResponse([row]));
  const result = await store.listBookings('2026-09-30T16:00:00Z', '2026-10-01T16:00:00Z');
  assert.deepEqual(result, [row]);
  const query = network.calls[2].url.searchParams;
  assert.equal(query.get('status'), 'eq.confirmed');
  assert.equal(query.get('starts_at'), 'lt.2026-10-01T16:00:00Z');
  assert.equal(query.get('ends_at'), 'gt.2026-09-30T16:00:00Z');
  assert.equal(query.get('order'), 'starts_at.asc');
});

test('listBookings fetches every page when the API limits the first response', async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    id: `booking-${index}`, status: 'confirmed',
    starts_at: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 60_000).toISOString(),
  }));
  const finalBooking = {
    id: 'booking-500', status: 'confirmed', starts_at: '2026-10-01T08:20:00.000Z',
  };
  const { store, network } = await signedInStore(
    jsonResponse(firstPage),
    jsonResponse([finalBooking]),
  );
  const result = await store.listBookings('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
  assert.equal(result.length, 501);
  assert.equal(result.at(-1).id, 'booking-500');
  assert.equal(network.calls[2].url.searchParams.get('limit'), '500');
  assert.equal(network.calls[2].url.searchParams.get('offset'), '0');
  assert.equal(network.calls[3].url.searchParams.get('offset'), '500');
  assert.equal(network.remaining(), 0);
});

test('a 401 on a data request refreshes once and retries with the new bearer token', async () => {
  const { store, network } = await signedInStore(
    jsonResponse({ message: 'JWT expired' }, 401),
    jsonResponse(authResponse('access-2', 'refresh-2')),
    jsonResponse([]),
  );
  assert.deepEqual(await store.listBookings('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), []);
  assert.equal(network.calls[2].options.headers.Authorization, 'Bearer access-1');
  assert.equal(network.calls[4].options.headers.Authorization, 'Bearer access-2');
  assert.equal(network.remaining(), 0);
});

test('create and update transmit only editable booking fields', async () => {
  const created = {
    id: 'booking-1', title: 'Planning', booker: 'Lin',
    starts_at: '2026-10-01T01:00:00Z', ends_at: '2026-10-01T02:00:00Z',
    remark: '', status: 'confirmed', created_at: '2026-09-29T01:00:00Z',
    updated_at: '2026-09-29T01:00:00Z',
  };
  const changed = { ...created, title: 'Updated' };
  const { store, network } = await signedInStore(
    jsonResponse([created], 201),
    jsonResponse([changed]),
  );
  assert.deepEqual(await store.createBooking({ ...created, id: 'forged-id' }), created);
  assert.deepEqual(await store.updateBooking('booking-1', { title: 'Updated', status: 'cancelled' }), changed);
  assert.equal(network.calls[2].options.method, 'POST');
  assert.equal(network.calls[3].options.method, 'PATCH');
  assert.equal(network.calls[3].url.searchParams.get('id'), 'eq.booking-1');
  assert.deepEqual(JSON.parse(network.calls[2].options.body), {
    title: 'Planning', booker: 'Lin', starts_at: '2026-10-01T01:00:00Z',
    ends_at: '2026-10-01T02:00:00Z', remark: '',
  });
  assert.deepEqual(JSON.parse(network.calls[3].options.body), { title: 'Updated' });
});

test('cancelBooking marks a row cancelled without deleting it', async () => {
  const cancelled = { id: 'booking-1', status: 'cancelled' };
  const { store, network } = await signedInStore(jsonResponse([cancelled]));
  assert.deepEqual(await store.cancelBooking('booking-1'), cancelled);
  assert.equal(network.calls[2].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(network.calls[2].options.body), { status: 'cancelled' });
});

test('database conflict and validation errors have stable codes', async () => {
  const { store } = await signedInStore(
    jsonResponse({ code: '23P01', message: 'overlap' }, 409),
    jsonResponse({ code: '23514', message: 'outside hours' }, 400),
  );
  const payload = {
    title: 'Planning', booker: 'Lin', starts_at: '2026-10-01T01:00:00Z',
    ends_at: '2026-10-01T02:00:00Z', remark: '',
  };
  await assert.rejects(store.createBooking(payload), { code: 'CONFLICT' });
  await assert.rejects(store.createBooking(payload), { code: 'VALIDATION' });
});

test('network failures receive a stable NETWORK code', async () => {
  const { store } = await signedInStore(() => Promise.reject(new TypeError('offline')));
  await assert.rejects(store.listBookings('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'), {
    code: 'NETWORK',
  });
});

test('signOut clears local credentials even when logout cannot reach the server', async () => {
  const { store, storage, network } = await signedInStore(() => Promise.reject(new TypeError('offline')));
  await store.signOut();
  assert.equal(store.getRole(), null);
  assert.equal(storage.contents(), '');
  assert.equal(network.calls[2].url.pathname, '/auth/v1/logout');
  assert.equal(network.calls[2].url.searchParams.get('scope'), 'local');
});
