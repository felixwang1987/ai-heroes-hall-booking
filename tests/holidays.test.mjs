import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingHolidays } from '../src/holidays.js';

test('lists every announced China National Day leave date in order', () => {
  assert.deepEqual(upcomingHolidays('2026-09-30', 3), [
    { date: '2026-10-01', nameZh: '国庆节', nameEn: 'National Day', region: 'CN' },
    { date: '2026-10-02', nameZh: '国庆节', nameEn: 'National Day', region: 'CN' },
    { date: '2026-10-03', nameZh: '国庆节', nameEn: 'National Day', region: 'CN' },
  ]);
});

test('includes today, then continues into Kedah holidays and the next year', () => {
  assert.deepEqual(
    upcomingHolidays('2026-10-07', 6).map(({ date, region }) => ({ date, region })),
    [
      { date: '2026-10-07', region: 'CN' },
      { date: '2026-11-08', region: 'MY-KDH' },
      { date: '2026-12-25', region: 'MY-KDH' },
      { date: '2026-12-27', region: 'MY-KDH' },
      { date: '2027-01-06', region: 'MY-KDH' },
      { date: '2027-02-06', region: 'MY-KDH' },
    ],
  );
});

test('excludes China makeup workdays and Kedah non-holidays', () => {
  assert.equal(upcomingHolidays('2026-10-10', 1)[0].date, '2026-11-08');
  assert.equal(upcomingHolidays('2027-01-01', 1)[0].date, '2027-01-06');
  assert.equal(upcomingHolidays('2026-11-09', 1)[0].date, '2026-12-25');
});

test('includes Kedah observed replacements on working Sundays', () => {
  assert.equal(upcomingHolidays('2026-05-02', 5).find(({ region }) => region === 'MY-KDH')?.date, '2026-05-03');
  assert.equal(upcomingHolidays('2026-12-26', 1)[0].date, '2026-12-27');
});

test('keeps separate regional holidays that fall on the same date', () => {
  assert.deepEqual(
    upcomingHolidays('2026-05-01', 2).map(({ date, region }) => ({ date, region })),
    [
      { date: '2026-05-01', region: 'CN' },
      { date: '2026-05-01', region: 'MY-KDH' },
    ],
  );
});

test('returns no dates after the published coverage and honors a zero limit', () => {
  assert.deepEqual(upcomingHolidays('2028-01-01'), []);
  assert.deepEqual(upcomingHolidays('2026-10-01', 0), []);
});
