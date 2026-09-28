import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Callout, Card, Field, Modal, PageHeader, Pill } from '../../components/ui';
import { ago, usd } from '../../lib/format';

export function AdminTenants() {
  const { data, reload } = useApi<any[]>('/admin/tenants');
  const { data: plans } = useApi<any[]>('/admin/plans');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [f, setF] = useState({ name: '', slug: '', planId: 'plan_practice', adminName: '', adminEmail: '', branchName: 'Main clinic', timezone: 'Europe/London' });
  const patch = async (id: string, body: object) => { try { await api(`/admin/tenants/${id}`, { method: 'PATCH', body }); reload(); toast.success('Clinic updated'); } catch (e) { toast.error('Failed', (e as Error).message); } };
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Tenants" title="Clinics & plans" actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New clinic</Button>} />
      <div className="grid md:grid-cols-4 gap-4 mb-6">{(plans ?? []).map((p) => <Card key={p.id} className="!p-4"><div className="flex justify-between"><span className="font-semibold">{p.name}</span><span className="text-xs text-ink-3">{p.tenants} clinics</span></div><div className="display text-2xl mt-1">{p.priceMonthUsd ? `$${p.priceMonthUsd}` : 'Custom'}<span className="text-sm text-ink-3 font-sans font-normal">{p.priceMonthUsd ? '/mo' : ''}</span></div><div className="text-xs text-ink-3 mt-2">{p.limits.activePatients ? `${p.limits.activePatients} patients · ${p.limits.branches} branches · ${p.limits.seats} seats` : 'Custom limits'}</div></Card>)}</div>
      <Card pad={false} className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]"><thead><tr className="text-left border-b border-line bg-raised">{['Clinic', 'Plan', 'Patients', 'Branches · seats', 'Check-ins 30d', 'AI cost 30d', 'Status'].map((h) => <th key={h} className="px-5 py-3 text-xs font-medium text-ink-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{(data ?? []).map((t) => (
            <tr key={t.id}><td className="px-5 py-3"><div className="font-medium">{t.name}</div><div className="text-xs text-ink-3 font-mono">{t.slug} · since {ago(t.createdAt)}</div></td>
              <td className="px-5 py-3"><select className="input h-8 text-xs w-32" value={t.planId} onChange={(e) => patch(t.id, { planId: e.target.value })}>{(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
              <td className="px-5 py-3"><div className="num">{t.usage.activePatients}{t.usage.patientLimit ? <span className="text-ink-3"> / {t.usage.patientLimit}</span> : ''}</div>{t.usage.patientLimit && <div className="h-1 w-24 rounded-full bg-sunken mt-1 overflow-hidden"><div className="h-full bg-brand-gradient" style={{ width: `${Math.min(100, (t.usage.activePatients / t.usage.patientLimit) * 100)}%` }} /></div>}</td>
              <td className="px-5 py-3 num">{t.usage.branches} · {t.usage.seats}</td><td className="px-5 py-3 num">{t.usage.checkins30d}</td><td className="px-5 py-3 num">{usd(t.usage.aiCost30d)}</td>
              <td className="px-5 py-3"><div className="flex items-center gap-2"><Pill size="sm" tone={t.status === 'active' ? 'stable' : t.status === 'trial' ? 'info' : 'urgent'}>{t.status}</Pill><select className="input h-8 text-xs w-28" value={t.status} onChange={(e) => patch(t.id, { status: e.target.value })}><option value="trial">trial</option><option value="active">active</option><option value="suspended">suspended</option></select></div></td></tr>
          ))}</tbody></table>
      </Card>
      <Modal open={open} onClose={() => { setOpen(false); setCreated(null); }} title="Onboard a new clinic" footer={!created && <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { setCreated(await api('/admin/tenants', { body: f })); reload(); } catch (e) { toast.error('Not created', (e as Error).message); } }}>Create clinic</Button></>}>
        {created ? <Callout tone="stable" title="Clinic created">Admin {created.adminEmail} · temporary password <code className="font-mono font-semibold">{created.temporaryPassword}</code>. Default protocols, instructions and education were added, and a new encryption data key was generated.</Callout> : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Clinic name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Field>
            <Field label="Slug (clinic code)"><input className="input font-mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
            <Field label="Plan"><select className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>{(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="First branch"><input className="input" value={f.branchName} onChange={(e) => setF({ ...f, branchName: e.target.value })} /></Field>
            <Field label="Admin name"><input className="input" value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></Field>
            <Field label="Admin email"><input className="input" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
