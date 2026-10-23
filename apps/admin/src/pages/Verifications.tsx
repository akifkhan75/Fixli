import { useEffect, useState } from 'react';
import { useStaff } from '../staff';
import { ApiError, decideCase, getCase, listCases, type CaseDetail } from '../api';
import { useLoad } from '../hooks';
import './Pages.css';

const TYPE_LABEL: Record<string, string> = { ID: 'ID card', SELFIE: 'Selfie', TRADE_LICENSE: 'Trade licence', INSURANCE: 'Insurance' };

export default function Verifications() {
  const { clearBadge, resync } = useStaff();
  const queue = useLoad(() => listCases('SUBMITTED'), [resync]);
  useEffect(() => { clearBadge('verification'); }, [clearBadge]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async (id: string) => {
    setOpenId(id); setDetail(null); setDetailError(undefined); setReason('');
    try { setDetail(await getCase(id)); } catch (e) { setDetailError(e instanceof ApiError ? e.message : 'Could not load the documents.'); }
  };

  const decide = async (decision: 'APPROVE' | 'REJECT' | 'NEEDS_INFO') => {
    if (!detail) return;
    if (decision !== 'APPROVE' && !reason.trim()) { setDetailError('Please write what the worker should fix.'); return; }
    setBusy(true); setDetailError(undefined);
    try {
      await decideCase(detail.id, decision, reason.trim() || undefined);
      setOpenId(null); setDetail(null);
      await queue.reload();
    } catch (e) { setDetailError(e instanceof ApiError ? e.message : 'Could not save your decision.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Worker verifications</h1></div>

      {openId ? (
        <div className="card glass-panel" style={{ padding: '1.5rem' }}>
          <div className="page-header">
            <h2>{detail ? `${detail.worker.user.name} · ${TYPE_LABEL[detail.type] ?? detail.type}` : 'Loading…'}</h2>
            <button className="btn btn-ghost" onClick={() => { setOpenId(null); setDetail(null); }}>Back to list</button>
          </div>
          {detail ? (
            <>
              <p className="text-muted">
                Phone {detail.worker.user.phone ?? '—'}{detail.reference ? ` · ID number ${detail.reference}` : ''} · submitted {new Date(detail.createdAt).toLocaleString()}
              </p>
              <p className="text-muted">Other documents: {detail.worker.verifications.map((v) => `${TYPE_LABEL[v.type] ?? v.type} (${v.status.toLowerCase().replace('_', ' ')})`).join(', ')}</p>
              <div className="detail-grid" style={{ margin: '1rem 0' }}>
                {detail.documents.map((d, i) => <img key={d.url} className="doc-img" src={d.url} alt={`Document ${i + 1}`} />)}
              </div>
              <textarea className="reason-input" style={{ width: '100%' }} rows={3} placeholder="Reason (required to reject or ask for a new photo). The worker will read this." value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="row-actions" style={{ marginTop: '1rem' }}>
                <button className="btn btn-primary" disabled={busy} onClick={() => decide('APPROVE')}>Approve</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => decide('NEEDS_INFO')}>Ask for a new photo</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => decide('REJECT')}>Reject</button>
              </div>
            </>
          ) : null}
          {detailError ? <p className="form-error" role="alert">{detailError}</p> : null}
        </div>
      ) : (
        <div className="card glass-panel list-card">
          <div className="table-header">
            <div className="col">Worker</div><div className="col">Phone</div><div className="col">Document</div><div className="col">Submitted</div><div className="col">Actions</div>
          </div>
          {queue.loading && !queue.data ? <div className="state-box">Loading…</div>
            : queue.error && !queue.data ? <div className="state-box"><p>{queue.error}</p><button className="btn btn-primary" onClick={queue.reload}>Try again</button></div>
            : !queue.data?.items.length ? <div className="state-box">Nothing waiting for review. 🎉</div>
            : queue.data.items.map((c) => (
              <div key={c.id} className="table-row clickable" onClick={() => open(c.id)}>
                <div className="col font-medium">{c.worker.user.name}</div>
                <div className="col text-muted">{c.worker.user.phone ?? '—'}</div>
                <div className="col">{TYPE_LABEL[c.type] ?? c.type}</div>
                <div className="col text-muted">{new Date(c.createdAt).toLocaleString()}</div>
                <div className="col"><button className="btn btn-sm btn-primary">Review</button></div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
