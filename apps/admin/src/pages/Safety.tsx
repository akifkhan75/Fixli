import { useEffect, useState } from 'react';
import { getIncident, listIncidents, updateIncident, type IncidentRow } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { Badge, errText, Failed, Loading, Section, when } from '../ui';
import './Pages.css';

const STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];

function Incident({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { can } = useStaff();
  const { data: i, loading, error, reload } = useLoad(() => getIncident(id), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  if (loading && !i) return <Loading />;
  if (error && !i) return <Failed message={error} retry={reload} />;
  if (!i) return null;
  const save = async (body: { status?: string; note?: string }) => {
    setBusy(true); setErr(undefined);
    try { await updateIncident(i.id, body); setNote(''); await reload(); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="page-header">
        <h2 style={{ margin: 0 }}>{(i.kind ?? i.type).replace(/_/g, ' ').toLowerCase()}</h2>
        <div className="row-actions"><Badge value={i.severity} /><Badge value={i.status} /></div>
      </div>
      <div className="detail-grid">
        <div><p className="text-muted">Reported by</p><p>{i.reporter.name} ({i.reporter.type})</p></div>
        <div><p className="text-muted">About</p><p>{i.target ? `${i.target.name} (${i.target.type}, ${i.target.status.toLowerCase()})` : '–'}</p></div>
        <div><p className="text-muted">Job</p><p>{i.jobRequest ? `${i.jobRequest.title ?? 'Job'} · ${i.jobRequest.status.toLowerCase()}` : '–'}</p></div>
        <div><p className="text-muted">Trusted contacts</p><p>{i.contactsAlertStatus?.toLowerCase() ?? 'not alerted'}</p></div>
        <div><p className="text-muted">Reported</p><p>{when(i.createdAt)}</p></div>
      </div>
      {i.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{i.description}</p> : null}
      <h3 style={{ fontSize: '1rem' }}>Notes</h3>
      {!i.notes.length ? <p className="text-muted">No notes yet.</p> : i.notes.map((n) => <p key={n.id}><span className="text-muted">{when(n.createdAt)}:</span> {n.text}</p>)}
      {can('safety.manage') ? (
        <div className="row-actions" style={{ marginTop: 12 }}>
          <input className="reason-input" style={{ flex: 1, minWidth: 240 }} placeholder="Add a note (what you did, who you called)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={busy || note.trim().length < 2} onClick={() => save({ note: note.trim() })}>Add note</button>
          {STATUSES.filter((s) => s !== i.status).map((s) => (
            <button key={s} className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save({ status: s, ...(note.trim() ? { note: note.trim() } : {}) })}>Mark {s.toLowerCase()}</button>
          ))}
        </div>
      ) : null}
      {err ? <p className="form-error" role="alert">{err}</p> : null}
    </div>
  );
}

export default function Safety() {
  const { clearBadge, resync } = useStaff();
  const [status, setStatus] = useState('OPEN');
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(() => listIncidents({ status: status || undefined }), [status, resync]);
  useEffect(() => { clearBadge('incident'); }, [clearBadge]);
  useEffect(() => { if (data) { setRows(data.items); setCursor(data.nextCursor); } }, [data]);
  const more = async () => { if (!cursor) return; const p = await listIncidents({ status: status || undefined, cursor }); setRows((r) => [...r, ...p.items]); setCursor(p.nextCursor); };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Safety</h1>
        <div className="row-actions">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={reload}>Refresh</button>
        </div>
      </div>
      {open ? <Section title="Incident" actions={<button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>}><Incident id={open} onChanged={reload} /></Section> : null}
      {loading && !data ? <Loading /> : error && !data ? <Failed message={error} retry={reload} /> : (
        <div className="card glass-panel">
          <table className="data-table">
            <thead><tr><th>What</th><th>Severity</th><th>Status</th><th>Reported by</th><th>When</th></tr></thead>
            <tbody>
              {!rows.length ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}>Nothing here.</td></tr> : rows.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => setOpen(i.id)}>
                  <td>{(i.kind ?? i.type).replace(/_/g, ' ').toLowerCase()}{i.jobRequest ? <div className="text-muted">{i.jobRequest.title ?? 'Job'}</div> : null}</td>
                  <td><Badge value={i.severity} /></td><td><Badge value={i.status} /></td>
                  <td>{i.reporter.name}</td><td>{when(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor ? <button className="btn btn-ghost" onClick={more}>Load more</button> : null}
        </div>
      )}
    </div>
  );
}
