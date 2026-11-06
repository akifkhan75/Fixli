import { useState } from 'react';
import { type SearchUserRow, searchUsers, suspendUser } from '../api';
import './Pages.css';

export default function Users() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<SearchUserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchUsers(query);
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to search users');
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = async (id: string, currentStatus: string) => {
    if (currentStatus === 'SUSPENDED') return; // For MVP, only suspend
    const reason = prompt('Reason for suspension:');
    if (!reason) return;
    setBusyId(id);
    try {
      await suspendUser(id, reason);
      setUsers(prev => prev?.map(u => u.id === id ? { ...u, status: 'SUSPENDED' } : u) ?? null);
    } catch (err: any) {
      alert(err.message || 'Failed to suspend user');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Users</h1>
      </div>

      <div className="card glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px' }}>
          <input 
            type="text" 
            placeholder="Search by name, email, or phone..." 
            value={query} 
            onChange={(e) => setQuery(e.target.value)} 
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error && <div className="state-box" style={{ color: 'var(--error)' }}>{error}</div>}

      {users && (
        <div className="card glass-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Type</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No users found.</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="text-muted" style={{ fontSize: '0.85rem' }}>{u.id}</div>
                    </td>
                    <td>
                      <div>{u.email || '-'}</div>
                      <div className="text-muted">{u.phone || '-'}</div>
                    </td>
                    <td>
                      <span className="badge" style={{ backgroundColor: u.type === 'worker' ? 'var(--info)' : 'var(--border)' }}>
                        {u.type.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{ backgroundColor: u.status === 'ACTIVE' ? 'var(--success)' : 'var(--error)' }}>
                        {u.status}
                      </span>
                      {u.worker && (
                        <div style={{ fontSize: '0.75rem', marginTop: 4 }} className="text-muted">
                          Worker: {u.worker.activationStatus}
                        </div>
                      )}
                    </td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '6px 12px', fontSize: '0.875rem' }}
                        disabled={busyId === u.id || u.status === 'SUSPENDED'}
                        onClick={() => handleSuspend(u.id, u.status)}
                      >
                        {busyId === u.id ? '...' : u.status === 'SUSPENDED' ? 'Suspended' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
