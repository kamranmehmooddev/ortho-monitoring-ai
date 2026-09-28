import { ShieldCheck } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { Callout, Card, PageHeader, Stat } from '../../components/ui';
import { pct, usd } from '../../lib/format';

export function AdminOverview() {
  const { data } = useApi<any>('/admin/overview');
  if (!data) return null;
  const k = data.kpis;
  const max = Math.max(1, ...data.checkinsDaily.map((d: any) => d.n));
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Platform" title="Overview" subtitle="Clinics, usage, AI cost and reliability across the platform." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Active clinics" value={`${k.activeTenants}/${k.tenants}`} tone="stable" />
        <Stat label="MRR" value={`$${k.mrr.toLocaleString()}`} tone="ember" hint="Excludes custom enterprise" />
        <Stat label="Active patients" value={k.activePatients} tone="info" hint={`${k.checkinsThisMonth} check-ins this month`} />
        <Stat label="AI error rate" value={pct(k.aiErrorRate)} tone={k.aiErrorRate > 0.05 ? 'urgent' : 'stable'} hint={`${k.aiCallsThisMonth} calls · ${usd(k.aiCostThisMonth)} · ${k.webhookFailures} webhook failures`} />
      </div>
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        <Card>
          <div className="font-semibold mb-4">Check-ins, last 30 days</div>
          <div className="flex items-end gap-1 h-44">{data.checkinsDaily.map((d: any) => <div key={d.d} className="flex-1 bg-brand-gradient rounded-t-sm opacity-90" style={{ height: `${(d.n / max) * 100}%` }} title={`${d.d}: ${d.n}`} />)}</div>
        </Card>
        <Card>
          <div className="font-semibold mb-4">Plan mix</div>
          <ul className="space-y-3">{data.planMix.map((p: any) => <li key={p.name} className="flex items-center justify-between text-sm"><span>{p.name}</span><span className="num font-semibold">{p.n}</span></li>)}</ul>
        </Card>
      </div>
      <div className="mt-6"><Callout tone="info" title="No patient data here" icon={<ShieldCheck className="h-4 w-4" />}>The super admin console shows only aggregate usage. Platform staff cannot open patient records or images. Support access needs a time-limited break-glass grant that the clinic approves, and it is audited.</Callout></div>
    </div>
  );
}
