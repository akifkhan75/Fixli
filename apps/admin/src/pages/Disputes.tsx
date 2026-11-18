import { useState } from 'react';
import { ApiError, listDisputes, updateDispute } from '../api';
import { useLoad } from '../hooks';
import './Pages.css';

export default function Disputes() {
  const { data, loading, error, reload } = useLoad(listDisputes);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  const act = async (id: string, status: 'IN_REVIEW' | 'RESOLVED' | 'CLOSED') => {
    setBusy(id); setActionError(undefined);
    try { await updateDispute(id, status, resolution[id]?.trim() || undefined); await reload(); }
    catch (e) { setActionError(e instanceof ApiError ? e.message : 'Could not update the dispute.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Disputes</h1></div>
      <div className="card glass-panel list-card">
        <div className="table-header">
          <div className="col">Raised by</div><div className="col">Reason</div><div className="col">Status</div><div className="col">Opened</div><div className="col">Actions</div>
        </div>
        {loading && !data ? <div className="state-box">Loading…</div>
          : error && !data ? <div className="state-box"><p>{error}</p><button className="btn btn-primary" onClick={reload}>Try again</button></div>
          : !data?.length ? <div className="state-box">No disputes. </div>
          : data.map((d) => (
            <div key={d.id} className="table-row">
              <div className="col font-medium">{d.raisedBy.name} <span className="text-muted">({d.raisedBy.type})</span></div>
              <div className="col">{d.reason}{d.category && d.category !== 'OTHER' ? <span className="text-muted"> · {d.category.replace('_', ' ').toLowerCase()}</span> : null}{d.description ? <div className="text-muted">{d.description}</div> : null}{d.amountHeld ? <div className="text-muted">Amount in question: {(d.amountHeld / 100).toLocaleString()} (set by the payment report)</div> : null}</div>
              <div className="col"><span className="badge badge-warning">{d.status.replace('_', ' ').toLowerCase()}</span></div>
              <div className="col text-muted">{new Date(d.createdAt).toLocaleDateString()}</div>
              <div className="col">
                {d.status === 'RESOLVED' || d.status === 'CLOSED' ? <span className="text-muted">{d.resolution ?? 'Closed'}</span> : (
                  <div className="row-actions">
                    <input className="reason-input" placeholder="Resolution note" value={resolution[d.id] ?? ''} onChange={(e) => setResolution((r) => ({ ...r, [d.id]: e.target.value }))} />
                    {d.status === 'OPEN' ? <button className="btn btn-sm btn-ghost" disabled={busy === d.id} onClick={() => act(d.id, 'IN_REVIEW')}>Start review</button> : null}
                    <button className="btn btn-sm btn-primary" disabled={busy === d.id} onClick={() => act(d.id, 'RESOLVED')}>Resolve</button>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
    </div>
  );
}
