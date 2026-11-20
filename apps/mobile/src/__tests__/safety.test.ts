jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../services/api', () => ({ getEmergencyNumbers: jest.fn() }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOS_COPY } from '../safety/copy';
import { loadEmergencyNumbers } from '../services/emergencyNumbers';
import { getEmergencyNumbers } from '../services/api';

const allText = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as any)(3))] : Array.isArray(o) ? o.flatMap(allText) : o && typeof o === 'object' ? Object.values(o).flatMap(allText) : [];

describe('safety wording (legal L10)', () => {
  it('never claims Fixli contacted the police or emergency services, and types no numbers', () => {
    const text = allText(SOS_COPY).join('\n');
    expect(text).not.toMatch(/we (have )?(called|contacted|alerted) (the )?(police|ambulance|emergency|rescue)/i);
    expect(text).not.toMatch(/help is on (the|its) way/i);
    expect(text).not.toMatch(/\b(15|115|16|1122|911|999|112)\b/); // numbers come from configuration
    expect(text).toMatch(/does not contact emergency services/);
  });
});

describe('emergency numbers work offline', () => {
  beforeEach(() => AsyncStorage.clear());
  it('uses the server list and caches it; offline, the cached copy; before any fetch, the country data', async () => {
    (getEmergencyNumbers as jest.Mock).mockResolvedValueOnce({ countryCode: 'PK', numbers: [{ label: 'Rescue', number: '1122' }, { label: 'X', number: '000' }] });
    expect((await loadEmergencyNumbers('PK')).map((n) => n.number)).toEqual(['1122', '000']);
    (getEmergencyNumbers as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await loadEmergencyNumbers('PK')).map((n) => n.number)).toEqual(['1122', '000']);
    await AsyncStorage.clear();
    (getEmergencyNumbers as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    expect((await loadEmergencyNumbers('PK')).map((n) => n.number)).toEqual(expect.arrayContaining(['15', '1122']));
  });
});
