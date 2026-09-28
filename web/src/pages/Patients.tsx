import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus, Search } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Button, Card, Empty, PageHeader, Pill, Segmented } from '../components/ui';
import { PatientCell, StageRing } from '../components/clinical';
import { ago, fmtDate, titleCase } from '../lib/format';

const STATUS_TONE: Record<string, any> = { active: 'stable', invited: 'info', paused: 'attention', completed: 'neutral', archived: 'neutral' };
const CHECKIN_TONE: Record<string, any> = { awaiting_review: 'info', retake_requested: 'attention', reviewed: 'stable', uploading: 'neutral', quality_check: 'neutral' };

export function Patients() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const { data } = useApi<any[]>(`/patients?q=${encodeURIComponent(params.get('q') ?? '')}&status=${status}`, [params.toString()]);
  const nav = useNavigate();
  const { can } = useAuth();
  const rows = data ?? [];
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Directory" title="Patients" subtitle={`${rows.length} patients`} actions={can('patients.write') && <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => nav('/app/patients/new')}>New patient</Button>} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <form className="relative w-full max-w-sm" onSubmit={(e) => { e.preventDefault(); setParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }); }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-4" />
          <input className="input pl-9" placeholder="Name, email or PMS reference" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Segmented value={status} onChange={(v) => setParams({ ...(q ? { q } : {}), ...(v ? { status: v } : {}) })} options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'paused', label: 'Paused' }, { value: 'completed', label: 'Completed' }]} />
      </div>
      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b border-line bg-raised">{['Patient', 'Stage', 'Next change', 'Last check-in', 'Open items', 'Doctor · branch', 'Status'].map((h) => <th key={h} className="label !normal-case !tracking-normal !text-xs font-medium px-5 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-raised cursor-pointer" onClick={() => nav(`/app/patients/${p.id}`)}>
                  <td className="px-5 py-3"><PatientCell id={p.id} name={p.name} hue={p.avatarHue} sub={`${titleCase(p.mode)} · ${p.protocolName ?? ''}`} /></td>
                  <td className="px-5 py-3">{p.plan ? <div className="flex items-center gap-2.5"><StageRing stage={p.plan.currentStage} total={p.plan.totalStages} size={34} label={false} /><span className="num">{p.plan.currentStage}<span className="text-ink-3">/{p.plan.totalStages}</span></span></div> : '—'}</td>
                  <td className="px-5 py-3 num">{p.plan?.nextChange ? fmtDate(p.plan.nextChange) : '—'}</td>
                  <td className="px-5 py-3">{p.lastCheckin ? <div className="flex items-center gap-2"><Pill size="sm" tone={CHECKIN_TONE[p.lastCheckin.status]} icon={false}>{titleCase(p.lastCheckin.status)}</Pill><span className="text-xs text-ink-3">{ago(p.lastCheckin.submittedAt)}</span></div> : <span className="text-ink-3">None yet</span>}</td>
                  <td className="px-5 py-3">{p.openIssues + p.openFindings ? <div className="flex gap-1">{p.openIssues > 0 && <Pill size="sm" tone="urgent" icon={false}>{p.openIssues} report{p.openIssues > 1 ? 's' : ''}</Pill>}{p.openFindings > 0 && <Pill size="sm" tone="attention" icon={false}>{p.openFindings} obs.</Pill>}</div> : <span className="text-ink-4">—</span>}</td>
                  <td className="px-5 py-3 text-ink-2">{p.doctorName}<div className="text-xs text-ink-3">{p.branchName}</div></td>
                  <td className="px-5 py-3"><Pill size="sm" tone={STATUS_TONE[p.status]}>{titleCase(p.status)}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !rows.length && <Empty title="No patients found">Try a different search or <Link className="link" to="/app/patients/new">add a patient</Link>.</Empty>}
      </Card>
    </div>
  );
}
