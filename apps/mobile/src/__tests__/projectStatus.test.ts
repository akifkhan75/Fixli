import { projectSentence, splitByPercent, stageLook } from '../utils/projectStatus';

describe('project helpers', () => {
  it('splits a total into stages that always add up, in whole units', () => {
    const stages = splitByPercent(10_000_100, [{ title: 'a', percent: 33 }, { title: 'b', percent: 33 }, { title: 'c', percent: 34 }], 100);
    expect(stages.reduce((s, x) => s + x.amount, 0)).toBe(10_000_100);
    expect(stages[0].amount % 100).toBe(0);
    expect(stages.every((s) => s.amount > 0)).toBe(true);
  });

  it('a single stage gets everything', () => {
    expect(splitByPercent(500, [{ title: 'all', percent: 100 }], 100)).toEqual([{ title: 'all', amount: 500 }]);
  });

  it('has a sentence for every state, never a raw code', () => {
    for (const s of ['DRAFT', 'OPEN', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const) {
      for (const v of ['customer', 'worker'] as const) expect(projectSentence(s, v)).not.toMatch(/[A-Z]{3,}_|^project\./);
    }
    for (const s of ['PENDING', 'FUNDED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'RELEASED', 'DISPUTED', 'CANCELLED'] as const) {
      expect(stageLook(s).label).not.toMatch(/^stage\./);
    }
  });
});
