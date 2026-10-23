import { Fragment, useEffect, useState } from 'react';
import { getAudit, type AuditRow } from '../api';
import { errText, Failed, Loading, when } from '../ui';
import './Pages.css';

type Filters = { actorId?: string; entityType?: string; entityId?: string; action?: string; from?: string; to?: string };

export default function Audit() {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState<string | null>(null);

  const load = async (f: Filters, after?: string) => {
    setError(undefined);
    try {
      const iso = (d?: string, end = false) => (d ? new Date(`${d}T${end ? '23:59:59' : '00:00:00'}`).toISOString() : undefined);
      const p = await getAudit({ ...f, from: iso(f.from), to: iso(f.to, true), cursor: after });
      setRows((r) => (after ? [...(r ?? []), ...p.items] : p.items));
      setCursor(p.nextCursor);
    } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(filters); }, [filters]);

  const field = (k: keyof Filters, placeholder: string, type = 'text') => (
    <input className="reason-input" type={type} placeholder={placeholder} aria-label={placeholder} value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value || undefined }))} />
  );

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Audit log</h1></div>
      <form className="card glass-panel row-actions" style={{ marginBottom: 20, padding: 16 }} onSubmit={(e) => { e.preventDefault(); setFilters(draft); }}>
        {field('action', 'Action, e.g. user.suspended')}{field('entityType', 'Thing, e.g. User')}{field('entityId', 'Its id')}{field('actorId', 'Staff id')}
        {field('from', 'From', 'date')}{field('to', 'To', 'date')}
        <button className="btn btn-primary">Search</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setDraft({}); setFilters({}); }}>Clear</button>
      </form>
      {error && !rows ? <Failed message={error} retry={() => load(filters)} /> : !rows ? <Loading /> : (
        <div className="card glass-panel">
          <table className="data-table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th></tr></thead>
            <tbody>
              {!rows.length ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32 }}>Nothing matches.</td></tr> : rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                    <td className="mono"><code>{r.actorId?.slice(-8) ?? 'system'}</code></td>
                    <td>{r.action}</td>
                    <td>{r.entityType} <span className="text-muted mono">{r.entityId?.slice(-8)}</span></td>
                  </tr>
                  {open === r.id ? (
                    <tr><td colSpan={4}>
                      <div className="detail-grid">
                        <div><p className="text-muted">Before</p><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(r.before, null, 2) ?? '–'}</pre></div>
                        <div><p className="text-muted">After</p><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(r.after, null, 2) ?? '–'}</pre></div>
                      </div>
                      <p className="text-muted mono">Actor {r.actorId ?? 'system'} · {r.entityType} {r.entityId}</p>
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          {cursor ? <button className="btn btn-ghost" onClick={() => load(filters, cursor)}>Load more</button> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
