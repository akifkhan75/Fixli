import { useEffect, useState } from 'react';
import { ApiError, listIncidents, updateIncident, type IncidentRow } from '../api';
import { useLoad } from '../hooks';
import './Pages.css';

const SEVERITY: Record<IncidentRow['severity'], { label: string; cls: string }> = {
  LIFE_THREATENING: { label: 'Life-threatening', cls: 'badge-danger' },
  PROPERTY_DAMAGE: { label: 'Property damage', cls: 'badge-warning' },
  MODERATE: { label: 'Moderate', cls: 'badge-warning' },
};
const RANK = { OPEN: 0, INVESTIGATING: 1, RESOLVED: 2 } as const;
const REFRESH_MS = 15_000;

/** Safety queue: newest life-threatening first. Refreshes itself so a new SOS shows up without a click. */
export default function Incidents() {
  const [showResolved, setShowResolved] = useState(false);
  const { data, loading, error, reload } = useLoad(() => listIncidents(), []);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | undefined>();

  useEffect(() => {
    const t = setInterval(() => { void reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const act = async (id: string, status: 'INVESTIGATING' | 'RESOLVED') => {
    setBusy(id); setActionError(undefined);
    try { await updateIncident(id, status, note[id]?.trim() || undefined); await reload(); }
    catch (e) { setActionError(e instanceof ApiError ? e.message : 'Could not update the incident.'); await reload(); }
    finally { setBusy(null); }
  };

  const rows = (data ?? [])
    .filter((i) => showResolved || i.status !== 'RESOLVED')
    .sort((a, b) => RANK[a.status] - RANK[b.status] || (a.severity === 'LIFE_THREATENING' ? -1 : 0) - (b.severity === 'LIFE_THREATENING' ? -1 : 0) || +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Safety incidents</h1>
        <label className="text-muted"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
      </div>
      <p className="text-muted">Updates every {REFRESH_MS / 1000} seconds. Fixli does not text the person's trusted contacts yet: call the reporter and, if anyone is in danger, make sure they have called emergency services.</p>
      <div className="card glass-panel list-card">
        <div className="table-header">
          <div className="col">Reporter</div><div className="col">What</div><div className="col">Status</div><div className="col">When</div><div className="col">Actions</div>
        </div>
        {loading && !data ? <div className="state-box">Loading…</div>
          : error && !data ? <div className="state-box"><p>{error}</p><button className="btn btn-primary" onClick={reload}>Try again</button></div>
          : !rows.length ? <div className="state-box">No open incidents.</div>
          : rows.map((i) => {
            const sev = SEVERITY[i.severity] ?? SEVERITY.MODERATE;
            return (
              <div key={i.id} className="table-row">
                <div className="col font-medium">
                  {i.reporter.name} <span className="text-muted">({i.reporter.type})</span>
                  {i.reporter.phone ? <div><a href={`tel:${i.reporter.phone}`}>{i.reporter.phone}</a></div> : null}
                </div>
                <div className="col">
                  <span className={`badge ${sev.cls}`}>{sev.label}</span> <span className="text-muted">{i.type.replace('_', ' ').toLowerCase()}</span>
                  {i.description ? <div className="text-muted">{i.description}</div> : null}
                  {i.latitude != null && i.longitude != null
                    ? <div><a href={`https://www.openstreetmap.org/?mlat=${i.latitude}&mlon=${i.longitude}#map=17/${i.latitude}/${i.longitude}`} target="_blank" rel="noreferrer">Open location</a></div>
                    : <div className="text-muted">No location sent</div>}
                  {i.jobRequest ? <div className="text-muted">Job {i.jobRequest.id.slice(-6)} ({i.jobRequest.status.toLowerCase().replace('_', ' ')})</div> : null}
                </div>
                <div className="col"><span className="badge badge-warning">{i.status.toLowerCase()}</span></div>
                <div className="col text-muted">{new Date(i.createdAt).toLocaleString()}</div>
                <div className="col">
                  {i.status === 'RESOLVED' ? <span className="text-muted">Resolved</span> : (
                    <div className="row-actions">
                      <input className="reason-input" placeholder="What was done" value={note[i.id] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [i.id]: e.target.value }))} />
                      {i.status === 'OPEN' ? <button className="btn btn-sm btn-ghost" disabled={busy === i.id} onClick={() => act(i.id, 'INVESTIGATING')}>I'm on it</button> : null}
                      <button className="btn btn-sm btn-primary" disabled={busy === i.id || !(note[i.id] ?? '').trim()} onClick={() => act(i.id, 'RESOLVED')}>Resolve</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
    </div>
  );
}
