import type { Address, EmergencyNumber, IncidentResult, SosKind } from '../services/api';

export type SosChoice = 'LIFE' | SosKind;

export const SOS_CHOICES: { id: SosChoice; label: string; icon: string; hint: string }[] = [
  { id: 'LIFE', label: 'Someone is in danger', icon: 'medkit', hint: 'Injury, violence, fire spreading, or you feel unsafe' },
  { id: 'WATER', label: 'Burst pipe / flooding', icon: 'water', hint: 'Water you cannot stop' },
  { id: 'ELECTRICAL', label: 'Electric or fire hazard', icon: 'flash', hint: 'Sparks, burning smell, exposed wires' },
  { id: 'GAS', label: 'Gas smell', icon: 'flame', hint: 'Smell of gas in the home' },
];

/** What to do right now, before help arrives. Short and plain; never replaces the numbers. */
export const SOS_ADVICE: Record<SosKind, string> = {
  WATER: 'If you can do it safely, turn off the main water valve. Keep away from sockets and wet electrics.',
  ELECTRICAL: 'Do not touch anything wet or any exposed wire. If you can do it safely, switch off the main power. If there is fire, leave and call the emergency numbers.',
  GAS: 'Leave the building now. Do not use switches, flames or phones inside. Call the emergency numbers from outside.',
};

/** The customer's default address, else the first one. null when they have none. */
export function pickAddress(addresses: Pick<Address, 'id' | 'isDefault'>[] | undefined | null): string | null {
  if (!addresses?.length) return null;
  return (addresses.find((a) => a.isDefault) ?? addresses[0]).id;
}

/** Honest summary of what happened to trusted contacts; null when there is nothing to say. */
export function describeContacts(r: Pick<IncidentResult, 'trustedContacts'>): string | null {
  const { total, notified } = r.trustedContacts;
  if (total === 0) return null;
  if (notified === total) return `We texted ${total === 1 ? 'your trusted contact' : `your ${total} trusted contacts`}.`;
  if (notified === 0) return `We could not text your trusted contact${total === 1 ? '' : 's'}. Please call ${total === 1 ? 'them' : 'one of them'} yourself.`;
  return `We texted ${notified} of your ${total} trusted contacts. Please call the others yourself.`;
}

export const telUrl = (n: EmergencyNumber) => `tel:${n.number.replace(/[^\d+]/g, '')}`;

/**
 * Last resort ONLY: used when the numbers were never fetched or cached on this device (first launch, no
 * signal). Normally the screen shows the user's country numbers from the server, cached after each load.
 * The SOS screen must never be empty, so this safety exception to "no hard-coded country data" is deliberate.
 */
export const FALLBACK_NUMBERS: EmergencyNumber[] = [{ label: 'Police', number: '15' }, { label: 'Rescue', number: '1122' }];
