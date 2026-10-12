// ============================================================
// Every safety sentence in the app, in one file for legal review (doc 24 Phase 10, legal L10).
// Rules: never say Fixli called the police or emergency services; no medical advice beyond basic
// "get to safety" steps; numbers come from the country configuration, never typed here.
// Urdu and Arabic are machine-drafted and MUST be reviewed by native speakers and counsel before
// release (O13, L10). The same rules are checked in every language (src/__tests__/safety.test.ts).
// ============================================================

import { t } from '../i18n';

export const SOS_COPY = {
  get holdTitle() { return t('safety.holdTitle'); },
  get countdownHint() { return t('safety.countdownHint'); },
  get cancel() { return t('safety.cancel'); },
  get chooseTitle() { return t('safety.chooseTitle'); },
  get callNow() { return t('safety.callNow'); },
  get lifeTitle() { return t('safety.lifeTitle'); },
  get lifeBody() { return t('safety.lifeBody'); },
  get noWorker() { return t('safety.noWorker'); },
  get sendRequest() { return t('safety.sendRequest'); },
  get sendingRequest() { return t('safety.sendingRequest'); },
  get requestSent() { return t('safety.requestSent'); },
  get inJobTitle() { return t('safety.inJobTitle'); },
  get inJobBody() { return t('safety.inJobBody'); },
  get inJobSend() { return t('safety.inJobSend'); },
  get inJobSent() { return t('safety.inJobSent'); },
  get noAddress() { return t('safety.noAddress'); },
  get offline() { return t('safety.offline'); },
  get contactsTitle() { return t('safety.contactsTitle'); },
  get contactsBody() { return t('safety.contactsBody'); },
  countdown: (s: number) => t('safety.countdown', { s }),
  workerSosBanner: (minutes: number) => t('safety.workerSosBanner', { minutes }),
  get kinds() {
    return {
      LIFE_THREATENING: { label: t('safety.kind.LIFE_THREATENING.label'), sub: t('safety.kind.LIFE_THREATENING.sub') },
      WATER: { label: t('safety.kind.WATER.label'), sub: t('safety.kind.WATER.sub') },
      ELECTRIC: { label: t('safety.kind.ELECTRIC.label'), sub: t('safety.kind.ELECTRIC.sub') },
      GAS: { label: t('safety.kind.GAS.label'), sub: t('safety.kind.GAS.sub') },
    };
  },
  get steps(): Record<'WATER' | 'ELECTRIC' | 'GAS', string[]> {
    return {
      WATER: [t('safety.steps.WATER.1'), t('safety.steps.WATER.2'), t('safety.steps.WATER.3')],
      ELECTRIC: [t('safety.steps.ELECTRIC.1'), t('safety.steps.ELECTRIC.2'), t('safety.steps.ELECTRIC.3')],
      GAS: [t('safety.steps.GAS.1'), t('safety.steps.GAS.2'), t('safety.steps.GAS.3'), t('safety.steps.GAS.4')],
    };
  },
};
