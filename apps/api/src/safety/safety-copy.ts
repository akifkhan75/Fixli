// ============================================================
// Every safety sentence the server sends, in one place for legal review (doc 24 Phase 10,
// legal L10). Rules: never claim Fixli contacted the police or emergency services; never give
// medical advice; never include an exact address in a message to a third party.
// ============================================================

type L = 'en' | 'ur';
const lang = (l?: string | null): L => (l === 'ur' ? 'ur' : 'en');

/** SMS to a trusted contact when the user presses SOS. Approximate area only. */
export function trustedContactSms(locale: string | null | undefined, p: { name: string; time: string; area: string | null }) {
  return lang(locale) === 'ur'
    ? `${p.name} نے ${p.time} پر Fixli ایپ میں SOS بٹن دبایا۔${p.area ? ` تقریبی علاقہ: ${p.area}۔` : ''} انہیں مدد کی ضرورت ہو سکتی ہے۔ ان سے رابطہ کریں۔`
    : `${p.name} pressed the SOS button in the Fixli app at ${p.time}.${p.area ? ` Approximate area: ${p.area}.` : ''} They may need help. Please contact them.`;
}

/** What the person who pressed SOS is told about their contacts. */
export const CONTACT_ALERT_RESULT: Record<string, string> = {
  SENT: 'Your trusted contacts were sent a text message.',
  PARTLY_SENT: 'Some of your trusted contacts were sent a text message.',
  NO_CONTACTS: 'You have no trusted contacts. You can add them in Profile → Safety.',
  NO_PROVIDER: 'Fixli cannot send text messages yet, so your trusted contacts were NOT told. Call them yourself if you can.',
  FAILED: 'We could not reach your trusted contacts. Call them yourself if you can.',
};
