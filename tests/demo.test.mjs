import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore } from '../src/demo.js';

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

const first = {
  title: 'Daily standup', booker: 'Felix', remark: '',
  starts_at: '2026-10-01T01:00:00.000Z',
  ends_at: '2026-10-01T01:30:00.000Z',
};
const day = ['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'];

test('demo bookings persist only in one browser storage and conflicts are rejected', async () => {
  const bookingStorage = memoryStorage();
  const a = createDemoStore({ bookingStorage, sessionStorage: memoryStorage() });
  await a.signIn('booker', 'preview');
  const saved = await a.createBooking(first);
  await assert.rejects(a.createBooking({ ...first, title: 'Conflict' }), { code: 'CONFLICT' });
  const b = createDemoStore({ bookingStorage, sessionStorage: memoryStorage() });
  await b.signIn('display', 'preview');
  assert.deepEqual((await b.listBookings(...day)).map((item) => item.id), [saved.id]);
  await assert.rejects(b.cancelBooking(saved.id), { code: 'PERMISSION' });
  await a.cancelBooking(saved.id);
  assert.deepEqual(await b.listBookings(...day), []);
  const otherBrowser = createDemoStore({ bookingStorage: memoryStorage(), sessionStorage: memoryStorage() });
  await otherBrowser.signIn('display', 'preview');
  assert.deepEqual(await otherBrowser.listBookings(...day), []);
});

test('demo session restores in the same browser tab and sign-out clears it', async () => {
  const sessionStorage = memoryStorage();
  const options = { bookingStorage: memoryStorage(), sessionStorage };
  const a = createDemoStore(options);
  await a.signIn('booker', 'preview');
  const b = createDemoStore(options);
  assert.equal(await b.restoreSession(), 'booker');
  await b.signOut();
  assert.equal(await createDemoStore(options).restoreSession(), null);
});
