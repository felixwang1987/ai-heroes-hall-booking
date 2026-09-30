import { remoteConfig } from './config.js';
import { createRemoteStore } from './remote.js?v=20260930-3';
import { createDemoStore } from './demo.js?v=20260930-2';
import {
  OFFICE_TIME_ZONE, DAY_START, DAY_END, SLOT_MINUTES,
  officeDateKey, officeTime, toOfficeISO, shiftDateKey, weekStart,
  parseTime, minutesToTime, validateDraft, overlappingBookings, availabilityForDate, statusAt,
} from './domain.js';
import { upcomingHolidays } from './holidays.js';

const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get('mode') === 'display' ? 'display' : 'booking';
const expectedRole = mode === 'display' ? 'display' : 'booker';
const configured = Boolean(remoteConfig.supabaseUrl && remoteConfig.supabasePublishableKey &&
  remoteConfig.bookerEmail && remoteConfig.displayEmail);
const store = configured ? createRemoteStore(remoteConfig, { role: expectedRole }) : createDemoStore();

const state = {
  role: null,
  bookings: [],
  week: weekStart(officeDateKey()),
  view: 'week',
  selectedDate: officeDateKey(),
  editingId: null,
  cancelArmedId: null,
  lastSync: null,
  loadedFrom: null,
  loadedTo: null,
  syncError: null,
  refreshing: false,
  refreshQueued: false,
  refreshId: 0,
  pendingBooking: false,
};
let suggestionsRequestId = 0;
let bookerSuggestions = [];
let visibleBookerSuggestions = [];
let activeBookerSuggestion = -1;
let suggestionEscapePending = false;

document.body.dataset.mode = mode;

function make(tag, className = '', content = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== '') element.textContent = content;
  return element;
}

function setText(id, value) { $(id).textContent = value; }

function formatDate(dateKey, options = {}) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', ...options }).format(date);
}

function formatRange(booking) {
  return `${officeTime(new Date(booking.starts_at))}–${officeTime(new Date(booking.ends_at))}`;
}

function bookingsFor(dateKey) {
  return state.bookings.filter((booking) => officeDateKey(new Date(booking.starts_at)) === dateKey)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

function hasBookerAccess() { return state.role === 'booker' && mode === 'booking'; }

function closeBookerSuggestions() {
  const input = $('bookerName');
  const list = $('bookerSuggestions');
  const toggle = $('bookerSuggestionsToggle');
  list.hidden = true;
  list.replaceChildren();
  visibleBookerSuggestions = [];
  activeBookerSuggestion = -1;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', '展开预订人名单');
  setText('bookerSuggestionsAnnouncement', '');
}

function closeBookerSuggestionsForEscape() {
  suggestionEscapePending = true;
  closeBookerSuggestions();
  setTimeout(() => { suggestionEscapePending = false; }, 0);
}

function openBookerSuggestions({ all = false } = {}) {
  if (!hasBookerAccess() || !bookerSuggestions.length) return;
  const input = $('bookerName');
  const list = $('bookerSuggestions');
  const toggle = $('bookerSuggestionsToggle');
  const query = all ? '' : input.value.trim().toLocaleLowerCase('en');
  visibleBookerSuggestions = bookerSuggestions.filter((name) =>
    name.toLocaleLowerCase('en').includes(query));
  activeBookerSuggestion = -1;
  input.removeAttribute('aria-activedescendant');
  const options = visibleBookerSuggestions.map((name, index) => {
    const option = make('li', '', name);
    option.id = `bookerSuggestion-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.index = String(index);
    return option;
  });
  if (!options.length) options.push(make('li', 'booker-suggestions-empty',
    '名单中没有匹配的姓名，可直接输入完整姓名。'));
  list.replaceChildren(...options);
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', '收起预订人名单');
  setText('bookerSuggestionsAnnouncement', visibleBookerSuggestions.length
    ? `${visibleBookerSuggestions.length} 位姓名可选，按上下方向键选择；也可直接输入完整姓名。`
    : '名单中没有匹配的姓名，可直接输入完整姓名。');
}

function setActiveBookerSuggestion(index) {
  if (!visibleBookerSuggestions.length) return;
  activeBookerSuggestion = (index + visibleBookerSuggestions.length) % visibleBookerSuggestions.length;
  const options = $('bookerSuggestions').querySelectorAll('[role="option"]');
  options.forEach((option, optionIndex) =>
    option.setAttribute('aria-selected', String(optionIndex === activeBookerSuggestion)));
  const selected = options[activeBookerSuggestion];
  $('bookerName').setAttribute('aria-activedescendant', selected.id);
  selected.scrollIntoView({ block: 'nearest' });
}

function selectBookerSuggestion(index) {
  if (!hasBookerAccess() || index < 0 || index >= visibleBookerSuggestions.length) return;
  const input = $('bookerName');
  input.value = visibleBookerSuggestions[index];
  closeBookerSuggestions();
}

function clearBookerSuggestions() {
  suggestionsRequestId += 1;
  bookerSuggestions = [];
  closeBookerSuggestions();
  $('bookerSuggestionsToggle').hidden = true;
  setText('bookerSuggestionsStatus', '');
  $('bookerSuggestionsStatus').hidden = true;
}

function clearPrivateBookingForm() {
  clearBookerSuggestions();
  if ($('bookingDialog').open) $('bookingDialog').close();
  $('bookingForm').reset();
  state.editingId = null;
  state.cancelArmedId = null;
}

async function loadBookerSuggestions() {
  clearBookerSuggestions();
  if (!hasBookerAccess()) return;
  const requestId = suggestionsRequestId;
  try {
    const names = await store.listBookerSuggestions();
    if (requestId !== suggestionsRequestId || !hasBookerAccess()) return;
    bookerSuggestions = names;
    $('bookerSuggestionsToggle').hidden = names.length === 0;
    if ($('bookingDialog').open && document.activeElement === $('bookerName')) openBookerSuggestions();
  } catch {
    if (requestId !== suggestionsRequestId || !hasBookerAccess()) return;
    setText('bookerSuggestionsStatus', '姓名建议暂不可用，可直接输入全名。');
    $('bookerSuggestionsStatus').hidden = false;
  }
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function showToast(message) {
  setText('toast', message);
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => setText('toast', ''), 4200);
}

function renderAuth() {
  document.body.dataset.auth = state.role ? 'signed-in' : 'signed-out';
  setText('authButton', state.role === 'booker' ? '退出 / Sign out' : '登录 / Sign in');
  $('openBookingBtn').disabled = mode === 'display';
  if (configured) {
    $('demoBanner').hidden = true;
  } else {
    const banner = $('demoBanner');
    banner.hidden = false;
    banner.textContent = '本机演示模式：预约仅保存在此浏览器，不会同步到其他电脑或平板。请按 README 配置 Supabase 后再投入使用。';
  }
}

function renderClock() {
  const now = new Date();
  const today = officeDateKey(now);
  setText('clockReadout', officeTime(now));
  setText('todayLabel', `${formatDate(today, { month: 'long', day: 'numeric', weekday: 'long' })} · 北京时间`);
  if (renderClock.lastDate && renderClock.lastDate !== today) {
    state.week = weekStart(today);
    state.selectedDate = today;
    renderHolidays();
    renderToday();
    renderNext();
    renderAvailability();
    renderSchedule();
    void refresh();
  }
  renderClock.lastDate = today;
  const status = $('roomStatus');
  status.classList.remove('is-available', 'is-busy', 'is-offline');
  if (state.syncError) {
    status.textContent = '同步中断 / Offline';
    status.classList.add('is-offline');
  } else if (!state.role) {
    status.textContent = '待登录 / Sign in';
    status.classList.add('is-offline');
  } else if (!state.lastSync) {
    status.textContent = '正在同步 / Syncing';
    status.classList.add('is-offline');
  } else {
    const { current } = statusAt(bookingsFor(today), now);
    status.textContent = current ? '使用中 / In use' : '可使用 / Available';
    status.classList.add(current ? 'is-busy' : 'is-available');
  }
}

function renderSync() {
  if (state.syncError) {
    setText('syncStatus', `同步失败 · ${state.syncError}`);
  } else if (!state.role) {
    setText('syncStatus', configured ? '登录后同步 / Sign in to sync' : '演示模式 / Demo mode');
  } else if (state.refreshing) {
    setText('syncStatus', '正在同步 / Syncing');
  } else if (state.lastSync) {
    setText('syncStatus', `${configured ? '已同步' : '本机已更新'} · ${officeTime(state.lastSync)}`);
  }
}

function renderHolidays() {
  const container = $('holidayList');
  const holidays = upcomingHolidays(officeDateKey(), 200);
  const periods = [];
  const lastByName = new Map();
  for (const holiday of holidays) {
    const key = `${holiday.region}:${holiday.nameZh}`;
    const previous = lastByName.get(key);
    if (previous && shiftDateKey(previous.end, 1) === holiday.date) {
      previous.end = holiday.date;
    } else {
      const period = { ...holiday, end: holiday.date };
      periods.push(period);
      lastByName.set(key, period);
    }
  }
  periods.sort((a, b) => a.date.localeCompare(b.date) || a.region.localeCompare(b.region));
  if (!periods.length) {
    container.replaceChildren(make('p', 'holiday-placeholder', '暂无已核实的未来节假日 / No verified dates'));
    return;
  }
  const items = periods.slice(0, 5).map((holiday) => {
    const item = make('div', 'holiday-item');
    const info = make('div');
    info.append(make('span', 'holiday-item__name', holiday.nameZh || holiday.nameEn),
      make('span', 'holiday-item__region', holiday.region === 'CN' ? '中国 / China' : '吉打州·居林 / Kedah, Kulim'));
    const dateText = holiday.end === holiday.date
      ? holiday.date.slice(5).replace('-', '/')
      : `${holiday.date.slice(5).replace('-', '/')}–${holiday.end.slice(5).replace('-', '/')}`;
    item.append(info, make('span', 'holiday-item__date', dateText));
    return item;
  });
  container.replaceChildren(...items);
}

function renderToday() {
  const container = $('todayBookings');
  if (!state.role) {
    container.replaceChildren(make('p', 'empty-state', mode === 'display'
      ? '输入平板密码后查看日程 / Sign in to view bookings'
      : '输入部门密码后查看日程 / Sign in to view bookings'));
    return;
  }
  if (!state.lastSync) {
    container.replaceChildren(make('p', 'empty-state', '正在读取会议 / Loading meetings'));
    return;
  }
  const today = officeDateKey();
  const bookings = bookingsFor(today);
  if (!bookings.length) {
    container.replaceChildren(make('p', 'empty-state', '今天暂无预约 / No meetings today'));
    return;
  }
  const rows = bookings.map((booking) => {
    const row = make(hasBookerAccess() ? 'button' : 'div', 'booking-row');
    row.setAttribute('role', 'row');
    if (row.tagName === 'BUTTON') {
      row.type = 'button';
      row.setAttribute('aria-label', `编辑 ${booking.title}，${formatRange(booking)}`);
      row.addEventListener('click', () => openEdit(booking));
    }
    const details = make('span', 'booking-row__details');
    details.append(make('strong', '', booking.title),
      make('small', '', booking.remark?.trim() || '无备注 / No remark'));
    row.append(make('span', 'booking-row__time', formatRange(booking)),
      details, make('span', 'booking-row__booker', booking.booker));
    return row;
  });
  container.replaceChildren(...rows);
}

function renderNext() {
  const target = $('nextMeeting');
  if (!state.role) {
    target.replaceChildren(make('p', 'card-placeholder', '登录后显示 / Sign in to view'));
    return;
  }
  if (!state.lastSync) {
    target.replaceChildren(make('p', 'card-placeholder', '正在读取 / Loading'));
    return;
  }
  const now = new Date();
  const today = bookingsFor(officeDateKey(now));
  const { next } = statusAt(today, now);
  if (!next) {
    target.replaceChildren(make('p', 'card-placeholder', '今天暂无后续会议 / No upcoming meeting today'));
    return;
  }
  target.replaceChildren(make('h4', 'next-meeting-title', next.title),
    make('p', 'next-meeting-time', formatRange(next)),
    make('p', 'next-meeting-booker', `预订人 / Booker: ${next.booker}`));
}

function fillAvailability(container, dateKey, excludeId = null) {
  if (!state.loadedFrom || dateKey < state.loadedFrom || dateKey > state.loadedTo) {
    container.replaceChildren(make('span', 'availability-prompt', '正在读取可用时段 / Loading'));
    return;
  }
  const bookings = excludeId ? state.bookings.filter((booking) => booking.id !== excludeId) : state.bookings;
  const segments = availabilityForDate(bookings, dateKey);
  container.replaceChildren(...segments.map((slot) => {
    const bar = make('span', `availability-segment ${slot.status}`);
    bar.title = `${slot.start}–${slot.end} · ${slot.status === 'available' ? '可用' : slot.status === 'booked' ? '已预订' : '午休'}`;
    return bar;
  }));
  const available = segments.filter((slot) => slot.status === 'available').length;
  container.setAttribute('aria-label', `${dateKey}：${available} 个可预约半小时档位`);
}

function renderAvailability() {
  const todayBar = $('availabilityBar');
  const bookingBar = $('bookingAvailabilityBar');
  if (!state.role) {
    todayBar.replaceChildren();
    bookingBar.replaceChildren(make('span', 'availability-prompt', '登录后查看可用时段'));
    renderBookingConflict();
    return;
  }
  fillAvailability(todayBar, officeDateKey());
  if (state.selectedDate) fillAvailability(bookingBar, state.selectedDate, state.editingId);
  renderBookingConflict();
}

function renderBookingConflict() {
  const target = $('bookingConflict');
  const date = $('meetingDate').value;
  const startTime = $('startTime').value;
  const endTime = $('endTime').value;
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  if (!hasBookerAccess() || !date || !Number.isFinite(start) || !Number.isFinite(end) ||
      end <= start || !state.loadedFrom || date < state.loadedFrom || date > state.loadedTo) {
    target.replaceChildren();
    return;
  }
  let startsAt;
  let endsAt;
  try {
    startsAt = toOfficeISO(date, startTime);
    endsAt = toOfficeISO(date, endTime);
  } catch {
    target.replaceChildren();
    return;
  }
  const conflicts = overlappingBookings(state.bookings, startsAt, endsAt, state.editingId);
  if (!conflicts.length) {
    target.replaceChildren();
    return;
  }
  const list = make('ul', 'booking-conflict-list');
  for (const booking of conflicts) {
    const row = make('li', 'booking-conflict-row');
    row.append(make('span', 'booking-conflict-time', formatRange(booking)),
      make('span', '', booking.title),
      make('span', '', `预订人 / Booker: ${booking.booker}`));
    list.append(row);
  }
  target.replaceChildren(make('strong', '', '时间冲突 / Time conflict'),
    make('p', '', '所选时间与已有会议重叠，请选择其他时段。'), list);
}

function renderSchedule() {
  const start = state.week;
  const end = shiftDateKey(start, 6);
  setText('scheduleRange', `${formatDate(start, { month: 'numeric', day: 'numeric' })} – ${formatDate(end, { month: 'numeric', day: 'numeric', year: 'numeric' })}`);
  $('weekViewBtn').classList.toggle('is-active', state.view === 'week');
  $('agendaViewBtn').classList.toggle('is-active', state.view === 'agenda');
  $('weekViewBtn').setAttribute('aria-pressed', String(state.view === 'week'));
  $('agendaViewBtn').setAttribute('aria-pressed', String(state.view === 'agenda'));
  const container = $('scheduleContent');
  if (!state.role) {
    container.replaceChildren(make('p', 'empty-state', '请先登录查看日程 / Sign in to view the schedule'));
    return;
  }
  if (!state.lastSync) {
    container.replaceChildren(make('p', 'empty-state', '正在读取本周日程 / Loading schedule'));
    return;
  }
  if (state.view === 'week') {
    const grid = make('div', 'week-grid');
    for (let offset = 0; offset < 7; offset += 1) {
      const dateKey = shiftDateKey(start, offset);
      const day = make('section', `week-day${dateKey === officeDateKey() ? ' is-today' : ''}`);
      day.append(make('h3', '', formatDate(dateKey, { weekday: 'long', month: 'numeric', day: 'numeric' })));
      const events = bookingsFor(dateKey);
      if (!events.length) day.append(make('p', 'card-placeholder', '空闲 / Available'));
      for (const booking of events) {
        const event = make(hasBookerAccess() ? 'button' : 'div', 'week-event');
        if (event.tagName === 'BUTTON') {
          event.type = 'button';
          event.addEventListener('click', () => openEdit(booking));
        }
        event.append(make('time', '', formatRange(booking)),
          make('strong', '', booking.title), make('span', '', booking.booker));
        day.append(event);
      }
      grid.append(day);
    }
    container.replaceChildren(grid);
  } else {
    const list = make('ul', 'agenda-list');
    const bookings = state.bookings.filter((booking) => {
      const date = officeDateKey(new Date(booking.starts_at));
      return date >= start && date <= end;
    });
    if (!bookings.length) {
      container.replaceChildren(make('p', 'empty-state', '本周暂无预约 / No bookings this week'));
      return;
    }
    for (const booking of bookings) {
      const item = make('li');
      const event = make(hasBookerAccess() ? 'button' : 'div', 'agenda-item');
      if (event.tagName === 'BUTTON') {
        event.type = 'button';
        event.addEventListener('click', () => openEdit(booking));
      }
      event.append(make('span', '', formatDate(officeDateKey(new Date(booking.starts_at)), { weekday: 'short', month: 'numeric', day: 'numeric' })),
        make('strong', '', `${formatRange(booking)} · ${booking.title}`),
        make('small', '', booking.booker));
      item.append(event);
      list.append(item);
    }
    container.replaceChildren(list);
  }
}

function renderAll() {
  renderAuth();
  renderClock();
  renderSync();
  renderHolidays();
  renderToday();
  renderNext();
  renderAvailability();
  renderSchedule();
}

function setTimeOptions() {
  const start = $('startTime');
  const end = $('endTime');
  for (let minute = DAY_START; minute <= DAY_END; minute += SLOT_MINUTES) {
    const time = minutesToTime(minute);
    if (minute < DAY_END && (minute < 12 * 60 || minute >= 13 * 60)) {
      start.add(new Option(time, time));
    }
    if (minute > DAY_START && (minute <= 12 * 60 || minute > 13 * 60)) {
      end.add(new Option(time, time));
    }
  }
}

function nextDefaultSlot() {
  const now = new Date();
  let date = officeDateKey(now);
  let minute = Math.max(DAY_START, Math.ceil((parseTime(officeTime(now)) + 1) / SLOT_MINUTES) * SLOT_MINUTES);
  if (minute >= 12 * 60 && minute < 13 * 60) minute = 13 * 60;
  if (minute >= DAY_END) {
    date = shiftDateKey(date, 1);
    minute = DAY_START;
  }
  return { date, start: minutesToTime(minute), end: minutesToTime(minute + SLOT_MINUTES) };
}

function openNewBooking() {
  if (!hasBookerAccess()) {
    state.pendingBooking = true;
    openLogin();
    return;
  }
  state.editingId = null;
  state.cancelArmedId = null;
  const choice = nextDefaultSlot();
  closeBookerSuggestions();
  $('bookingForm').reset();
  $('meetingDate').min = officeDateKey();
  $('meetingDate').value = choice.date;
  $('startTime').value = choice.start;
  $('endTime').value = choice.end;
  state.selectedDate = choice.date;
  setText('bookingDialogTitle', 'Book room / 预订会议室');
  setText('bookingSubmit', '确认预订 / Book room');
  setText('bookingError', '');
  $('deleteBookingBtn').hidden = true;
  setText('deleteBookingBtn', '取消预约 / Delete');
  renderAvailability();
  showDialog($('bookingDialog'));
  $('meetingTitle').focus();
  void refresh();
}

function openEdit(booking) {
  if (!hasBookerAccess()) return;
  closeBookerSuggestions();
  state.editingId = booking.id;
  state.cancelArmedId = null;
  $('meetingDate').min = officeDateKey();
  $('meetingTitle').value = booking.title;
  $('bookerName').value = booking.booker;
  $('meetingDate').value = officeDateKey(new Date(booking.starts_at));
  $('startTime').value = officeTime(new Date(booking.starts_at));
  $('endTime').value = officeTime(new Date(booking.ends_at));
  $('meetingRemark').value = booking.remark ?? '';
  state.selectedDate = $('meetingDate').value;
  setText('bookingDialogTitle', 'Edit meeting / 修改会议');
  setText('bookingSubmit', '保存修改 / Save changes');
  setText('bookingError', '');
  $('deleteBookingBtn').hidden = false;
  setText('deleteBookingBtn', '取消预约 / Delete');
  renderAvailability();
  showDialog($('bookingDialog'));
  void refresh();
}

function openLogin() {
  setText('loginError', '');
  $('loginPassword').value = '';
  setText('loginTitle', mode === 'display' ? '平板只读登录 / Display sign in' : '部门登录 / Team sign in');
  setText('loginPasswordLabel', mode === 'display' ? '平板密码 / Display password' : '部门密码 / Team password');
  const description = $('loginForm').querySelector('p');
  description.textContent = mode === 'display'
    ? '输入平板专用密码，屏幕只显示预约，不提供修改功能。'
    : configured ? '输入部门共用密码，预订和管理本会议室。' : '演示模式输入任意非空密码；数据仅保存在本浏览器。';
  showDialog($('loginDialog'));
  $('loginPassword').focus();
}

async function refresh() {
  if (!state.role) return;
  if (state.refreshing) { state.refreshQueued = true; return; }
  state.refreshing = true;
  const id = ++state.refreshId;
  renderSync();
  const today = officeDateKey();
  const start = [today, state.week, state.selectedDate].filter(Boolean).sort()[0];
  const weekEnd = shiftDateKey(state.week, 6);
  const end = [today, weekEnd, state.selectedDate].filter(Boolean).sort().at(-1);
  try {
    const bookings = await store.listBookings(toOfficeISO(start, '00:00'), toOfficeISO(shiftDateKey(end, 1), '00:00'));
    if (id !== state.refreshId || !state.role) return;
    state.bookings = bookings;
    state.loadedFrom = start;
    state.loadedTo = end;
    state.lastSync = new Date();
    state.syncError = null;
  } catch (error) {
    if (id !== state.refreshId || !state.role) return;
    state.syncError = error.code === 'AUTH' ? '登录已失效' : error.code === 'NETWORK' ? '网络连接中断' : '请检查云端配置';
    if (error.code === 'AUTH') {
      state.role = null;
      clearPrivateBookingForm();
      state.bookings = [];
      state.lastSync = null;
      state.loadedFrom = null;
      state.loadedTo = null;
      showToast('登录已失效，请重新输入密码。');
      openLogin();
    }
  } finally {
    state.refreshing = false;
    renderAll();
    if (state.refreshQueued) {
      state.refreshQueued = false;
      void refresh();
    }
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const password = $('loginPassword').value;
  const button = $('loginForm').querySelector('button[type="submit"]');
  button.disabled = true;
  setText('loginError', '');
  try {
    state.role = await store.signIn(expectedRole, password);
    void loadBookerSuggestions();
    $('loginDialog').close();
    $('loginPassword').value = '';
    await refresh();
    if (state.pendingBooking && hasBookerAccess()) {
      state.pendingBooking = false;
      openNewBooking();
    }
  } catch (error) {
    setText('loginError', error.code === 'AUTH' ? '密码错误，请重试。' : error.code === 'NETWORK'
      ? '云端请求失败，请重试。若仅 Chrome 出现，请试访客模式并检查扩展或代理设置。' : error.message);
  } finally {
    button.disabled = false;
    renderAll();
  }
}

async function handleBooking(event) {
  event.preventDefault();
  if (!hasBookerAccess()) { openLogin(); return; }
  const draft = {
    title: $('meetingTitle').value,
    booker: $('bookerName').value,
    date: $('meetingDate').value,
    startTime: $('startTime').value,
    endTime: $('endTime').value,
    remark: $('meetingRemark').value,
  };
  const checked = validateDraft(draft, {
    bookings: state.bookings,
    excludeId: state.editingId,
  });
  if (!checked.ok) {
    setText('bookingError', checked.message);
    return;
  }
  const payload = {
    title: draft.title.trim(), booker: draft.booker.trim(),
    starts_at: checked.starts_at, ends_at: checked.ends_at,
    remark: draft.remark.trim(),
  };
  $('bookingSubmit').disabled = true;
  setText('bookingError', '');
  try {
    if (state.editingId) await store.updateBooking(state.editingId, payload);
    else await store.createBooking(payload);
    $('bookingDialog').close();
    showToast(state.editingId ? '会议已更新 / Meeting updated' : '预订成功 / Booking saved');
    state.editingId = null;
    await refresh();
  } catch (error) {
    setText('bookingError', error.code === 'CONFLICT'
      ? '该时间刚被其他同事预订，请刷新日程后选择其他时段。'
      : error.code === 'NETWORK' ? '网络连接中断，未确认保存，请稍后重试。'
        : error.code === 'PERMISSION' ? '当前账号没有修改权限。' : error.message);
    if (error.code === 'CONFLICT') void refresh();
  } finally {
    $('bookingSubmit').disabled = false;
  }
}

async function handleCancel() {
  if (!state.editingId || !hasBookerAccess()) return;
  if (state.cancelArmedId !== state.editingId) {
    state.cancelArmedId = state.editingId;
    setText('deleteBookingBtn', '再次点击确认取消 / Confirm cancel');
    setText('bookingError', '请再次点击“确认取消”，此操作将释放该时段。');
    clearTimeout(handleCancel.timer);
    handleCancel.timer = setTimeout(() => {
      state.cancelArmedId = null;
      setText('deleteBookingBtn', '取消预约 / Delete');
      setText('bookingError', '');
    }, 8000);
    return;
  }
  clearTimeout(handleCancel.timer);
  const id = state.editingId;
  $('deleteBookingBtn').disabled = true;
  setText('bookingError', '');
  try {
    await store.cancelBooking(id);
    $('bookingDialog').close();
    state.editingId = null;
    state.cancelArmedId = null;
    showToast('预约已取消 / Booking cancelled');
    await refresh();
  } catch (error) {
    setText('bookingError', error.code === 'NETWORK' ? '网络连接中断，未确认取消，请稍后重试。' : error.message);
  } finally {
    $('deleteBookingBtn').disabled = false;
    setText('deleteBookingBtn', '取消预约 / Delete');
  }
}

function bindEvents() {
  $('openBookingBtn').addEventListener('click', openNewBooking);
  $('openScheduleBtn').addEventListener('click', () => { renderSchedule(); showDialog($('scheduleDialog')); void refresh(); });
  $('authButton').addEventListener('click', async () => {
    if (!state.role) { openLogin(); return; }
    const signOut = store.signOut();
    state.refreshId += 1;
    state.role = null;
    clearPrivateBookingForm();
    state.bookings = [];
    state.lastSync = null;
    state.loadedFrom = null;
    state.loadedTo = null;
    state.syncError = null;
    renderAll();
    showToast('已退出 / Signed out');
    await signOut;
  });
  $('closeBookingBtn').addEventListener('click', () => $('bookingDialog').close());
  $('bookingDialog').addEventListener('close', closeBookerSuggestions);
  $('bookingDialog').addEventListener('cancel', (event) => {
    if (!suggestionEscapePending && $('bookerSuggestions').hidden) return;
    event.preventDefault();
    suggestionEscapePending = false;
    closeBookerSuggestions();
  });
  $('bookerName').addEventListener('focus', openBookerSuggestions);
  $('bookerName').addEventListener('click', openBookerSuggestions);
  $('bookerName').addEventListener('input', openBookerSuggestions);
  $('bookerName').addEventListener('keydown', (event) => {
    const list = $('bookerSuggestions');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!bookerSuggestions.length || !hasBookerAccess()) return;
      event.preventDefault();
      if (list.hidden) openBookerSuggestions();
      const next = activeBookerSuggestion < 0
        ? event.key === 'ArrowDown' ? 0 : visibleBookerSuggestions.length - 1
        : activeBookerSuggestion + (event.key === 'ArrowDown' ? 1 : -1);
      setActiveBookerSuggestion(next);
    } else if (event.key === 'Enter' && !list.hidden && activeBookerSuggestion >= 0) {
      event.preventDefault();
      selectBookerSuggestion(activeBookerSuggestion);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeBookerSuggestionsForEscape();
    } else if (event.key === 'Tab') {
      closeBookerSuggestions();
    }
  });
  $('bookerSuggestionsToggle').addEventListener('click', (event) => {
    if ($('bookerSuggestions').hidden) {
      if (event.detail === 0) $('bookerName').focus({ preventScroll: true });
      openBookerSuggestions({ all: true });
    } else closeBookerSuggestions();
  });
  $('bookerSuggestionsToggle').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('bookerSuggestions').hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeBookerSuggestionsForEscape();
    } else if (event.key === 'Tab') {
      closeBookerSuggestions();
    }
  });
  $('bookerSuggestions').addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) selectBookerSuggestion(Number(option.dataset.index));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!$('bookerCombobox').parentElement.contains(event.target)) closeBookerSuggestions();
  });
  $('closeScheduleBtn').addEventListener('click', () => $('scheduleDialog').close());
  $('closeLoginBtn').addEventListener('click', () => $('loginDialog').close());
  $('bookingForm').addEventListener('submit', handleBooking);
  $('loginForm').addEventListener('submit', handleLogin);
  $('deleteBookingBtn').addEventListener('click', handleCancel);
  $('meetingDate').addEventListener('change', () => {
    state.selectedDate = $('meetingDate').value;
    renderAvailability();
    void refresh();
  });
  $('startTime').addEventListener('change', renderBookingConflict);
  $('endTime').addEventListener('change', renderBookingConflict);
  $('prevWeekBtn').addEventListener('click', () => { state.week = shiftDateKey(state.week, -7); renderSchedule(); void refresh(); });
  $('thisWeekBtn').addEventListener('click', () => { state.week = weekStart(officeDateKey()); renderSchedule(); void refresh(); });
  $('nextWeekBtn').addEventListener('click', () => { state.week = shiftDateKey(state.week, 7); renderSchedule(); void refresh(); });
  $('weekViewBtn').addEventListener('click', () => { state.view = 'week'; renderSchedule(); });
  $('agendaViewBtn').addEventListener('click', () => { state.view = 'agenda'; renderSchedule(); });
  window.addEventListener('online', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}

async function init() {
  setTimeOptions();
  bindEvents();
  renderAll();
  try {
    state.role = await store.restoreSession();
    if (state.role && state.role !== expectedRole) {
      await store.signOut();
      state.role = null;
    }
    if (!configured && mode === 'display' && !state.role) {
      state.role = await store.signIn('display', 'demo');
    }
    renderAll();
    if (state.role) {
      void loadBookerSuggestions();
      await refresh();
    } else openLogin();
  } catch (error) {
    state.syncError = error.code === 'NETWORK' ? '网络连接中断' : '初始化失败';
    renderAll();
    if (!state.role) openLogin();
  }
  setInterval(renderClock, 1000);
  setInterval(() => void refresh(), 15_000);
}

void init();
