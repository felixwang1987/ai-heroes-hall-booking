const BOOKINGS_KEY = 'ai-heroes-hall-demo-bookings-v1';
const ROLE_KEY = 'ai-heroes-hall-demo-role-v1';

function storeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeStorage(storage, fallback = new Map()) {
  return {
    getItem(key) {
      try { return storage?.getItem(key) ?? fallback.get(key) ?? null; }
      catch { return fallback.get(key) ?? null; }
    },
    setItem(key, value) {
      fallback.set(key, value);
      try { storage?.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
    },
    removeItem(key) {
      fallback.delete(key);
      try { storage?.removeItem(key); } catch { /* Keep the in-memory fallback. */ }
    },
  };
}

export function createDemoStore({
  bookingStorage = typeof localStorage === 'undefined' ? null : localStorage,
  sessionStorage: session = typeof sessionStorage === 'undefined' ? null : sessionStorage,
} = {}) {
  const bookingsStore = safeStorage(bookingStorage);
  const roleStore = safeStorage(session);
  let role = null;

  function readBookings() {
    try {
      const parsed = JSON.parse(bookingsStore.getItem(BOOKINGS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function saveBookings(bookings) {
    bookingsStore.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
  }

  function requireBooker() {
    if (role !== 'booker') throw storeError('PERMISSION', '请先进入预订模式。');
  }

  function assertNoOverlap(payload, excludeId) {
    const conflict = readBookings().some((booking) =>
      booking.status === 'confirmed' && booking.id !== excludeId &&
      Date.parse(payload.starts_at) < Date.parse(booking.ends_at) &&
      Date.parse(payload.ends_at) > Date.parse(booking.starts_at));
    if (conflict) throw storeError('CONFLICT', '此时间段已有会议。');
  }

  return {
    async signIn(nextRole, password) {
      if (!['booker', 'display'].includes(nextRole) || !String(password ?? '').trim()) {
        throw storeError('AUTH', '演示模式请填写任意非空密码。');
      }
      role = nextRole;
      roleStore.setItem(ROLE_KEY, role);
      return role;
    },
    async restoreSession() {
      const saved = roleStore.getItem(ROLE_KEY);
      role = saved === 'booker' || saved === 'display' ? saved : null;
      return role;
    },
    async signOut() {
      role = null;
      roleStore.removeItem(ROLE_KEY);
    },
    getRole() { return role; },
    async listBookings(fromISO, toISO) {
      if (!role) throw storeError('AUTH', '请先登录。');
      return readBookings()
        .filter((booking) => booking.status === 'confirmed' &&
          Date.parse(booking.starts_at) < Date.parse(toISO) &&
          Date.parse(booking.ends_at) > Date.parse(fromISO))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    },
    async createBooking(payload) {
      requireBooker();
      assertNoOverlap(payload);
      const now = new Date().toISOString();
      const booking = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        title: payload.title,
        booker: payload.booker,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
        remark: payload.remark ?? '',
        status: 'confirmed',
        created_at: now,
        updated_at: now,
      };
      saveBookings([...readBookings(), booking]);
      return booking;
    },
    async updateBooking(id, payload) {
      requireBooker();
      const bookings = readBookings();
      const index = bookings.findIndex((booking) => booking.id === id && booking.status === 'confirmed');
      if (index < 0) throw storeError('VALIDATION', '未找到这条预约。');
      assertNoOverlap(payload, id);
      bookings[index] = { ...bookings[index], ...payload, updated_at: new Date().toISOString() };
      saveBookings(bookings);
      return bookings[index];
    },
    async cancelBooking(id) {
      requireBooker();
      const bookings = readBookings();
      const index = bookings.findIndex((booking) => booking.id === id && booking.status === 'confirmed');
      if (index < 0) throw storeError('VALIDATION', '未找到这条预约。');
      bookings[index] = { ...bookings[index], status: 'cancelled', updated_at: new Date().toISOString() };
      saveBookings(bookings);
      return bookings[index];
    },
  };
}
