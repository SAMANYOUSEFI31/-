// Persian Digits and Number Formatting Utilities

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * Converts any number or numeric string to standard Persian digits (۰-۹)
 */
export function toPersianDigits(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.replace(/\d/g, d => PERSIAN_DIGITS[parseInt(d, 10)]);
}

/**
 * Converts any Persian digits in a string to standard English digits (0-9)
 */
export function toEnglishDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.replace(/[۰-۹]/g, d => String(PERSIAN_DIGITS.indexOf(d)));
}

/**
 * Normalizes text for search comparison (removes zwnj, trims, unifies chars)
 */
export function normalizeSearchText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\u200c\u200b\u200e\u200f\s]+/g, ' ')
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ة]/g, 'ه')
    .trim();
}
export function formatPersianNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '۰';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return toPersianDigits(value);
  const formatted = num.toLocaleString('en-US');
  return toPersianDigits(formatted);
}

/**
 * Formats price in Tomans with Persian digits
 */
export function formatPersianPrice(amount: number, suffix = 'تومان'): string {
  return `${formatPersianNumber(amount)} ${suffix}`;
}

export const formatPersianToman = formatPersianPrice;

/**
 * Formats percentage with Persian digits
 */
export function formatPersianPercent(percentage: number): string {
  return `${toPersianDigits(Math.round(percentage))}٪`;
}
