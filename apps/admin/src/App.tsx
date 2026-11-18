import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Verifications from './pages/Verifications';
import Incidents from './pages/Incidents';
import Disputes from './pages/Disputes';
import Services from './pages/Services';
import Users from './pages/Users';
import Jobs from './pages/Jobs';
import Ledger from './pages/Ledger';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './auth';

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="state-box">Loading…</div>;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="verifications" element={<Verifications />} />
        <Route path="incidents" element={<Incidents />} />
        <Route path="disputes" element={<Disputes />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="services" element={<Services />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Gate />
      </Router>
    </AuthProvider>
  );
}
