import { useState, useEffect } from 'react';
import { type AdminJobRow, listJobs, adminCancelJob } from '../api';
import './Pages.css';

export default function Jobs() {
  const [jobs, setJobs] = useState<AdminJobRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listJobs();
      setJobs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleCancel = async (id: string) => {
    const reason = prompt('Reason for cancellation:');
    if (!reason) return;
    setBusyId(id);
    try {
      await adminCancelJob(id, reason);
      setJobs(prev => prev?.map(j => j.id === id ? { ...j, status: 'CANCELLED' } : j) ?? null);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel job');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !jobs) return <div className="state-box">Loading...</div>;
  if (error && !jobs) return <div className="state-box"><p>{error}</p><button className="btn btn-primary" onClick={loadJobs}>Try again</button></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Live Jobs</h1>
        <button className="btn btn-ghost" onClick={loadJobs}>Refresh</button>
      </div>

      <div className="card glass-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID & Service</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Worker</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!jobs || jobs.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No jobs found.</td></tr>
            ) : (
              jobs.map(j => (
                <tr key={j.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{j.category?.name || 'Unknown'}</div>
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>{j.id.slice(-8)}</div>
                  </td>
                  <td>
                    <span className="badge" style={{ backgroundColor: j.status === 'COMPLETED' ? 'var(--success)' : j.status === 'CANCELLED' ? 'var(--error)' : 'var(--info)' }}>
                      {j.status}
                    </span>
                  </td>
                  <td>{j.customer?.name || 'Unknown'}</td>
                  <td>{j.assignedWorker?.user.name || '-'}</td>
                  <td>{new Date(j.createdAt).toLocaleDateString()}</td>
                  <td>
                    {j.status !== 'CANCELLED' && j.status !== 'COMPLETED' && (
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '6px 12px', fontSize: '0.875rem' }}
                        disabled={busyId === j.id}
                        onClick={() => handleCancel(j.id)}
                      >
                        {busyId === j.id ? '...' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
