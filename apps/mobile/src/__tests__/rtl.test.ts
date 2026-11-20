jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import { mirroredName } from '../components/ds/DirIcon';

describe('RTL helpers', () => {
  it('mirrors forward/back icons only in right-to-left layouts', () => {
    expect(mirroredName('chevron-forward', false)).toBe('chevron-forward');
    expect(mirroredName('chevron-forward', true)).toBe('chevron-back');
    expect(mirroredName('arrow-back', true)).toBe('arrow-forward');
    expect(mirroredName('home-outline', true)).toBe('home-outline');
  });
});
