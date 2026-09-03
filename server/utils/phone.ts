import { toEnglishDigits } from '../security.js';

/**
 * Iranian Mobile Phone Number Normalization & Validation Utility
 *
 * Accepted formats:
 * - 09121234567
 * - +989121234567
 * - 00989121234567
 * - 989121234567
 * - 9121234567
 * - Persian/Arabic digits: ۰۹۱۲۱۲۳۴۵۶۷, ٠٩١٢١٢٣٤٥٦٧
 * - Embedded spaces, dashes, parentheses: +98 (912) 123-4567
 *
 * Canonical output format:
 * - Exactly 11 digits starting with "09": 09XXXXXXXXX
 */

const IRANIAN_MOBILE_REGEX = /^09\d{9}$/;

export function normalizePhoneNumber(rawInput?: string | null): string | null {
  if (!rawInput || typeof rawInput !== 'string') {
    return null;
  }

  // 1. Convert Persian / Arabic digits to standard ASCII digits
  let cleaned = toEnglishDigits(rawInput.trim());

  // 2. Remove all non-digit characters except leading '+' if present
  // Remove spaces, hyphens, parentheses, dots, slashes
  cleaned = cleaned.replace(/[\s\-\(\)\.\/\\]/g, '');

  // 3. Handle international prefixes
  // +98... -> 0...
  if (cleaned.startsWith('+98')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('0098')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('98') && cleaned.length === 12) {
    // 989121234567 (12 digits) -> 09121234567
    cleaned = '0' + cleaned.slice(2);
  } else if (cleaned.startsWith('9') && cleaned.length === 10) {
    // 9121234567 (10 digits) -> 09121234567
    cleaned = '0' + cleaned;
  }

  // 4. Validate exact 11-digit Iranian mobile pattern: 09XXXXXXXXX
  if (!IRANIAN_MOBILE_REGEX.test(cleaned)) {
    return null;
  }

  return cleaned;
}

export function isValidIranianMobile(phone?: string | null): boolean {
  return normalizePhoneNumber(phone) !== null;
}

export const validateIranianPhone = isValidIranianMobile;

export function maskPhoneNumber(phone?: string | null): string {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return phone || '';
  return `${normalized.slice(0, 4)}***${normalized.slice(7)}`;
}
