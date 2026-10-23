import { useState } from 'react';
import { adminCancelJob, getJobDetail, getTranscript, listJobs, money, reassignJob, type AdminJobRow } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { Badge, errText, Failed, Loading, ReasonButton, Section, when } from '../ui';
import './Pages.css';

const STATUSES = ['', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'];
const REASSIGNABLE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'];
const CANCELLABLE = ['CREATED', 'MATCHES_FOUND', 'AWAITING_WORKER', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];

function JobDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { can } = useStaff();
  const { data: j, loading, error, reload } = useLoad(() => getJobDetail(id), [id]);
  const [transcript, setTranscript] = useState<Awaited<ReturnType<typeof getTranscript>> | null>(null);
  const [tErr, setTErr] = useState<string | undefined>();
  if (loading && !j) return <Loading />;
  if (error && !j) return <Failed message={error} retry={reload} />;
  if (!j) return null;
  const done = async () => { await reload(); onChanged(); };
  const name = (uid: string | null) => transcript?.participants.find((p) => p.id === uid)?.name ?? (uid ? 'Unknown' : 'Fixli');
  return (
    <div>
      <div className="page-header">
        <div><h2 style={{ margin: 0 }}>{j.title ?? j.category?.name ?? 'Job'}</h2><p className="text-muted mono" style={{ margin: 0 }}>{j.id}</p></div>
        <div className="row-actions">
          <Badge value={j.status} />
          {can('jobs.manage') && REASSIGNABLE.includes(j.status) ? <ReasonButton label="Find another worker" ask="Why is the worker being taken off this job?" onConfirm={async (r) => { await reassignJob(j.id, r); await done(); }} /> : null}
          {can('jobs.cancel') && CANCELLABLE.includes(j.status) ? <ReasonButton danger label="Cancel job" ask="Why is staff cancelling this job? (both sides are told)" onConfirm={async (r) => { await adminCancelJob(j.id, r); await done(); }} /> : null}
        </div>
      </div>
      <div className="detail-grid">
        <div><p className="text-muted">Customer</p><p>{j.customer?.name}</p></div>
        <div><p className="text-muted">Worker</p><p>{j.assignedWorker?.user.name ?? '–'}</p></div>
        <div><p className="text-muted">Price</p><p>{j.agreedAmount ? money(j.agreedAmount, j.agreedCurrency) : '–'}</p></div>
        <div><p className="text-muted">Area</p><p>{[j.area, j.city].filter(Boolean).join(', ') || '–'}</p></div>
        <div><p className="text-muted">Emergency</p><p>{j.isEmergency ? `Yes${j.sosDispatch ? ` · SOS ${j.sosDispatch.status.toLowerCase()} (try ${j.sosDispatch.attempt})` : ''}` : 'No'}</p></div>
        <div><p className="text-muted">Created</p><p>{when(j.createdAt)}</p></div>
      </div>
      <Section title="Timeline">
        <table className="data-table"><tbody>{j.events.map((e: any) => (
          <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{when(e.createdAt)}</td><td>{e.type.replace(/_/g, ' ').toLowerCase()}</td><td className="text-muted">{e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : ''}</td></tr>
        ))}</tbody></table>
      </Section>
      {j.payments.length ? <Section title="Payments"><table className="data-table"><tbody>{j.payments.map((p: any) => <tr key={p.id}><td>{p.method}</td><td>{money(p.amount, p.currency)}</td><td><Badge value={p.status} /></td><td>{p.autoConfirmed ? 'auto-confirmed' : ''}</td></tr>)}</tbody></table></Section> : null}
      {j.changeOrders.length ? <Section title="Extra work"><table className="data-table"><tbody>{j.changeOrders.map((c: any) => <tr key={c.id}><td>{c.previousPrice != null ? `${money(c.previousPrice, c.currency)} → ` : ''}{money(c.revisedPrice, c.currency)}</td><td><Badge value={c.status} /></td><td>{when(c.createdAt)}</td></tr>)}</tbody></table></Section> : null}
      {j.disputes.length || j.incidents.length ? (
        <Section title="Problems">
          {j.disputes.map((d: any) => <p key={d.id}>Dispute · {d.category.toLowerCase()} · {d.reason} <Badge value={d.status} /></p>)}
          {j.incidents.map((i: any) => <p key={i.id}>Incident · {(i.kind ?? i.type).toLowerCase()} <Badge value={i.severity} /> <Badge value={i.status} /></p>)}
        </Section>
      ) : null}
      {j.conversationId && can('chat.read') ? (
        <Section title="Chat" actions={!transcript ? <button className="btn btn-ghost btn-sm" onClick={async () => { try { setTranscript(await getTranscript(j.id)); } catch (e) { setTErr(errText(e)); } }}>Show chat (recorded in the audit log)</button> : null}>
          {tErr ? <p className="form-error">{tErr}</p> : null}
          {transcript ? transcript.messages.map((m) => (
            <p key={m.id} style={{ margin: '4px 0' }}>
              <span className="text-muted">{when(m.createdAt)} · {m.isSystem ? 'Fixli' : name(m.senderId)}:</span> {m.text}{m.imageUrl ? <a href={m.imageUrl} target="_blank" rel="noreferrer"> [photo]</a> : null}{m.isFlagged ? <strong style={{ color: 'var(--warning)' }}> (contact info)</strong> : null}
            </p>
          )) : null}
        </Section>
      ) : null}
    </div>
  );
}

export default function Jobs() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data: jobs, loading, error, reload } = useLoad(() => listJobs(status || undefined), [status]);
  if (loading && !jobs) return <Loading />;
  if (error && !jobs) return <Failed message={error} retry={reload} />;
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Jobs</h1>
        <div className="row-actions">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ').toLowerCase() : 'All statuses'}</option>)}</select>
          <button className="btn btn-ghost" onClick={reload}>Refresh</button>
        </div>
      </div>
      {open ? <div className="card glass-panel" style={{ marginBottom: 20 }}><button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>← Back to list</button><JobDetail id={open} onChanged={reload} /></div> : null}
      <div className="card glass-panel">
        <table className="data-table">
          <thead><tr><th>Job</th><th>Status</th><th>Customer</th><th>Worker</th><th>Created</th></tr></thead>
          <tbody>
            {!jobs?.length ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}>No jobs.</td></tr> : jobs.map((j: AdminJobRow) => (
              <tr key={j.id} className="clickable" onClick={() => setOpen(j.id)}>
                <td><div style={{ fontWeight: 600 }}>{j.category?.name ?? 'Job'}</div><div className="text-muted mono" style={{ fontSize: '0.8rem' }}>{j.id.slice(-8)}</div></td>
                <td><Badge value={j.status} /></td>
                <td>{j.customer?.name ?? '–'}</td>
                <td>{j.assignedWorker?.user.name ?? '–'}</td>
                <td>{when(j.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
