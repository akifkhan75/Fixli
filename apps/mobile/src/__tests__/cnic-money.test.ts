import { formatCnic, isCompleteCnic } from '../utils/cnic';
import { formatMoney, parseMajorToMinor } from '../utils/money';
import { localizedName, humanize } from '../utils/catalog';

describe('CNIC mask', () => {
  it('formats as digits are typed and ignores everything else', () => {
    expect(formatCnic('42101')).toBe('42101');
    expect(formatCnic('421011234567')).toBe('42101-1234567');
    expect(formatCnic('4210112345671')).toBe('42101-1234567-1');
    expect(formatCnic('42101-1234567-1 extra 99')).toBe('42101-1234567-1');
    expect(formatCnic('abc')).toBe('');
  });
  it('knows when it is complete', () => {
    expect(isCompleteCnic('42101-1234567-1')).toBe(true);
    expect(isCompleteCnic('42101-123456')).toBe(false);
  });
});

describe('money', () => {
  it('formats minor units with the currency decimals, never floats', () => {
    expect(formatMoney(150000, 'PKR')).toMatch(/1,500/);
    expect(formatMoney(150050, 'PKR')).toMatch(/1,500\.5/);
    expect(formatMoney(500, 'JPY')).toMatch(/500/);
  });
  it('parses what a person types into integer minor units', () => {
    expect(parseMajorToMinor('1500', 'PKR')).toBe(150000);
    expect(parseMajorToMinor('1,500.50', 'PKR')).toBe(150050);
    expect(parseMajorToMinor('0', 'PKR')).toBeNull();
    expect(parseMajorToMinor('-5', 'PKR')).toBeNull();
    expect(parseMajorToMinor('12abc', 'PKR')).toBeNull();
    expect(parseMajorToMinor('', 'PKR')).toBeNull();
  });
});

describe('catalog names', () => {
  it('uses the translation, falling back to the stored name', () => {
    const c = { name: 'Plumbing', translations: { ur: { name: 'پلمبنگ' } } };
    expect(localizedName(c, 'ur')).toBe('پلمبنگ');
    expect(localizedName(c, 'ar')).toBe('Plumbing');
    expect(localizedName(c, 'en')).toBe('Plumbing');
    expect(humanize('APPLIANCE_REPAIR')).toBe('Appliance repair');
  });
});

describe('money is the same on every device (doc 26 9.10)', () => {
  it('PKR always has 2 decimals here, whatever the phone\'s Intl says; no float errors', () => {
    expect(parseMajorToMinor('0.29', 'PKR')).toBe(29);
    expect(parseMajorToMinor('2500', 'PKR')).toBe(250000);
    expect(formatMoney(250000, 'PKR')).toMatch(/2,500(?!\.)/);
  });
});
