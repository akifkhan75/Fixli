import { equipmentSuggestionsFor, normalizeEquipment } from '../utils/equipmentSuggestions';

describe('equipmentSuggestions', () => {
  it('suggests electrical tools including LT and drill', () => {
    const tools = equipmentSuggestionsFor(['ELECTRICAL']);
    expect(tools).toEqual(expect.arrayContaining(['Drill machine', 'LT (line tester)', 'Multimeter']));
  });

  it('merges suggestions across categories', () => {
    const tools = equipmentSuggestionsFor(['PAINTING', 'ELECTRICAL']);
    expect(tools).toEqual(expect.arrayContaining(['Spray paint gun', 'Drill machine']));
  });

  it('falls back to common tools when no category matches', () => {
    expect(equipmentSuggestionsFor([])).toEqual(expect.arrayContaining(['Drill machine', 'Hammer']));
  });

  it('normalizes, dedupes and caps equipment', () => {
    expect(normalizeEquipment(['  Drill  ', 'drill', 'LT', '', 'a'.repeat(80)], 2)).toEqual([
      'Drill',
      'LT',
    ]);
  });
});
