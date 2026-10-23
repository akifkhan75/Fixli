import { useState } from 'react';
import { moderateReview, reviewQueue } from '../api';
import { useLoad } from '../hooks';
import { Badge, errText, Failed, Loading, ReasonButton, when } from '../ui';
import './Pages.css';

export default function Reviews() {
  const [hidden, setHidden] = useState(false);
  const { data, loading, error, reload } = useLoad(() => reviewQueue(hidden), [hidden]);
  const dismiss = async (id: string) => { try { await moderateReview(id, 'DISMISS'); await reload(); } catch (e) { window.alert(errText(e)); } };
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Reviews</h1>
        <div className="row-actions">
          <button className={`btn btn-sm ${!hidden ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHidden(false)}>Needs a look</button>
          <button className={`btn btn-sm ${hidden ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHidden(true)}>Hidden</button>
        </div>
      </div>
      <p className="text-muted">Reviews reported by the person they are about, or caught by the abuse check (insults, or one star with no explanation). Hiding a review takes it out of the worker's rating.</p>
      {loading && !data ? <Loading /> : error && !data ? <Failed message={error} retry={reload} /> : (
        <div className="card glass-panel">
          <table className="data-table">
            <thead><tr><th>Review</th><th>From → about</th><th>Why it's here</th><th>When</th><th /></tr></thead>
            <tbody>
              {!data?.length ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}>Nothing to look at.</td></tr> : data.map((r) => (
                <tr key={r.id}>
                  <td><strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong><div style={{ whiteSpace: 'pre-wrap' }}>{r.comment || <span className="text-muted">(no comment)</span>}</div></td>
                  <td>{r.reviewer?.name} → {r.target?.name}</td>
                  <td>
                    {r.flagged ? <Badge value="AUTO_FLAGGED" /> : null}
                    {r.reports?.map((p: { reason: string; createdAt: string }, k: number) => <div key={k} className="text-muted">Reported: {p.reason.replace(/_/g, ' ').toLowerCase()}</div>)}
                    {hidden ? <Badge value="HIDDEN" /> : null}
                  </td>
                  <td>{when(r.createdAt)}</td>
                  <td><div className="row-actions">
                    {hidden ? <ReasonButton label="Show again" ask="Why is this review being shown again?" onConfirm={async (n) => { await moderateReview(r.id, 'RESTORE', n); await reload(); }} /> : <>
                      <ReasonButton danger label="Hide" ask="Why is this review being hidden? (kept in the audit log)" onConfirm={async (n) => { await moderateReview(r.id, 'HIDE', n); await reload(); }} />
                      <button className="btn btn-sm btn-ghost" onClick={() => dismiss(r.id)}>It's fine</button>
                    </>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
