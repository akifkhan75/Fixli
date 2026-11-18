import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, CheckCircle, AlertTriangle, Briefcase, LogOut, Users, Activity, CreditCard, Siren } from 'lucide-react';
import { useAuth } from '../auth';
import './Layout.css';

export default function Layout() {
  const { user, signOut } = useAuth();
  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Users', path: '/users', icon: Users },
    { name: 'Jobs', path: '/jobs', icon: Activity },
    { name: 'Verifications', path: '/verifications', icon: CheckCircle },
    { name: 'Safety incidents', path: '/incidents', icon: Siren },
    { name: 'Disputes', path: '/disputes', icon: AlertTriangle },
    { name: 'Ledger', path: '/ledger', icon: CreditCard },
    { name: 'Service catalogue', path: '/services', icon: Briefcase },
  ];

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
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-link logout-btn" onClick={signOut}>
            <LogOut className="nav-icon" size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar glass-panel">
          <div />
          <div className="topbar-actions">
            <div className="user-profile">
              <div className="avatar">{(user?.name ?? 'A').charAt(0).toUpperCase()}</div>
              <div className="user-info">
                <span className="user-name">{user?.name}</span>
                <span className="user-role">{user?.email}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
