import { useState } from 'react';
import { getDashboard, money } from '../api';
import { useLoad } from '../hooks';
import { Failed, Loading, Section, Stat } from '../ui';
import './Pages.css';

const RANGES = { '1': 'Today', '7': 'Last 7 days', '30': 'Last 30 days' } as const;

/** Real figures only, straight from the database (no sample numbers). */
export default function Dashboard() {
  const [days, setDays] = useState<keyof typeof RANGES>('7');
  const from = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  const { data: d, loading, error, reload } = useLoad(() => getDashboard(from), [days]);
  if (loading && !d) return <Loading />;
  if (error && !d) return <Failed message={error} retry={reload} />;
  if (!d) return null;
  const gmv = d.gmv.length ? d.gmv.map((g) => money(g.amount, g.currency)).join(' · ') : money(0);
  const active = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].reduce((n, s) => n + (d.jobsNow[s] ?? 0), 0);
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <select value={days} onChange={(e) => setDays(e.target.value as keyof typeof RANGES)} aria-label="Period">
          {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="stats-grid">
        <Stat title="Requests" value={d.requests} sub={`${d.booked} booked`} />
        <Stat title="Fill rate" value={d.fillRate == null ? '–' : `${d.fillRate}%`} sub="requests that got booked" />
        <Stat title="Time to first price" value={d.medianMinutesToFirstOffer == null ? '–' : `${d.medianMinutesToFirstOffer} min`} sub="median" />
        <Stat title="Cash confirmed (GMV)" value={gmv} />
        <Stat title="Workers online now" value={d.workersOnline} />
        <Stat title="Jobs under way" value={active} sub={`${d.jobsNow.MATCHES_FOUND ?? 0} waiting for prices`} />
        <Stat title="Open disputes" value={d.openDisputes} />
        <Stat title="Open safety incidents" value={d.openIncidents} />
        <Stat title="Commission owed" value={money(d.commissionOwed.amount)} sub={`${d.commissionOwed.workers} workers`} />
        <Stat title="Commission settled" value={money(d.commissionSettled)} sub={RANGES[days].toLowerCase()} />
      </div>
      <Section title="Cancellations">
        {Object.keys(d.cancellations).length ? (
          <table className="data-table"><tbody>{Object.entries(d.cancellations).map(([k, v]) => <tr key={k}><td>{k.replace(/_/g, ' ').toLowerCase()}</td><td>{v}</td></tr>)}</tbody></table>
        ) : <p className="text-muted">None in this period.</p>}
      </Section>
      <Section title="People">
        <p className="text-muted">{Object.entries(d.users).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(' · ')}</p>
      </Section>
    </div>
  );
}
