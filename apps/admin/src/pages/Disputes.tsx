import { useEffect, useState } from 'react';
import { getDisputeDetail, listDisputes, money, parseMajor, resolveDispute } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { Badge, errText, Failed, Loading, Section, when } from '../ui';
import './Pages.css';

function Dispute({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { can } = useStaff();
  const { data: d, loading, error, reload } = useLoad(() => getDisputeDetail(id), [id]);
  const [resolution, setResolution] = useState('');
  const [outcome, setOutcome] = useState<'' | 'CONFIRM' | 'VOID'>('');
  const [adjust, setAdjust] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  if (loading && !d) return <Loading />;
  if (error && !d) return <Failed message={error} retry={reload} />;
  if (!d) return null;
  const closed = d.status === 'RESOLVED' || d.status === 'CLOSED';
  const act = async (status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED') => {
    setErr(undefined);
    const body: Parameters<typeof resolveDispute>[1] = { status, ...(resolution.trim() ? { resolution: resolution.trim() } : {}) };
    if (status !== 'IN_REVIEW') {
      if (!resolution.trim()) return setErr('Write what was decided; both sides see it.');
      if (outcome) body.paymentOutcome = outcome;
      if (adjust.trim()) {
        const amount = parseMajor(adjust);
        if (amount == null || amount === 0) return setErr('The ledger change must be a number (minus to reduce what the worker owes).');
        body.ledgerAdjustment = { amount, note: `Dispute ${d.id.slice(-6)}: ${resolution.trim()}`.slice(0, 300) };
      }
    }
    setBusy(true);
    try { await resolveDispute(d.id, body); await reload(); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="page-header">
        <h2 style={{ margin: 0 }}>{d.reason}</h2>
        <div className="row-actions"><Badge value={d.category} /><Badge value={d.status} /></div>
      </div>
      <div className="detail-grid">
        <div><p className="text-muted">Raised by</p><p>{d.raisedBy.name} ({d.raisedBy.type})</p></div>
        <div><p className="text-muted">Job</p><p>{d.jobRequest.title ?? 'Job'} · {d.jobRequest.status.toLowerCase()}</p></div>
        <div><p className="text-muted">Agreed price</p><p>{d.jobRequest.agreedAmount != null ? money(d.jobRequest.agreedAmount, d.jobRequest.agreedCurrency) : '–'}</p></div>
        <div><p className="text-muted">Payment</p><p>{d.payment ? <>{money(d.payment.amount, d.payment.currency)} <Badge value={d.payment.status} /></> : '–'}</p></div>
        <div><p className="text-muted">Opened</p><p>{when(d.createdAt)}</p></div>
      </div>
      {d.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{d.description}</p> : null}
      {d.evidence?.length ? (
        <div className="detail-grid" style={{ marginTop: 12 }}>
          {d.evidence.map((u: string, k: number) => <a key={k} href={u} target="_blank" rel="noreferrer"><img className="doc-img" src={u} alt={`Evidence ${k + 1}`} /></a>)}
        </div>
      ) : null}
      {closed ? <p><strong>Decision:</strong> {d.resolution ?? 'Closed'}</p> : can('disputes.resolve') ? (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea className="reason-input" rows={3} placeholder="What was decided (both sides see this)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          {d.payment && d.payment.status !== 'CONFIRMED' ? (
            <label className="text-muted">Cash payment&nbsp;
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                <option value="">Leave as is</option><option value="CONFIRM">It was paid (book commission)</option><option value="VOID">It was not paid (void it)</option>
              </select>
            </label>
          ) : null}
          {can('finance.adjust') ? <input className="reason-input" placeholder="Change what the worker owes, e.g. -200 (optional)" value={adjust} onChange={(e) => setAdjust(e.target.value)} /> : null}
          <div className="row-actions">
            {d.status === 'OPEN' ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('IN_REVIEW')}>Start review</button> : null}
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act('RESOLVED')}>Resolve</button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('CLOSED')}>Close without action</button>
          </div>
        </div>
      ) : null}
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </div>
  );
}

export default function Disputes() {
  const { clearBadge, resync } = useStaff();
  const { data, loading, error, reload } = useLoad(listDisputes, [resync]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { clearBadge('dispute'); }, [clearBadge]);
  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Disputes</h1><button className="btn btn-ghost" onClick={reload}>Refresh</button></div>
      {open ? <Section title="Dispute" actions={<button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>}><Dispute id={open} onChanged={reload} /></Section> : null}
      {loading && !data ? <Loading /> : error && !data ? <Failed message={error} retry={reload} /> : (
        <div className="card glass-panel">
          <table className="data-table">
            <thead><tr><th>Raised by</th><th>Reason</th><th>Status</th><th>Opened</th></tr></thead>
            <tbody>
              {!data?.length ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32 }}>No disputes.</td></tr> : data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                  <td>{d.raisedBy.name} <span className="text-muted">({d.raisedBy.type})</span></td>
                  <td>{d.reason}</td><td><Badge value={d.status} /></td><td>{when(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
