import { useState } from 'react';
import { changePassword } from '../api';
import { useStaff } from '../staff';
import { errText, Section, when } from '../ui';
import './Pages.css';

export default function Account() {
  const { me } = useStaff();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: 'The new passwords do not match.' });
    setBusy(true); setMsg(null);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setAgain('');
      setMsg({ ok: true, text: 'Password changed. Your other sessions were signed out.' });
    } catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
  };

  return (
    <div className="page-container">
      <div className="page-header"><h1 className="page-title">My account</h1></div>
      <Section title="You">
        <div className="detail-grid">
          <div><p className="text-muted">Name</p><p>{me?.name}</p></div>
          <div><p className="text-muted">Email</p><p>{me?.email}</p></div>
          <div><p className="text-muted">Roles</p><p>{me?.adminRoles.join(', ') || '–'}</p></div>
          <div><p className="text-muted">Two-step sign-in</p><p>{me?.totpEnabledAt ? `On since ${when(me.totpEnabledAt)}` : 'Off'}</p></div>
        </div>
      </Section>
      <Section title="Change password">
        <form onSubmit={submit} className="login-card" style={{ padding: 0, background: 'none' }}>
          <label>Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label>New password<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
          <label>New password again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
          {msg ? <p className={msg.ok ? 'text-muted' : 'form-error'} role="status">{msg.text}</p> : null}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </Section>
    </div>
  );
}
