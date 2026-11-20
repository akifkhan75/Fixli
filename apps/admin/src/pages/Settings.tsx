import { useEffect, useState } from 'react';
import { getCountryConfig, listFlags, money, parseMajor, saveCountryConfig, setFlag, type CountryConfig } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { errText, Failed, Loading, Section, when } from '../ui';
import './Pages.css';

/** What staff type (major units, percent) – converted to the stored integers on save. */
interface Draft {
  ratePct: string; commMin: string; commMax: string; soft: string; hard: string; days: string;
  rails: { id: string; label: string; account: string }[]; numbers: { label: string; number: string }[];
}
const toDraft = (c: CountryConfig): Draft => ({
  ratePct: String(c.commission.rateBps / 100), commMin: String(c.commission.minMinor / 100), commMax: String(c.commission.maxMinor / 100),
  soft: String(c.cashLimits.softMinor / 100), hard: String(c.cashLimits.hardMinor / 100), days: String(c.cashLimits.maxDaysOwed),
  rails: c.settlementRails.map((r) => ({ ...r, account: r.account ?? '' })), numbers: c.emergencyNumbers.map((n) => ({ ...n })),
});

function Country({ code }: { code: string }) {
  const { can } = useStaff();
  const editable = can('config.edit');
  const { data: c, loading, error, reload } = useLoad(() => getCountryConfig(code), [code]);
  const [d, setD] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (c) setD(toDraft(c)); }, [c]);
  if (loading && !c) return <Loading />;
  if (error && !c) return <Failed message={error} retry={reload} />;
  if (!c || !d) return null;

  const save = async () => {
    const rate = Number(d.ratePct);
    const nums = [parseMajor(d.commMin), parseMajor(d.commMax), parseMajor(d.soft), parseMajor(d.hard)];
    if (!Number.isFinite(rate) || rate < 0 || rate > 50 || nums.some((n) => n == null || n < 0) || !Number.isInteger(Number(d.days))) return setMsg({ ok: false, text: 'Check the numbers: commission 0–50%, amounts and days must be numbers.' });
    const [minMinor, maxMinor, softMinor, hardMinor] = nums as number[];
    if (minMinor > maxMinor) return setMsg({ ok: false, text: 'The lowest commission is above the highest.' });
    if (softMinor >= hardMinor) return setMsg({ ok: false, text: 'The warning amount must be below the blocking amount.' });
    if (!window.confirm(`Save new ${code} settings? This changes commission and limits for every new job.`)) return;
    setBusy(true); setMsg(null);
    try {
      await saveCountryConfig(code, {
        baseVersion: c.version,
        commission: { rateBps: Math.round(rate * 100), minMinor, maxMinor },
        cashLimits: { softMinor, hardMinor, maxDaysOwed: Number(d.days) },
        settlementRails: d.rails.filter((r) => r.id.trim()).map((r) => ({ id: r.id.trim().toUpperCase(), label: r.label.trim(), account: r.account.trim() || null })),
        emergencyNumbers: d.numbers.filter((n) => n.number.trim()).map((n) => ({ label: n.label.trim(), number: n.number.trim() })),
      });
      setMsg({ ok: true, text: 'Saved as a new version.' });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) + (String(errText(e)).includes('changed') ? ' Your edits are still here; reload to see theirs.' : '') });
    } finally { setBusy(false); }
  };
  const input = (k: keyof Omit<Draft, 'rails' | 'numbers'>, label: string) => (
    <label className="text-muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{label}
      <input className="reason-input" value={d[k]} disabled={!editable} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  );

  return (
    <Section title={`${code} · version ${c.version}`} actions={<span className="text-muted">{c.currency}</span>}>
      <div className="detail-grid">
        {input('ratePct', 'Commission (%)')}{input('commMin', `Lowest commission per job (${c.currency})`)}{input('commMax', `Highest commission per job (${c.currency})`)}
        {input('soft', `Warn worker when owing (${c.currency})`)}{input('hard', `Stop new jobs when owing (${c.currency})`)}{input('days', 'Stop new jobs after owing for (days)')}
      </div>
      <p className="text-muted" style={{ marginTop: 16 }}>Ways workers pay Fixli</p>
      {d.rails.map((r, i) => (
        <div key={i} className="row-actions" style={{ marginBottom: 6 }}>
          {(['id', 'label', 'account'] as const).map((k) => <input key={k} className="reason-input" placeholder={k === 'id' ? 'ID, e.g. JAZZCASH' : k === 'label' ? 'Name shown' : 'Account / number'} disabled={!editable} value={r[k]} onChange={(e) => setD({ ...d, rails: d.rails.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />)}
          {editable ? <button className="btn btn-sm btn-ghost" onClick={() => setD({ ...d, rails: d.rails.filter((_, j) => j !== i) })}>Remove</button> : null}
        </div>
      ))}
      {editable ? <button className="btn btn-sm btn-ghost" onClick={() => setD({ ...d, rails: [...d.rails, { id: '', label: '', account: '' }] })}>Add a way to pay</button> : null}
      <p className="text-muted" style={{ marginTop: 16 }}>Emergency numbers (shown on the SOS screen)</p>
      {d.numbers.map((n, i) => (
        <div key={i} className="row-actions" style={{ marginBottom: 6 }}>
          <input className="reason-input" placeholder="Who, e.g. Police" disabled={!editable} value={n.label} onChange={(e) => setD({ ...d, numbers: d.numbers.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <input className="reason-input" placeholder="Number, e.g. 15" disabled={!editable} value={n.number} onChange={(e) => setD({ ...d, numbers: d.numbers.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })} />
          {editable ? <button className="btn btn-sm btn-ghost" onClick={() => setD({ ...d, numbers: d.numbers.filter((_, j) => j !== i) })}>Remove</button> : null}
        </div>
      ))}
      {editable ? <button className="btn btn-sm btn-ghost" onClick={() => setD({ ...d, numbers: [...d.numbers, { label: '', number: '' }] })}>Add a number</button> : null}
      {editable ? <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save as new version'}</button>
        <button className="btn btn-ghost" onClick={() => { setD(toDraft(c)); setMsg(null); }}>Undo my edits</button>
      </div> : <p className="text-muted">Only a Super Admin can change these.</p>}
      {msg ? <p className={msg.ok ? 'text-muted' : 'form-error'} role="status">{msg.text}</p> : null}
      <p className="text-muted" style={{ marginTop: 16 }}>Earlier versions: {c.versions.map((v) => `v${v.version} (${when(v.createdAt)})`).join(' · ') || 'none'}</p>
      <p className="text-muted">Saved settings, for example: a {money(200000, c.currency)} job pays {money(Math.min(Math.max(Math.round((200000 * c.commission.rateBps) / 10_000), c.commission.minMinor), c.commission.maxMinor, 200000), c.currency)} commission.</p>
    </Section>
  );
}

function Flags() {
  const { can } = useStaff();
  const { data, loading, error, reload } = useLoad(listFlags);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  return (
    <Section title="Switches">
      <table className="data-table">
        <tbody>{(data ?? []).map((f) => (
          <tr key={f.key}>
            <td className="mono"><code>{f.key}</code><div className="text-muted" style={{ fontFamily: 'inherit' }}>{f.description}</div></td>
            <td>{f.value ? 'On' : 'Off'}{!f.setByStaff ? <span className="text-muted"> (default)</span> : null}</td>
            <td>{can('config.edit') ? <button className="btn btn-sm btn-ghost" onClick={async () => { if (!window.confirm(`Turn ${f.key} ${f.value ? 'off' : 'on'}? It takes effect within a minute.`)) return; try { await setFlag(f.key, !f.value); await reload(); } catch (e) { window.alert(errText(e)); } }}>Turn {f.value ? 'off' : 'on'}</button> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </Section>
  );
}

export default function Settings() {
  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Settings</h1></div>
      <Country code="PK" />
      <Flags />
    </div>
  );
}
