import { useState } from 'react';
import { createStaff, listStaff, resetStaff2fa, setStaffRoles, type StaffRow } from '../api';
import { useLoad } from '../hooks';
import { useStaff } from '../staff';
import { Badge, errText, Failed, Loading, ReasonButton, Section, when } from '../ui';
import './Pages.css';

export const ROLES = ['Super Admin', 'Operations', 'Verification', 'Support', 'Safety', 'Finance', 'Content', 'Analytics', 'Auditor'];

function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row-actions">
      {ROLES.map((r) => (
        <label key={r} className="text-muted" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />{r}
        </label>
      ))}
    </div>
  );
}

function EditRoles({ s, onDone }: { s: StaffRow; onDone: () => void }) {
  const [roles, setRoles] = useState(s.adminRoles);
  const [err, setErr] = useState<string | undefined>();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <RolePicker value={roles} onChange={setRoles} />
      <div className="row-actions">
        <button className="btn btn-sm btn-primary" disabled={!roles.length} onClick={async () => { try { await setStaffRoles(s.id, roles); onDone(); } catch (e) { setErr(errText(e)); } }}>Save roles</button>
        <button className="btn btn-sm btn-ghost" onClick={onDone}>Cancel</button>
      </div>
      {err ? <p className="form-error">{err}</p> : null}
    </div>
  );
}

export default function Staff() {
  const { me } = useStaff();
  const { data, loading, error, reload } = useLoad(listStaff);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roles.length) return setErr('Pick at least one role.');
    setBusy(true); setErr(undefined);
    try {
      const r = await createStaff(email.trim(), name.trim(), roles);
      setCreated({ email: email.trim(), password: r.temporaryPassword });
      setEmail(''); setName(''); setRoles([]); await reload();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">Staff</h1></div>
      <Section title="Add a staff member">
        {created ? (
          <div className="state-box" style={{ alignItems: 'flex-start', textAlign: 'left' }}>
            <p>Give <strong>{created.email}</strong> this temporary password in person or by phone. It is shown <strong>once</strong>. They set up two-step sign-in the first time they sign in, then should change the password.</p>
            <div className="recovery-codes">{created.password}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>I've passed it on</button>
          </div>
        ) : (
          <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row-actions">
              <input className="reason-input" type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="reason-input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <RolePicker value={roles} onChange={setRoles} />
            <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add staff member'}</button></div>
            {err ? <p className="form-error" role="alert">{err}</p> : null}
          </form>
        )}
      </Section>
      {loading && !data ? <Loading /> : error && !data ? <Failed message={error} retry={reload} /> : (
        <div className="card glass-panel">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Roles</th><th>Two-step</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{(data ?? []).map((s) => (
              <tr key={s.id}>
                <td><div style={{ fontWeight: 600 }}>{s.name}</div><div className="text-muted">{s.email}</div>{s.status !== 'ACTIVE' ? <Badge value={s.status} /> : null}</td>
                <td>{editing === s.id ? <EditRoles s={s} onDone={() => { setEditing(null); void reload(); }} /> : s.adminRoles.join(', ')}</td>
                <td>{s.totpEnabledAt ? 'On' : <span className="text-muted">Not set up</span>}</td>
                <td>{when(s.lastLoginAt)}</td>
                <td>{s.id === me?.id ? <span className="text-muted">You</span> : (
                  <div className="row-actions">
                    {editing !== s.id ? <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s.id)}>Change roles</button> : null}
                    {s.totpEnabledAt ? <ReasonButton danger label="Reset two-step" ask={`Why reset ${s.name}'s two-step sign-in? (they're signed out and must set it up again)`} onConfirm={async (r) => { await resetStaff2fa(s.id, r); await reload(); }} /> : null}
                  </div>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
