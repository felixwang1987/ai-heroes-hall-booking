import test from 'node:test';
import assert from 'node:assert/strict';
import {
  officeDateKey,
  toOfficeISO,
  validateDraft,
  availabilityForDate,
  statusAt,
  weekStart,
} from '../src/domain.js';

const NOW = new Date('2026-09-30T04:00:00.000Z'); // 12:00 in Chongqing
const date = '2026-10-01';
const draft = {
  title: 'Project review',
  booker: 'Felix',
  date,
  startTime: '09:00',
  endTime: '10:00',
  remark: '',
};

test('office date follows Beijing time around UTC midnight', () => {
  assert.equal(officeDateKey(new Date('2026-09-29T16:00:00Z')), '2026-09-30');
  assert.equal(toOfficeISO('2026-09-30', '08:00'), '2026-09-30T00:00:00.000Z');
});

test('accepts a normal half-hour booking and rejects lunch overlap', () => {
  assert.equal(validateDraft({ ...draft, startTime: '11:30', endTime: '12:00' }, { now: NOW }).ok, true);
  assert.equal(validateDraft({ ...draft, startTime: '13:00', endTime: '13:30' }, { now: NOW }).ok, true);
  assert.equal(validateDraft({ ...draft, startTime: '11:30', endTime: '12:30' }, { now: NOW }).code, 'LUNCH');
  assert.equal(validateDraft({ ...draft, startTime: '12:00', endTime: '13:00' }, { now: NOW }).code, 'LUNCH');
});

test('rejects hours and minute marks outside room rules', () => {
  assert.equal(validateDraft({ ...draft, startTime: '07:30' }, { now: NOW }).code, 'HOURS');
  assert.equal(validateDraft({ ...draft, endTime: '17:30' }, { now: NOW }).code, 'HOURS');
  assert.equal(validateDraft({ ...draft, startTime: '09:15' }, { now: NOW }).code, 'SLOT');
  assert.equal(validateDraft({ ...draft, endTime: '09:00' }, { now: NOW }).code, 'ORDER');
});

test('rejects overlap but allows adjacent meetings and ignores canceled ones', () => {
  const booked = [{
    id: 'one',
    starts_at: '2026-10-01T01:00:00.000Z', // 09:00 Beijing
    ends_at: '2026-10-01T02:00:00.000Z',
    status: 'confirmed',
  }];
  assert.equal(validateDraft({ ...draft, startTime: '09:30', endTime: '10:30' }, { now: NOW, bookings: booked }).code, 'CONFLICT');
  assert.equal(validateDraft({ ...draft, startTime: '10:00', endTime: '10:30' }, { now: NOW, bookings: booked }).ok, true);
  assert.equal(validateDraft(draft, { now: NOW, bookings: booked, excludeId: 'one' }).ok, true);
  assert.equal(validateDraft(draft, { now: NOW, bookings: [{ ...booked[0], status: 'cancelled' }] }).ok, true);
});

test('marks occupied and lunch slots for the full office day', () => {
  const segments = availabilityForDate([{
    starts_at: '2026-10-01T01:00:00.000Z',
    ends_at: '2026-10-01T02:00:00.000Z',
    status: 'confirmed',
  }], date);
  assert.equal(segments.length, 18);
  assert.equal(segments.find((slot) => slot.start === '09:00').status, 'booked');
  assert.equal(segments.find((slot) => slot.start === '12:00').status, 'lunch');
  assert.equal(segments.find((slot) => slot.start === '12:30').status, 'lunch');
  assert.equal(segments.find((slot) => slot.start === '10:00').status, 'available');
});

test('finds current and next meeting in office time', () => {
  const bookings = [
    { id: 'first', starts_at: '2026-09-30T05:00:00Z', ends_at: '2026-09-30T06:00:00Z', status: 'confirmed' },
    { id: 'second', starts_at: '2026-09-30T07:00:00Z', ends_at: '2026-09-30T08:00:00Z', status: 'confirmed' },
  ];
  const state = statusAt(bookings, new Date('2026-09-30T05:15:00Z'));
  assert.equal(state.current?.id, 'first');
  assert.equal(state.next?.id, 'second');
});

test('week view starts on Monday', () => {
  assert.equal(weekStart('2026-09-30'), '2026-09-28');
});
