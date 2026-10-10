import { useState, useEffect } from 'react';
import { type LedgerRow, listPayments } from '../api';
import './Pages.css';

export default function Ledger() {
  const [payments, setPayments] = useState<LedgerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPayments();
      setPayments(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, []);

  const formatMoney = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
  };

  if (loading && !payments) return <div className="state-box">Loading...</div>;
  if (error && !payments) return <div className="state-box"><p>{error}</p><button className="btn btn-primary" onClick={loadLedger}>Try again</button></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Ledger & Payments</h1>
        <button className="btn btn-ghost" onClick={loadLedger}>Refresh</button>
      </div>

      <div className="card glass-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID & Job</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {!payments || payments.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '32px' }}>No payments found.</td></tr>
            ) : (
              payments.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.id}</div>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>Job: {p.jobRequest?.id.slice(-8) || '-'}</div>
                  </td>
                  <td>{p.method}</td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(p.amount, p.currency)}</td>
                  <td>
                    <span className="badge" style={{ backgroundColor: p.status === 'CONFIRMED' ? 'var(--success)' : p.status === 'MARKED_BY_WORKER' ? 'var(--warning)' : 'var(--info)' }}>
                      {p.status}
                    </span>
                  </td>
                  <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
