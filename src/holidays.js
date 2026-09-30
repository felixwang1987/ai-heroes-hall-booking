/**
 * Public-holiday snapshot checked 2026-09-29. Dates are local calendar dates,
 * compared with the Asia/Shanghai date key supplied by the caller. Kulim uses
 * Kedah's calendar. Chinese makeup WORKdays are deliberately excluded.
 *
 * Primary schedules:
 * China 2026, State Council: https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
 * Kedah 2026, state secretary (also the replacement rule):
 * https://mmk.kedah.gov.my/wp-content/uploads/2025/12/JADUAL-HARI-KELEPASAN-AM-NEGERI-KEDAH-DARUL-AMAN-TAHUN-2026.pdf
 * Malaysia/Kedah 2027, BKPP: https://www.kabinet.gov.my/storage/2026/08/HKA_2027.pdf
 * Kedah 2026 Thaipusam: https://www.kedah.gov.my/wp-content/uploads/2026/01/Cuti-Peristiwa-Thaipusam-Negeri-Kedah-Darul-Aman-2026.pdf
 * Kedah 2026 extra Eid: https://www.kedah.gov.my/wp-content/uploads/2026/03/HARI-KELEPASAN-AM-TAMBAHAN-SEMPENA-HARI-RAYA-AIDILFITRI-TAHUN-2026.pdf
 * Kedah's March 23 declaration, reported by Bernama:
 * https://bernama.com/bm/news.php?id=2535801
 * Federal extra Eid: https://www.kabinet.gov.my/storage/2026/03/PUB-111_2026.pdf
 * Kedah 2026 Sultan birthday amendment:
 * https://www.kedah.gov.my/index.php/2026/05/07/pemakluman-pindaan-tarikh-ulang-tahun-hari-keputeraan-kebawah-duli-yang-maha-mulia-tuanku-sultan-kedah-darul-aman-bagi-tahun-2026/
 * Friday holiday replacement on Sunday is shown by Kedah's official circular:
 * https://pkpk.kedah.gov.my/wp-content/uploads/2026/01/PEKELILING-PERB-BIL-2-2026-OT.pdf
 * Christmas 2026 replacement also cross-checked at:
 * https://payroll.autocountcloud.com/public-holidays/2026/kedah
 *
 * Maintenance: add China 2027 periods when the State Council publishes its
 * adjustment notice (unpublished as of this snapshot). Recheck BKPP and Kedah
 * for lunar-date changes, ad hoc holidays and replacements. Kedah Thaipusam
 * is declared separately each year; 2027 is omitted until confirmed.
 */

const day = (date, nameEn, nameZh, region) => ({ date, nameEn, nameZh, region });

function daysBetween(start, end, nameEn, nameZh, region) {
  const days = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let at = Date.parse(`${start}T00:00:00Z`); at <= last; at += 86_400_000) {
    days.push(day(new Date(at).toISOString().slice(0, 10), nameEn, nameZh, region));
  }
  return days;
}

const publishedHolidays = [
  // 2026 China: every announced leave date gets a row.
  ...daysBetween('2026-01-01', '2026-01-03', "New Year's Day", '元旦', 'CN'),
  ...daysBetween('2026-02-15', '2026-02-23', 'Spring Festival', '春节', 'CN'),
  ...daysBetween('2026-04-04', '2026-04-06', 'Qingming Festival', '清明节', 'CN'),
  ...daysBetween('2026-05-01', '2026-05-05', 'Labor Day', '劳动节', 'CN'),
  ...daysBetween('2026-06-19', '2026-06-21', 'Dragon Boat Festival', '端午节', 'CN'),
  ...daysBetween('2026-09-25', '2026-09-27', 'Mid-Autumn Festival', '中秋节', 'CN'),
  ...daysBetween('2026-10-01', '2026-10-07', 'National Day', '国庆节', 'CN'),

  // 2026 Kedah: official dates, amendments, and observed working Sundays.
  day('2026-01-17', 'Isra and Mi\'raj', '登霄节', 'MY-KDH'),
  day('2026-02-01', 'Thaipusam', '大宝森节', 'MY-KDH'),
  day('2026-02-17', 'Chinese New Year', '农历新年', 'MY-KDH'),
  day('2026-02-18', 'Chinese New Year', '农历新年', 'MY-KDH'),
  day('2026-02-19', 'First Day of Ramadan', '斋月首日', 'MY-KDH'),
  day('2026-03-20', 'Extra Eid al-Fitr Holiday', '开斋节额外假日', 'MY-KDH'),
  day('2026-03-21', 'Eid al-Fitr', '开斋节', 'MY-KDH'),
  day('2026-03-22', 'Eid al-Fitr', '开斋节', 'MY-KDH'),
  day('2026-03-23', 'Extra Eid al-Fitr Holiday', '开斋节额外假日', 'MY-KDH'),
  day('2026-05-01', 'Labor Day', '劳动节', 'MY-KDH'),
  day('2026-05-03', 'Labor Day (observed)', '劳动节补假', 'MY-KDH'),
  day('2026-05-27', 'Eid al-Adha', '宰牲节', 'MY-KDH'),
  day('2026-05-28', 'Eid al-Adha', '宰牲节', 'MY-KDH'),
  day('2026-05-31', 'Wesak Day', '卫塞节', 'MY-KDH'),
  day('2026-06-01', "Yang di-Pertuan Agong's Birthday", '国家元首华诞', 'MY-KDH'),
  day('2026-06-17', 'Islamic New Year', '伊斯兰新年', 'MY-KDH'),
  day('2026-07-05', "Sultan of Kedah's Birthday", '吉打苏丹华诞', 'MY-KDH'),
  day('2026-08-25', "Prophet Muhammad's Birthday", '先知穆罕默德诞辰', 'MY-KDH'),
  day('2026-08-31', 'National Day', '马来西亚国庆日', 'MY-KDH'),
  day('2026-09-16', 'Malaysia Day', '马来西亚日', 'MY-KDH'),
  day('2026-11-08', 'Deepavali', '屠妖节', 'MY-KDH'),
  day('2026-12-25', 'Christmas Day', '圣诞节', 'MY-KDH'),
  day('2026-12-27', 'Christmas Day (observed)', '圣诞节补假', 'MY-KDH'),

  // 2027 Kedah: published federal and state dates; no ad hoc Thaipusam.
  day('2027-01-06', 'Isra and Mi\'raj', '登霄节', 'MY-KDH'),
  day('2027-02-06', 'Chinese New Year', '农历新年', 'MY-KDH'),
  day('2027-02-07', 'Chinese New Year', '农历新年', 'MY-KDH'),
  day('2027-02-08', 'First Day of Ramadan', '斋月首日', 'MY-KDH'),
  day('2027-03-10', 'Eid al-Fitr', '开斋节', 'MY-KDH'),
  day('2027-03-11', 'Eid al-Fitr', '开斋节', 'MY-KDH'),
  day('2027-05-01', 'Labor Day', '劳动节', 'MY-KDH'),
  day('2027-05-17', 'Eid al-Adha', '宰牲节', 'MY-KDH'),
  day('2027-05-18', 'Eid al-Adha', '宰牲节', 'MY-KDH'),
  day('2027-05-20', 'Wesak Day', '卫塞节', 'MY-KDH'),
  day('2027-06-06', 'Islamic New Year', '伊斯兰新年', 'MY-KDH'),
  day('2027-06-07', "Yang di-Pertuan Agong's Birthday", '国家元首华诞', 'MY-KDH'),
  day('2027-06-20', "Sultan of Kedah's Birthday", '吉打苏丹华诞', 'MY-KDH'),
  day('2027-08-15', "Prophet Muhammad's Birthday", '先知穆罕默德诞辰', 'MY-KDH'),
  day('2027-08-31', 'National Day', '马来西亚国庆日', 'MY-KDH'),
  day('2027-09-16', 'Malaysia Day', '马来西亚日', 'MY-KDH'),
  day('2027-10-28', 'Deepavali', '屠妖节', 'MY-KDH'),
  day('2027-12-25', 'Christmas Day', '圣诞节', 'MY-KDH'),
  day('2027-12-26', 'Isra and Mi\'raj', '登霄节', 'MY-KDH'),
].sort((a, b) => a.date.localeCompare(b.date) || a.region.localeCompare(b.region));

/** Return upcoming local holiday dates, including today, in date order. */
export function upcomingHolidays(todayDateKey, limit = 5) {
  if (typeof todayDateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(todayDateKey)) {
    throw new TypeError('todayDateKey must be YYYY-MM-DD');
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError('limit must be a non-negative integer');
  }
  return publishedHolidays
    .filter(({ date }) => date >= todayDateKey)
    .slice(0, limit)
    .map((holiday) => ({ ...holiday }));
}
