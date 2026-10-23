import { useState } from 'react';
import { reactivateUser, type SearchUserRow, searchUsers, suspendUser } from '../api';
import { useStaff } from '../staff';
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

  const { can } = useStaff();

  const toggle = async (id: string, currentStatus: string) => {
    const suspend = currentStatus !== 'SUSPENDED';
    const reason = prompt(suspend ? 'Why is this account being suspended? (they are signed out everywhere)' : 'Why is this account being turned back on?')?.trim();
    if (!reason || reason.length < 3) return;
    setBusyId(id);
    try {
      if (suspend) {
        const r = await suspendUser(id, reason);
        const lines = [`Suspended and signed out.`];
        if (r.cancelled.length) lines.push(`${r.cancelled.length} open request(s) cancelled.`);
        if (r.offersWithdrawn) lines.push(`${r.offersWithdrawn} price offer(s) withdrawn.`);
        if (r.activeBookings.length) lines.push(`${r.activeBookings.length} live booking(s) were NOT cancelled; call both sides (Jobs page):`, ...r.activeBookings.map((j) => `• ${j.title ?? 'Job'} (${j.status.toLowerCase()}) ${j.id}`));
        alert(lines.join('\n'));
      } else {
        await reactivateUser(id, reason);
      }
      setUsers(prev => prev?.map(u => u.id === id ? { ...u, status: suspend ? 'SUSPENDED' : 'ACTIVE' } : u) ?? null);
    } catch (err: any) {
      alert(err.message || 'Could not change the account');
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
                      {can('users.suspend') && u.type !== 'admin' ? (
                        <button
                          className={`btn btn-sm ${u.status === 'SUSPENDED' ? 'btn-ghost' : 'btn-danger'}`}
                          disabled={busyId === u.id}
                          onClick={() => toggle(u.id, u.status)}
                        >
                          {busyId === u.id ? '...' : u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                        </button>
                      ) : null}
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
