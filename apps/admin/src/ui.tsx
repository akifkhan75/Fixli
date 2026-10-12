import { useState, type ReactNode } from 'react';
import { ApiError } from './api';

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Could not reach the server.');

export function Loading() { return <div className="state-box">Loading…</div>; }
export function Failed({ message, retry }: { message: string; retry: () => void }) {
  return <div className="state-box"><p>{message}</p><button className="btn btn-primary" onClick={retry}>Try again</button></div>;
}

const TONE: Record<string, string> = {
  COMPLETED: 'var(--success)', CONFIRMED: 'var(--success)', RESOLVED: 'var(--success)', ACTIVE: 'var(--success)', APPROVED: 'var(--success)', PUBLISHED: 'var(--success)',
  CANCELLED: 'var(--danger)', DISPUTED: 'var(--danger)', SUSPENDED: 'var(--danger)', LIFE_THREATENING: 'var(--danger)', FAILED: 'var(--danger)', HIDDEN: 'var(--danger)', REJECTED: 'var(--danger)', VOIDED: 'var(--danger)', BLOCKED: 'var(--danger)', CRITICAL: 'var(--danger)', HIGH: 'var(--danger)',
  OPEN: 'var(--warning)', PENDING: 'var(--warning)', MARKED_BY_WORKER: 'var(--warning)', INVESTIGATING: 'var(--warning)', IN_REVIEW: 'var(--warning)',
};
export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="badge" style={{ backgroundColor: TONE[value] ?? 'var(--info)' }}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

/** A button that asks for a reason (required for every staff action that changes something). */
export function ReasonButton({ label, ask, onConfirm, danger, disabled }: { label: string; ask: string; onConfirm: (reason: string) => Promise<unknown>; danger?: boolean; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-ghost'}`} disabled={busy || disabled}
      onClick={async () => {
        const reason = window.prompt(ask)?.trim();
        if (!reason || reason.length < 3) return;
        setBusy(true);
        try { await onConfirm(reason); } catch (e) { window.alert(errText(e)); } finally { setBusy(false); }
      }}>{busy ? '…' : label}</button>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="card glass-panel" style={{ marginBottom: 20 }}>
      <div className="page-header" style={{ marginBottom: 12 }}><h2 style={{ fontSize: '1.1rem', margin: 0 }}>{title}</h2>{actions}</div>
      {children}
    </div>
  );
}

export function Stat({ title, value, sub }: { title: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat-card glass-panel">
      <div className="stat-content">
        <p className="stat-title">{title}</p>
        <div className="stat-value-row"><h3 className="stat-value">{value}</h3></div>
        {sub ? <p className="text-muted" style={{ margin: 0, fontSize: '0.85rem' }}>{sub}</p> : null}
      </div>
    </div>
  );
}
