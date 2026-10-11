// ============================================================
// Every safety sentence in the app, in one file for legal review (doc 24 Phase 10, legal L10).
// Rules: never say Fixli called the police or emergency services; no medical advice beyond basic
// "get to safety" steps; numbers come from the country configuration, never typed here.
// Urdu/Arabic come with F7 (native-speaker review, O13).
// ============================================================

export const SOS_COPY = {
  holdTitle: 'Emergency',
  countdown: (s: number) => `Sending in ${s}…`,
  countdownHint: 'Tap Cancel if you pressed this by mistake.',
  cancel: 'Cancel',
  chooseTitle: 'What is happening?',
  kinds: {
    LIFE_THREATENING: { label: 'Someone is in danger', sub: 'Injury, fire, a threat to your safety' },
    WATER: { label: 'Water / burst pipe', sub: 'Flooding or a pipe that won\'t stop' },
    ELECTRIC: { label: 'Electrical hazard', sub: 'Sparks, burning smell, exposed wires' },
    GAS: { label: 'Gas smell', sub: 'You can smell gas' },
  },
  callNow: 'Call now',
  lifeTitle: 'Call for help now',
  lifeBody: 'Fixli does not contact emergency services for you. Call one of these numbers. We have told the Fixli safety team.',
  noWorker: 'We will not send a professional into a dangerous situation.',
  steps: {
    WATER: ['If it is safe, close the main water valve.', 'If water is near sockets or appliances, switch off the electricity at the main board if you can do so without touching water.', 'Move valuables and electrical items away from the water.'],
    ELECTRIC: ['Stay away from sparks, smoke and exposed wires.', 'If it is safe, switch off the main breaker. Never touch anything wet.', 'If there is fire or someone has had a shock, call the emergency number now.'],
    GAS: ["Don't switch lights or appliances on or off.", "Don't light anything or use a phone near the smell.", 'Open doors and windows, then leave the building.', "From outside, call your gas company's emergency line."],
  } as Record<'WATER' | 'ELECTRIC' | 'GAS', string[]>,
  sendRequest: 'Find a professional now',
  sendingRequest: 'Finding the nearest available professional…',
  requestSent: 'We are asking the nearest available professional. You will see who is coming on the next screen.',
  inJobTitle: 'Are you safe?',
  inJobBody: 'If you are in danger, call an emergency number now. You can also tell the Fixli safety team.',
  inJobSend: 'Tell the Fixli safety team',
  inJobSent: 'The Fixli safety team has been told and will contact you.',
  noAddress: 'Add your address first so a professional can find you.',
  offline: "You're offline. Call an emergency number directly.",
  contactsTitle: 'Trusted contacts',
  contactsBody: 'If you press SOS for an emergency involving you, we try to text these people. Up to 5.',
  workerSosBanner: (minutes: number) => `Emergency near you. Please accept or decline within ${minutes} minutes.`,
};
