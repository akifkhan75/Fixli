import { useEffect, useState } from 'react';
import { adjustLedger, decideSettlement, listBalances, listPaymentsFiltered, listSettlements, money, parseMajor, workerLedger, type BalanceRow } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { Badge, errText, Failed, Loading, ReasonButton, Section, when } from '../ui';
import './Pages.css';

type Tab = 'settlements' | 'balances' | 'payments';

function Settlements() {
  const { can, resync } = useStaff();
  const [status, setStatus] = useState('PENDING');
  const { data, loading, error, reload } = useLoad(() => listSettlements(status), [status, resync]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  return (
    <>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        {[['PENDING', 'To check'], ['COMPLETED', 'Confirmed'], ['FAILED', 'Rejected']].map(([s, label]) => <button key={s} className={`btn btn-sm ${s === status ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatus(s)}>{label}</button>)}
      </div>
      <table className="data-table">
        <thead><tr><th>Worker</th><th>Amount</th><th>Paid by</th><th>Reference</th><th>Owes now</th><th>Reported</th><th /></tr></thead>
        <tbody>
          {!data?.length ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32 }}>Nothing here.</td></tr> : data.map((s) => (
            <tr key={s.id}>
              <td>{s.worker.user.name}</td><td>{money(s.amount, s.currency)}</td><td>{s.rail}</td><td className="mono"><code>{s.reference}</code></td>
              <td>{money(s.worker.ledgerBalance, s.currency)}</td><td>{when(s.createdAt)}</td>
              <td>{s.status === 'PENDING' && can('finance.settle') ? (
                <div className="row-actions">
                  <button className="btn btn-sm btn-primary" onClick={async () => { if (!window.confirm(`Confirm ${money(s.amount, s.currency)} arrived (ref ${s.reference})?`)) return; try { await decideSettlement(s.id, true); await reload(); } catch (e) { window.alert(errText(e)); } }}>Money arrived</button>
                  <ReasonButton danger label="Not received" ask="Why is this payment being rejected? (the worker sees this)" onConfirm={async (r) => { await decideSettlement(s.id, false, r); await reload(); }} />
                </div>
              ) : <Badge value={s.status} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function WorkerLedger({ worker, onChanged }: { worker: BalanceRow; onChanged: () => void }) {
  const { can } = useStaff();
  const { data, loading, error, reload } = useLoad(() => workerLedger(worker.id), [worker.id]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const submit = async () => {
    const minor = parseMajor(amount);
    if (minor == null || minor === 0) return setErr('Enter an amount: positive adds to what they owe, minus takes it off.');
    if (note.trim().length < 3) return setErr('Say why.');
    if (!window.confirm(`${minor > 0 ? 'Add' : 'Take off'} ${money(Math.abs(minor), worker.currency)} ${minor > 0 ? 'to' : 'from'} what ${worker.user.name} owes?`)) return;
    setBusy(true); setErr(undefined);
    try { await adjustLedger(worker.id, minor, note.trim(), key); setAmount(''); setNote(''); setKey(crypto.randomUUID()); await reload(); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      {can('finance.adjust') ? (
        <div className="row-actions" style={{ marginBottom: 12 }}>
          <input className="reason-input" style={{ width: 160 }} placeholder={`Amount (${worker.currency})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="reason-input" style={{ flex: 1, minWidth: 200 }} placeholder="Why (kept in the ledger and audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={submit}>{busy ? '…' : 'Adjust'}</button>
        </div>
      ) : null}
      {err ? <p className="form-error" role="alert">{err}</p> : null}
      {loading && !data ? <Loading /> : error && !data ? <Failed message={error} retry={reload} /> : (
        <table className="data-table">
          <thead><tr><th>When</th><th>What</th><th>Change</th><th>Note</th></tr></thead>
          <tbody>{(data ?? []).map((e) => (
            <tr key={e.id}><td>{when(e.createdAt)}</td><td>{String(e.type).replace(/_/g, ' ').toLowerCase()}</td><td>{e.amount > 0 ? '+' : ''}{money(e.amount, e.currency)}</td><td className="text-muted">{e.note ?? ''}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function Balances() {
  const { data, loading, error, reload } = useLoad(listBalances);
  const [open, setOpen] = useState<BalanceRow | null>(null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  return (
    <>
      {open ? <Section title={`${open.user.name}: ledger`} actions={<button className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>}><WorkerLedger worker={open} onChanged={reload} /></Section> : null}
      <table className="data-table">
        <thead><tr><th>Worker</th><th>Owes Fixli</th><th>Owed since</th><th>Status</th></tr></thead>
        <tbody>
          {!data?.length ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32 }}>No one owes anything.</td></tr> : data.map((b) => (
            <tr key={b.id} className="clickable" onClick={() => setOpen(b)}>
              <td>{b.user.name}</td><td>{money(b.ledgerBalance, b.currency)}</td><td>{when(b.owedSince)}</td>
              <td>{b.balanceBlocked ? <Badge value="BLOCKED" /> : <span className="text-muted">can take jobs</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Payments() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(() => listPaymentsFiltered({ status: status || undefined }), [status]);
  useEffect(() => { if (data) { setRows(data.items); setCursor(data.nextCursor); } }, [data]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Failed message={error} retry={reload} />;
  return (
    <>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ marginBottom: 12 }}>
        <option value="">All payments</option>{['MARKED_BY_WORKER', 'CONFIRMED', 'DISPUTED', 'VOIDED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
      </select>
      <table className="data-table">
        <thead><tr><th>Job</th><th>Customer → worker</th><th>Amount</th><th>Method</th><th>Status</th><th>When</th></tr></thead>
        <tbody>{!rows.length ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>No payments.</td></tr> : rows.map((p) => (
          <tr key={p.id}>
            <td>{p.jobRequest?.title ?? 'Job'}<div className="text-muted mono" style={{ fontSize: '0.8rem' }}>{p.jobRequest?.id.slice(-8)}</div></td>
            <td>{p.jobRequest?.customer?.name ?? '–'} → {p.jobRequest?.assignedWorker?.user.name ?? '–'}</td>
            <td>{money(p.amount, p.currency)}</td><td>{p.method}</td><td><Badge value={p.status} />{p.autoConfirmed ? <div className="text-muted">auto</div> : null}</td><td>{when(p.createdAt)}</td>
          </tr>
        ))}</tbody>
      </table>
      {cursor ? <button className="btn btn-ghost" onClick={async () => { const p = await listPaymentsFiltered({ status: status || undefined, cursor }); setRows((r) => [...r, ...p.items]); setCursor(p.nextCursor); }}>Load more</button> : null}
    </>
  );
}

export default function Finance() {
  const { clearBadge } = useStaff();
  const [tab, setTab] = useState<Tab>('settlements');
  useEffect(() => { clearBadge('settlement'); }, [clearBadge]);
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Finance</h1>
        <div className="row-actions">
          {(['settlements', 'balances', 'payments'] as Tab[]).map((t) => <button key={t} className={`btn btn-sm ${t === tab ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}>{t === 'settlements' ? 'Payments to Fixli' : t === 'balances' ? 'What workers owe' : 'Job payments'}</button>)}
        </div>
      </div>
      <div className="card glass-panel">{tab === 'settlements' ? <Settlements /> : tab === 'balances' ? <Balances /> : <Payments />}</div>
    </div>
  );
}
