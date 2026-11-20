import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CheckCircle, AlertTriangle, Briefcase, LogOut, Users, Activity, CreditCard, ShieldAlert, Star, Settings, UserCog, ScrollText, KeyRound } from 'lucide-react';
import { useAuth } from '../auth';
import { useStaff } from '../staff';
import './Layout.css';

type Badge = 'verification' | 'dispute' | 'incident' | 'settlement';
/** Each link shows only if your roles allow the page; the server refuses the calls anyway. */
export const NAV: { name: string; path: string; icon: typeof Users; permission: string; badge?: Badge }[] = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { name: 'Jobs', path: '/jobs', icon: Activity, permission: 'jobs.read' },
  { name: 'Users', path: '/users', icon: Users, permission: 'users.read' },
  { name: 'Verifications', path: '/verifications', icon: CheckCircle, permission: 'verification.read', badge: 'verification' },
  { name: 'Safety', path: '/safety', icon: ShieldAlert, permission: 'safety.read', badge: 'incident' },
  { name: 'Disputes', path: '/disputes', icon: AlertTriangle, permission: 'disputes.read', badge: 'dispute' },
  { name: 'Finance', path: '/finance', icon: CreditCard, permission: 'finance.read', badge: 'settlement' },
  { name: 'Reviews', path: '/reviews', icon: Star, permission: 'reviews.moderate' },
  { name: 'Service catalogue', path: '/catalogue', icon: Briefcase, permission: 'catalog.read' },
  { name: 'Settings', path: '/settings', icon: Settings, permission: 'config.read' },
  { name: 'Staff', path: '/staff', icon: UserCog, permission: 'staff.manage' },
  { name: 'Audit log', path: '/audit', icon: ScrollText, permission: 'audit.read' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const { can, badges, toasts, dismissToast, live, me } = useStaff();
  const navigate = useNavigate();
  const items = NAV.filter((i) => can(i.permission));

  return (
    <div className="layout-container">
      <aside className="sidebar glass-panel">
        <div className="sidebar-header">
          <div className="logo-container">
            <img src="/logo-mark.png" alt="" width={32} height={32} />
            <h1 className="logo-text">Fix<span className="gradient-text">li</span></h1>
          </div>
          <p className="admin-badge">Staff portal</p>
        </div>

        <nav className="sidebar-nav">
          {me && !items.length ? <p className="text-muted" style={{ padding: '0 12px' }}>Your account has no staff roles yet. Ask a Super Admin.</p> : null}
          {items.map((item) => (
            <NavLink key={item.name} to={item.path} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <item.icon className="nav-icon" size={20} />
              <span>{item.name}</span>
              {item.badge && badges[item.badge] ? <span className="nav-count" aria-label={`${badges[item.badge]} new`}>{badges[item.badge]}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/account" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <KeyRound className="nav-icon" size={20} /><span>My account</span>
          </NavLink>
          <button className="nav-link logout-btn" onClick={signOut}>
            <LogOut className="nav-icon" size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar glass-panel">
          <div className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live: new items appear as they happen' : 'Not live: reconnecting; refresh pages to see new items'}>
            {live ? 'Live' : 'Reconnecting…'}
          </div>
          <div className="topbar-actions">
            <div className="user-profile">
              <div className="avatar">{(user?.name ?? 'A').charAt(0).toUpperCase()}</div>
              <div className="user-info">
                <span className="user-name">{user?.name}</span>
                <span className="user-role">{me?.adminRoles.join(', ') || user?.email}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast glass-panel">
            <button className="toast-link" onClick={() => { dismissToast(t.id); navigate(t.to); }}>{t.text}</button>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
