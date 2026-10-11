/**
 * Spots phone numbers, links, emails and "message me on WhatsApp" in chat text, so the sender
 * can be reminded to keep talking on Fixli (doc 04 L). It only warns the sender and flags the
 * message for review; it never blocks or edits what they wrote.
 */

/** Urdu/Persian (۰-۹) and Arabic-Indic (٠-٩) digits -> 0-9. */
export function normaliseDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|pk|net|org|io|me|co|info|biz|link|ly)\b(?:\/\S*)?/i;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const APPS = /\b(?:whats\s?app|wa\.me|telegram|signal|imo|viber|insta(?:gram)?|snap(?:chat)?|facebook|fb)\b|واٹس\s?ایپ|واتساب/i;

/**
 * Phone-like: 10–13 digits once spaces, dots, dashes and brackets are removed, in one run.
 * Prices ("Rs 1,500.00"), times ("3.5 hours") and short codes stay well below that.
 */
function hasPhone(text: string): boolean {
  const runs = normaliseDigits(text).match(/\+?\d[\d\s().-]{8,}\d/g) ?? [];
  return runs.some((r) => {
    if (/\d\.\d{1,2}(?!\d)/.test(r) && !/\s|-/.test(r)) return false; // a decimal amount
    const digits = r.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 13;
  });
}

export type ContactKind = 'phone' | 'link' | 'email' | 'app';

export function detectContact(text: string | null | undefined): ContactKind[] {
  if (!text) return [];
  const kinds: ContactKind[] = [];
  if (hasPhone(text)) kinds.push('phone');
  if (EMAIL.test(text)) kinds.push('email');
  else if (LINK.test(text)) kinds.push('link');
  if (APPS.test(text)) kinds.push('app');
  return kinds;
}
