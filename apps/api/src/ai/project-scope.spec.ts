import { validateProjectScope } from './project-scope';

const answer = (stages: unknown, title = 'House wiring') => `Here: {"title": ${JSON.stringify(title)}, "stages": ${JSON.stringify(stages)}, "questions": ["How many rooms?", 7]}`;

describe('validateProjectScope', () => {
  it('reads a usable answer and drops junk', () => {
    expect(validateProjectScope(answer([{ title: 'Pipes', percent: 40 }, { title: 'Fittings', percent: 60 }]))).toEqual({
      title: 'House wiring', stages: [{ title: 'Pipes', percent: 40 }, { title: 'Fittings', percent: 60 }], questions: ['How many rooms?'],
    });
  });
  it('corrects small rounding so the stages total 100', () => {
    const s = validateProjectScope(answer([{ title: 'a', percent: 33 }, { title: 'b', percent: 33 }, { title: 'c', percent: 33 }]))!;
    expect(s.stages.map((x) => x.percent)).toEqual([33, 33, 34]);
  });
  it('refuses answers that cannot be trusted', () => {
    expect(validateProjectScope('not json')).toBeNull();
    expect(validateProjectScope(answer([]))).toBeNull();
    expect(validateProjectScope(answer([{ title: 'a', percent: 10 }]))).toBeNull();
    expect(validateProjectScope(answer([{ title: 'a', percent: 100 }], ''))).toBeNull();
  });
});
