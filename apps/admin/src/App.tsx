import type { ComponentType } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout, { NAV } from './components/Layout';
import Dashboard from './pages/Dashboard';
import Verifications from './pages/Verifications';
import Disputes from './pages/Disputes';
import Catalogue from './pages/Catalogue';
import Users from './pages/Users';
import Jobs from './pages/Jobs';
import Finance from './pages/Finance';
import Safety from './pages/Safety';
import Reviews from './pages/Reviews';
import Settings from './pages/Settings';
import Staff from './pages/Staff';
import Audit from './pages/Audit';
import Account from './pages/Account';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './auth';
import { StaffProvider, useStaff } from './staff';

const PAGES: Record<string, ComponentType> = {
  '/dashboard': Dashboard, '/jobs': Jobs, '/users': Users, '/verifications': Verifications, '/safety': Safety, '/disputes': Disputes,
  '/finance': Finance, '/reviews': Reviews, '/catalogue': Catalogue, '/settings': Settings, '/staff': Staff, '/audit': Audit,
};

function Home() {
  const { me, can } = useStaff();
  if (!me) return <div className="state-box">Loading…</div>;
  const first = NAV.find((n) => can(n.permission));
  return <Navigate to={first?.path ?? '/account'} replace />;
}

function Gate() {
  const { user, ready } = useAuth();
  const { can, me } = useStaff();
  if (!ready) return <div className="state-box">Loading…</div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        {NAV.filter((n) => !me || can(n.permission)).map((n) => {
          const Page = PAGES[n.path];
          return <Route key={n.path} path={n.path.slice(1)} element={me ? <Page /> : <div className="state-box">Loading…</div>} />;
        })}
        <Route path="account" element={<Account />} />
        <Route path="ledger" element={<Navigate to="/finance" replace />} />
        <Route path="services" element={<Navigate to="/catalogue" replace />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StaffProvider>
        <Router>
          <Gate />
        </Router>
      </StaffProvider>
    </AuthProvider>
  );
}
