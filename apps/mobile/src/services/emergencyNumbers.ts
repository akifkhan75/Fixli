import AsyncStorage from '@react-native-async-storage/async-storage';
import { COUNTRIES, isCountryCode } from '@fixli/shared';
import { getEmergencyNumbers } from './api';

export type EmergencyNumber = { label: string; number: string };
const KEY = '@fixli_emergency_numbers';

/**
 * Emergency numbers must work with no signal: last copy from the server (country configuration)
 * is cached; before the first fetch, the country reference data is used.
 */
export async function loadEmergencyNumbers(countryCode?: string | null): Promise<EmergencyNumber[]> {
  try {
    const r = await getEmergencyNumbers();
    if (r.numbers?.length) {
      await AsyncStorage.setItem(KEY, JSON.stringify(r.numbers)).catch(() => undefined);
      return r.numbers;
    }
  } catch { /* offline: fall through */ }
  try {
    const cached = await AsyncStorage.getItem(KEY);
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }
  const c = countryCode && isCountryCode(countryCode) ? countryCode : 'PK';
  return COUNTRIES[c].emergencyNumbers;
}
