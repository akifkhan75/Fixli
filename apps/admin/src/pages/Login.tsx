import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../auth';
import { ApiError, activateTotp, beginTotpSetup, type AdminUser } from '../api';
import './Pages.css';

type Step =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'setup'; setupToken: string; secret?: string; qr?: string }
  | { kind: 'recovery'; codes: string[]; user: AdminUser };

/** Staff sign-in: email + password, then a 6-digit authenticator code (set up on first sign-in). */
export default function Login() {
  const { signIn, signedIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const message = (err: unknown) =>
    err instanceof ApiError ? (err.status === 429 ? 'Too many tries. Please wait a minute.' : err.message) : 'Could not reach the server.';

  // First sign-in: fetch the secret and draw the QR code for the authenticator app.
  useEffect(() => {
    if (step.kind !== 'setup' || step.secret) return;
    beginTotpSetup(step.setupToken)
      .then(async ({ secret, otpauthUrl }) => setStep({ ...step, secret, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) }))
      .catch((e) => { setError(message(e)); setStep({ kind: 'password' }); });
  }, [step]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (step.kind === 'setup') {
        const { user, recoveryCodes } = await activateTotp(step.setupToken, code.replace(/\s/g, ''));
        setStep({ kind: 'recovery', codes: recoveryCodes, user });
      } else {
        await signIn(email, password, step.kind === 'code' ? code : undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') setStep({ kind: 'code' });
      else if (err instanceof ApiError && err.code === 'TOTP_SETUP_REQUIRED' && typeof err.details?.setupToken === 'string') {
        setStep({ kind: 'setup', setupToken: err.details.setupToken });
      } else setError(message(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'recovery') {
    return (
      <div className="login-wrap">
        <div className="card glass-panel login-card">
          <h1 className="page-title">Save your recovery codes</h1>
          <p>If you lose your phone, each of these codes signs you in once. They are shown only now. Keep them somewhere safe, not on this computer.</p>
          <pre className="recovery-codes" aria-label="Recovery codes">{step.codes.join('\n')}</pre>
          <button className="btn btn-primary" onClick={() => signedIn(step.user)}>I have saved them</button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="card glass-panel login-card" onSubmit={submit}>
        <img src="/logo-mark.png" alt="Fixli" width={56} height={56} />
        <h1 className="page-title">Fixli staff sign in</h1>
        {step.kind === 'password' ? (
          <>
            <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          </>
        ) : null}
        {step.kind === 'setup' ? (
          <>
            <p>Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan this code, then enter the 6 digits it shows.</p>
            {step.qr ? <img src={step.qr} alt="Authenticator QR code" width={220} height={220} /> : <p>Preparing…</p>}
            {step.secret ? <p className="mono">Can't scan? Enter this key: <code>{step.secret.match(/.{1,4}/g)?.join(' ')}</code></p> : null}
          </>
        ) : null}
        {step.kind === 'code' || step.kind === 'setup' ? (
          <label>
            {step.kind === 'code' ? 'Authenticator code (or a recovery code)' : 'Code from the app'}
            <input inputMode={step.kind === 'setup' ? 'numeric' : 'text'} autoComplete="one-time-code" required autoFocus maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : step.kind === 'password' ? 'Sign in' : 'Continue'}</button>
        {step.kind !== 'password' ? <button type="button" className="btn" onClick={() => { setStep({ kind: 'password' }); setCode(''); }}>Back</button> : null}
      </form>
    </div>
  );
}
