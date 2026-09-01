import { toPersianDigits } from './numberUtils';

// Persian Solar Hijri (Jalali) & Gregorian Date utilities

/**
 * Formats a Date object to YYYY-MM-DD using its LOCAL calendar parts.
 * Deterministic, no timezone offset skew.
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the logical battle date string (YYYY-MM-DD).
 * For night owls: before cutoffHour (e.g. 04:00 AM), it counts as the previous calendar day.
 * Implemented deterministically using local calendar date arithmetic.
 */
export function getLogicalTodayDate(cutoffHour = 4): string {
  const now = new Date();
  const currentHour = now.getHours();
  
  const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (currentHour < cutoffHour) {
    targetDate.setDate(targetDate.getDate() - 1);
  }
  return formatDateISO(targetDate);
}

/**
 * Adds integer days to a YYYY-MM-DD date string deterministically without Timezone DST or UTC jumps.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  // Using Local Date at noon (12:00:00) prevents any Daylight Saving Time (DST) or midnight skew
  const date = new Date(y, m - 1, d, 12, 0, 0);
  date.setDate(date.getDate() + days);
  return formatDateISO(date);
}

/**
 * Returns difference in calendar days between two YYYY-MM-DD date strings (dateStr2 - dateStr1).
 */
export function daysBetween(dateStr1: string, dateStr2: string): number {
  if (!dateStr1 || !dateStr2) return 0;
  const [y1, m1, d1] = dateStr1.split('-').map(Number);
  const [y2, m2, d2] = dateStr2.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  const diffTime = t2 - t1;
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// Convert Gregorian to Persian (Jalali) representation for friendly display
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const PERSIAN_WEEKDAYS = [
  'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'
];

export function formatPersianDate(dateStr: string, options: { withWeekday?: boolean; short?: boolean } = {}): string {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [jy, jm, jd] = gregorianToJalali(y, m, d);
    const dateObj = new Date(y, m - 1, d);
    const weekday = PERSIAN_WEEKDAYS[dateObj.getDay()];
    
    const persianDay = toPersianDigits(jd);
    const persianYear = toPersianDigits(jy);

    if (options.short) {
      return `${persianDay} ${PERSIAN_MONTHS[jm - 1]}`;
    }
    
    if (options.withWeekday) {
      return `${weekday}، ${persianDay} ${PERSIAN_MONTHS[jm - 1]} ${persianYear}`;
    }
    return `${persianDay} ${PERSIAN_MONTHS[jm - 1]} ${persianYear}`;
  } catch {
    return toPersianDigits(dateStr);
  }
}

/**
 * Returns exact relative temporal description in Persian
 * Correctly distinguishes between today, tomorrow (+1), 2 days ahead (+2), and future days
 */
export function getRelativeDateLabel(dateStr: string, baseDateStr: string = getLogicalTodayDate()): string {
  const diff = daysBetween(baseDateStr, dateStr);
  if (diff === 0) return 'روز جاری نبرد';
  if (diff === 1) return '۱ روز بعد';
  if (diff > 1) return `${toPersianDigits(diff)} روز بعد`;
  return `${toPersianDigits(Math.abs(diff))} روز قبل`;
}
