import { selectRecipients } from './rules';

const w = (id: string, distanceKm: number | null, score: number) => ({ id, distanceKm, score });
const ranked = [w('best-score-far', 9, 0.9), w('nearest', 0.5, 0.6), w('mid', 3, 0.7), w('unknown', null, 0.8)];
const base = { limit: 2, sosFirst: 1, sosCascade: 3 };

describe('selectRecipients (SOS cascade)', () => {
  it('normal jobs: best N by score', () => {
    const r = selectRecipients(ranked, { ...base, isEmergency: false, round: 1 });
    expect(r.map((x) => x.id)).toEqual(['best-score-far', 'unknown']);
  });
  it('SOS round 1: only the NEAREST worker, even with a lower score', () => {
    const r = selectRecipients(ranked, { ...base, isEmergency: true, round: 1 });
    expect(r.map((x) => x.id)).toEqual(['nearest']);
  });
  it('SOS round 1: unknown distance never beats a known one', () => {
    expect(selectRecipients([w('u', null, 1), w('k', 20, 0.1)], { ...base, isEmergency: true, round: 1 }).map((x) => x.id)).toEqual(['k']);
  });
  it('SOS round 2: cascade to the top few by score (includes the nearest if it scores)', () => {
    const r = selectRecipients(ranked, { ...base, isEmergency: true, round: 2 });
    expect(r.map((x) => x.id)).toEqual(['best-score-far', 'unknown', 'mid']);
  });
  it('empty in, empty out; never mutates the input', () => {
    expect(selectRecipients([], { ...base, isEmergency: true, round: 1 })).toEqual([]);
    const copy = [...ranked];
    selectRecipients(ranked, { ...base, isEmergency: true, round: 1 });
    expect(ranked).toEqual(copy);
  });
});
