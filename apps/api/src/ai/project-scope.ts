export interface ProjectScope {
  title: string;
  stages: { title: string; percent: number }[];
  questions: string[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Accepts the model's answer only if it is usable as it stands; percentages are made to total 100. */
export function validateProjectScope(raw: string): ProjectScope | null {
  let o: any;
  try { o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return null; }
  const title = text(o?.title, 80);
  const stages = (Array.isArray(o?.stages) ? o.stages : [])
    .map((s: any) => ({ title: text(s?.title, 80), percent: Math.round(Number(s?.percent)) }))
    .filter((s: { title: string; percent: number }) => s.title && s.percent >= 1 && s.percent <= 100)
    .slice(0, 5);
  if (!title || !stages.length) return null;
  const total = stages.reduce((n: number, s: { percent: number }) => n + s.percent, 0);
  if (total < 80 || total > 120) return null;
  const last = stages[stages.length - 1];
  last.percent += 100 - total;
  if (last.percent < 1) return null;
  const questions = (Array.isArray(o.questions) ? o.questions : []).map((q: unknown) => text(q, 200)).filter(Boolean).slice(0, 4);
  return { title, stages, questions };
}
