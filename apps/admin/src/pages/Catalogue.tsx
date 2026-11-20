import { useState } from 'react';
import { adminCatalog, listPriceBands, money, parseMajor, saveIssue, savePriceBand, updateCategoryContent, type AdminCategory, type AdminIssue } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { errText, Failed, Loading, Section } from '../ui';
import './Pages.css';

const LANGS = [['en', 'English'], ['ur', 'Urdu'], ['ar', 'Arabic']] as const;
type Tr = Record<string, { name?: string }>;

function Names({ value, onChange }: { value: Tr; onChange: (v: Tr) => void }) {
  return (
    <div className="row-actions">
      {LANGS.map(([code, label]) => (
        <input key={code} className="reason-input" dir={code === 'en' ? 'ltr' : 'rtl'} placeholder={label} aria-label={label} value={value[code]?.name ?? ''}
          onChange={(e) => onChange({ ...value, [code]: { name: e.target.value } })} />
      ))}
    </div>
  );
}

function IssueRow({ categoryId, issue, onSaved }: { categoryId: string; issue?: AdminIssue; onSaved: () => void }) {
  const { can } = useStaff();
  const [code, setCode] = useState(issue?.code ?? '');
  const [tr, setTr] = useState<Tr>(issue?.translations ?? (issue ? { en: { name: issue.name } } : {}));
  const [active, setActive] = useState(issue?.isActive ?? true);
  const [msg, setMsg] = useState<string | undefined>();
  const save = async () => {
    const name = tr.en?.name?.trim() || issue?.name;
    if (!name || !code.trim()) return setMsg('Needs a code and an English name.');
    try { await saveIssue(categoryId, { code: code.trim(), name, translations: tr, isActive: active }); setMsg('Saved'); if (!issue) { setCode(''); setTr({}); } onSaved(); } catch (e) { setMsg(errText(e)); }
  };
  return (
    <div className="row-actions" style={{ alignItems: 'center', marginBottom: 8 }}>
      <input className="reason-input mono" style={{ width: 170 }} placeholder="code, e.g. leaking_tap" value={code} disabled={!!issue} onChange={(e) => setCode(e.target.value.toLowerCase())} />
      <Names value={tr} onChange={setTr} />
      <label className="text-muted"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> shown</label>
      {can('catalog.edit') ? <button className="btn btn-sm btn-primary" onClick={save}>{issue ? 'Save' : 'Add problem'}</button> : null}
      {msg ? <span className="text-muted">{msg}</span> : null}
    </div>
  );
}

function CategoryEditor({ c, onSaved }: { c: AdminCategory; onSaved: () => void }) {
  const { can } = useStaff();
  const [tr, setTr] = useState<Tr>(c.translations ?? { en: { name: c.name } });
  const [msg, setMsg] = useState<string | undefined>();
  const save = async (body: Parameters<typeof updateCategoryContent>[1]) => {
    try { await updateCategoryContent(c.id, body); setMsg('Saved'); onSaved(); } catch (e) { setMsg(errText(e)); }
  };
  return (
    <Section title={c.translations?.en?.name ?? c.name} actions={can('catalog.edit') ? <button className="btn btn-sm btn-ghost" onClick={() => save({ isActive: !c.isActive })}>{c.isActive ? 'Hide category' : 'Show category'}</button> : null}>
      {!c.isActive ? <p className="form-error">Hidden from customers and workers.</p> : null}
      <p className="text-muted">Name in each language</p>
      <div className="row-actions"><Names value={tr} onChange={setTr} />{can('catalog.edit') ? <button className="btn btn-sm btn-primary" onClick={() => save({ translations: tr })}>Save names</button> : null}{msg ? <span className="text-muted">{msg}</span> : null}</div>
      <p className="text-muted" style={{ marginTop: 16 }}>Common problems (what customers pick when they ask for help)</p>
      {c.issues.map((i) => <IssueRow key={i.id} categoryId={c.id} issue={i} onSaved={onSaved} />)}
      {can('catalog.edit') ? <IssueRow categoryId={c.id} onSaved={onSaved} /> : null}
    </Section>
  );
}

function PriceBands({ cats }: { cats: AdminCategory[] }) {
  const { can } = useStaff();
  const { data, loading, error, reload } = useLoad(listPriceBands);
  const [f, setF] = useState({ categoryId: '', issueCode: '', city: '', min: '', max: '', approved: false });
  const [msg, setMsg] = useState<string | undefined>();
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
  const save = async () => {
    const minMinor = parseMajor(f.min); const maxMinor = parseMajor(f.max);
    if (!f.categoryId || !f.city.trim() || minMinor == null || maxMinor == null) return setMsg('Pick a category, a city and both amounts.');
    if (minMinor > maxMinor) return setMsg('The lowest price is above the highest.');
    try { await savePriceBand({ categoryId: f.categoryId, issueCode: f.issueCode || null, city: f.city.trim(), currency: 'PKR', minMinor, maxMinor, approved: f.approved }); setMsg('Saved'); await reload(); } catch (e) { setMsg(errText(e)); }
  };
  return (
    <Section title="Typical price ranges">
      <p className="text-muted">Shown to customers as a guide only once a range is approved and the SHOW_PRICE_BANDS setting is on. Workers always set their own price.</p>
      <table className="data-table">
        <thead><tr><th>Category</th><th>Problem</th><th>City</th><th>Range</th><th>Approved</th></tr></thead>
        <tbody>{(data ?? []).map((b) => (
          <tr key={b.id} className="clickable" onClick={() => setF({ categoryId: b.categoryId, issueCode: b.issueCode ?? '', city: b.city, min: String(b.minMinor / 100), max: String(b.maxMinor / 100), approved: b.approved })}>
            <td>{catName(b.categoryId)}</td><td>{b.issueCode ?? 'any'}</td><td>{b.city}</td><td>{money(b.minMinor, b.currency)} – {money(b.maxMinor, b.currency)}</td><td>{b.approved ? 'Yes' : 'No'}</td>
          </tr>
        ))}</tbody>
      </table>
      {can('catalog.edit') ? (
        <div className="row-actions" style={{ marginTop: 12, alignItems: 'center' }}>
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value, issueCode: '' })} aria-label="Category"><option value="">Category…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.issueCode} onChange={(e) => setF({ ...f, issueCode: e.target.value })} aria-label="Problem"><option value="">Any problem</option>{cats.find((c) => c.id === f.categoryId)?.issues.map((i) => <option key={i.id} value={i.code}>{i.name}</option>)}</select>
          <input className="reason-input" style={{ width: 120 }} placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <input className="reason-input" style={{ width: 110 }} placeholder="From (PKR)" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          <input className="reason-input" style={{ width: 110 }} placeholder="To (PKR)" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
          <label className="text-muted"><input type="checkbox" checked={f.approved} onChange={(e) => setF({ ...f, approved: e.target.checked })} /> approved</label>
          <button className="btn btn-sm btn-primary" onClick={save}>Save range</button>
          {msg ? <span className="text-muted">{msg}</span> : null}
        </div>
      ) : null}
    </Section>
  );
}

export default function Catalogue() {
  const { data, loading, error, reload } = useLoad(adminCatalog);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Service catalogue</h1></div>
      {!data?.length ? <div className="state-box">The catalogue is empty. Run the catalogue seed (pnpm --filter @fixli/api db:seed:catalog).</div> : null}
      {data?.map((c) => <CategoryEditor key={c.id} c={c} onSaved={reload} />)}
      {data?.length ? <PriceBands cats={data} /> : null}
    </div>
  );
}
