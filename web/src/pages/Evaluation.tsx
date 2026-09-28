import { useState } from 'react';
import { FlaskConical, ShieldAlert } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { Callout, Card, Empty, PageHeader, Pill, Segmented } from '../components/ui';
import { pct, usd, titleCase } from '../lib/format';
import { CATEGORY_OPTIONS } from '../lib/clinical';

const catLabel = (c: string) => CATEGORY_OPTIONS.find(([v]) => v === c)?.[1] ?? titleCase(c);

export function Evaluation() {
  const [days, setDays] = useState('90');
  const { data } = useApi<any>(`/evaluation/summary?days=${days}`, [days]);
  const stats = data?.stats ?? [];
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Model governance" title="AI evaluation" subtitle="How clinicians responded to AI observations, broken down by model version, category, image quality and uncertainty. Missed findings come from observations clinicians added."
        actions={<Segmented value={days} onChange={setDays} options={[{ value: '30', label: '30 d' }, { value: '90', label: '90 d' }, { value: '365', label: '1 yr' }]} />} />
      <div className="mb-6"><Callout tone="attention" title="Not validated diagnostic accuracy" icon={<ShieldAlert className="h-4 w-4" />}>{data?.disclaimer} Validation status: <strong>{data?.validationStatus?.replace('_', ' ')}</strong>. Accuracy may only be published after a formal study on clinician-labelled cases.</Callout></div>
      <div className="grid lg:grid-cols-3 gap-5 mb-6">
        <Card><div className="label">Go/no-go overrides</div><div className="display text-3xl num mt-2">{data?.goNoGoOverrides?.overridden ?? 0}<span className="text-ink-3 text-lg"> / {data?.goNoGoOverrides?.total ?? 0}</span></div><div className="text-xs text-ink-3 mt-1">decisions that differed from the rules engine</div></Card>
        <Card><div className="label">Appointment edits</div><div className="display text-3xl num mt-2">{data?.appointmentOverrides?.edited ?? 0}<span className="text-ink-3 text-lg"> / {data?.appointmentOverrides?.total ?? 0}</span></div><div className="text-xs text-ink-3 mt-1">avg duration change {data?.appointmentOverrides?.avg_duration_delta != null ? `${Math.round(data.appointmentOverrides.avg_duration_delta)} min` : '—'} · {data?.appointmentOverrides?.dismissed ?? 0} dismissed</div></Card>
        <Card><div className="label">Labelled evaluation cases</div><div className="display text-3xl num mt-2">{(data?.labelledCases ?? []).reduce((s: number, c: any) => s + c.n, 0)}</div><div className="text-xs text-ink-3 mt-1">clinician ground-truth labels (research consent only)</div></Card>
      </div>
      <Card pad={false} className="mb-6 overflow-x-auto">
        <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Observation review outcomes</div>
        {stats.length === 0 ? <Empty icon={<FlaskConical className="h-5 w-5" />} title="No model observations reviewed yet">Statistics appear once a provider is configured and clinicians confirm, dismiss or correct observations. Seeded demo records are excluded.</Empty> : (
          <table className="w-full text-sm min-w-[860px]"><thead><tr className="text-left border-b border-line bg-raised">{['Model · prompt', 'Category', 'Shown', 'Reviewed', 'Confirmed', 'Corrected', 'Dismissed (false alert)', 'Missed', 'By image quality'].map((h) => <th key={h} className="px-4 py-2.5 text-xs font-medium text-ink-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{stats.map((s: any, i: number) => (
              <tr key={i}><td className="px-4 py-2.5 text-xs"><div className="font-medium">{s.modelVersion}</div><div className="text-ink-3">{s.promptVersion}</div></td><td className="px-4 py-2.5">{catLabel(s.category)}</td><td className="px-4 py-2.5 num">{s.total}</td><td className="px-4 py-2.5 num">{s.reviewed}</td>
                <td className="px-4 py-2.5 num">{s.confirmed} <span className="text-ink-3">({pct(s.confirmationRate)})</span></td><td className="px-4 py-2.5 num">{s.corrected}</td>
                <td className="px-4 py-2.5"><Pill size="sm" tone={s.falseAlertRate > 0.5 ? 'urgent' : s.falseAlertRate > 0.25 ? 'attention' : 'stable'} icon={false}>{pct(s.falseAlertRate)}</Pill></td><td className="px-4 py-2.5 num">{s.missed}</td>
                <td className="px-4 py-2.5 text-xs text-ink-3">{Object.entries(s.byQuality).map(([q, v]: any) => `${q}: ${v.dismissed}/${v.reviewed} dismissed`).join(' · ') || '—'}</td></tr>
            ))}</tbody></table>
        )}
      </Card>
      <Card pad={false} className="overflow-x-auto">
        <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Provider runs</div>
        {(data?.runs ?? []).length === 0 ? <div className="px-5 py-6 text-sm text-ink-3">No AI calls recorded.</div> : (
          <table className="w-full text-sm"><thead><tr className="text-left border-b border-line bg-raised">{['Provider', 'Model version', 'Prompt', 'Runs', 'OK', 'Fallbacks', 'Errors', 'Avg latency', 'Cost'].map((h) => <th key={h} className="px-4 py-2.5 text-xs font-medium text-ink-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{data.runs.map((r: any, i: number) => <tr key={i}><td className="px-4 py-2.5">{r.provider}</td><td className="px-4 py-2.5 text-xs">{r.model_version}</td><td className="px-4 py-2.5 text-xs">{r.prompt_version}</td><td className="px-4 py-2.5 num">{r.runs}</td><td className="px-4 py-2.5 num">{r.ok}</td><td className="px-4 py-2.5 num">{r.fallbacks}</td><td className="px-4 py-2.5 num">{r.errors}</td><td className="px-4 py-2.5 num">{r.avg_latency ? `${(r.avg_latency / 1000).toFixed(1)} s` : '—'}</td><td className="px-4 py-2.5 num">{usd(r.cost)}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}
