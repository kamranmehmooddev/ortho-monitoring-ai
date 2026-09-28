import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Building2, Users, CalendarClock, BrainCircuit, ShieldCheck, Plug, ScrollText, CreditCard, Plus, Trash2, KeyRound, Copy, CheckCircle2, AlertTriangle, Lock, Server } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Callout, Card, Empty, Field, Modal, PageHeader, Pill, Toggle } from '../../components/ui';
import { fmtDateTime, usd, titleCase, ago } from '../../lib/format';
import { VISIT_KIND_LABELS } from '../../lib/clinical';

const TABS = [
  { id: 'clinic', label: 'Clinic & branding', icon: Building2 }, { id: 'team', label: 'Team & roles', icon: Users }, { id: 'scheduling', label: 'Scheduling rules', icon: CalendarClock },
  { id: 'ai', label: 'AI providers', icon: BrainCircuit }, { id: 'privacy', label: 'Privacy & retention', icon: ShieldCheck }, { id: 'integrations', label: 'API & webhooks', icon: Plug },
  { id: 'audit', label: 'Audit log', icon: ScrollText }, { id: 'billing', label: 'Subscription', icon: CreditCard },
];

export function Settings() {
  const { tab = 'clinic' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const admin = can('settings.manage');
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Administration" title="Settings" />
      <div className="grid lg:grid-cols-[220px_1fr] gap-8 items-start">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto scroll-thin lg:sticky lg:top-20">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => nav(`/app/settings/${t.id}`)} className={clsx('flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm whitespace-nowrap transition', tab === t.id ? 'bg-surface border border-line shadow-card font-medium text-ink' : 'text-ink-3 hover:text-ink hover:bg-sunken')}>
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {!admin && tab !== 'clinic' && tab !== 'team' ? <Card><Empty icon={<Lock className="h-5 w-5" />} title="Clinic admins only">Ask a clinic admin to change these settings.</Empty></Card> : <>
            {tab === 'clinic' && <ClinicTab admin={admin} />}
            {tab === 'team' && <TeamTab admin={admin} />}
            {tab === 'scheduling' && <SchedulingTab />}
            {tab === 'ai' && <AiTab />}
            {tab === 'privacy' && <PrivacyTab />}
            {tab === 'integrations' && <IntegrationsTab />}
            {tab === 'audit' && <AuditTab />}
            {tab === 'billing' && <BillingTab />}
          </>}
        </div>
      </div>
    </div>
  );
}

function ClinicTab({ admin }: { admin: boolean }) {
  const { data, reload } = useApi<any>('/settings/clinic');
  const toast = useToast();
  const [b, setB] = useState<any>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branch, setBranch] = useState({ name: '', address: '', chairs: 3, timezone: 'Europe/London' });
  useEffect(() => { if (data) setB({ name: data.name, ...data.branding }); }, [data]);
  if (!data || !b) return null;
  const save = async () => { try { await api('/settings/clinic', { method: 'PUT', body: { name: b.name, branding: { accent: b.accent, displayName: b.displayName, logoText: b.logoText, patientWelcome: b.patientWelcome } } }); toast.success('Clinic updated'); reload(); } catch (e) { toast.error('Not saved', (e as Error).message); } };
  return (
    <div className="space-y-6">
      <Card>
        <div className="font-semibold mb-4">Clinic profile & patient-app branding</div>
        <div className="grid md:grid-cols-[1fr_280px] gap-8">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Clinic name"><input className="input" disabled={!admin} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
            <Field label="Display name in app"><input className="input" disabled={!admin} value={b.displayName ?? ''} onChange={(e) => setB({ ...b, displayName: e.target.value })} /></Field>
            <Field label="Accent colour" hint="Checked for 4.5:1 contrast with white text"><div className="flex gap-2"><input type="color" disabled={!admin} className="h-10 w-12 rounded-lg border border-line-strong bg-surface p-1" value={b.accent ?? '#0F6E6A'} onChange={(e) => setB({ ...b, accent: e.target.value })} /><input className="input num" disabled={!admin} value={b.accent ?? ''} onChange={(e) => setB({ ...b, accent: e.target.value })} /></div></Field>
            <Field label="Monogram"><input className="input" maxLength={3} disabled={!admin} value={b.logoText ?? ''} onChange={(e) => setB({ ...b, logoText: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Welcome line"><input className="input" disabled={!admin} value={b.patientWelcome ?? ''} onChange={(e) => setB({ ...b, patientWelcome: e.target.value })} /></Field></div>
            {admin && <div className="sm:col-span-2"><Button variant="primary" onClick={save}>Save changes</Button></div>}
          </div>
          <div className="rounded-[28px] border-[6px] border-navy bg-canvas p-4 shadow-pop">
            <div className="flex items-center gap-2 mb-4"><span className="h-8 w-8 rounded-lg grid place-items-center text-white font-serif font-bold" style={{ background: b.accent }}>{b.logoText}</span><span className="text-sm font-semibold">{b.displayName}</span></div>
            <div className="rounded-2xl p-4 text-white" style={{ background: b.accent }}><div className="text-2xs opacity-75">Today</div><div className="font-semibold mt-1">Check-in due today</div><div className="text-xs opacity-80 mt-0.5">5 photos · about 3 minutes</div><div className="mt-3 h-8 rounded-full bg-white/95 text-xs font-semibold grid place-items-center" style={{ color: b.accent }}>Start check-in</div></div>
            <div className="text-2xs text-ink-3 mt-3 text-center">{b.patientWelcome}</div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-4"><div className="font-semibold">Branches</div>{admin && <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBranchOpen(true)}>Add branch</Button>}</div>
        <div className="grid md:grid-cols-2 gap-3">{data.branches.map((br: any) => <div key={br.id} className="rounded-xl border border-line p-4"><div className="font-medium">{br.name}</div><div className="text-sm text-ink-3">{br.address}</div><div className="flex gap-1.5 mt-2"><Pill size="sm" icon={false}>{br.chairs} chairs</Pill><Pill size="sm" icon={false}>{br.timezone}</Pill></div></div>)}</div>
        <p className="text-xs text-ink-3 mt-3">Staff restricted to a branch only see that branch's patients. Clinic admins see all branches.</p>
      </Card>
      <OnboardingCard onboarding={data.onboarding} />
      <Modal open={branchOpen} onClose={() => setBranchOpen(false)} title="New branch" footer={<><Button variant="ghost" onClick={() => setBranchOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { await api('/settings/branches', { body: branch }); setBranchOpen(false); reload(); toast.success('Branch added'); } catch (e) { toast.error('Not added', (e as Error).message); } }}>Add</Button></>}>
        <div className="space-y-4"><Field label="Name"><input className="input" value={branch.name} onChange={(e) => setBranch({ ...branch, name: e.target.value })} /></Field><Field label="Address"><input className="input" value={branch.address} onChange={(e) => setBranch({ ...branch, address: e.target.value })} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Chairs"><input type="number" className="input" value={branch.chairs} onChange={(e) => setBranch({ ...branch, chairs: Number(e.target.value) })} /></Field><Field label="Time zone"><input className="input" value={branch.timezone} onChange={(e) => setBranch({ ...branch, timezone: e.target.value })} /></Field></div></div>
      </Modal>
    </div>
  );
}

function OnboardingCard({ onboarding }: { onboarding: Record<string, boolean> }) {
  const steps = [['profile', 'Clinic profile'], ['branch', 'First branch'], ['team', 'Invite team'], ['protocol', 'Choose protocols'], ['ai', 'Connect AI provider (optional)'], ['firstPatient', 'First patient']];
  const done = steps.filter(([k]) => onboarding[k]).length;
  return (
    <Card>
      <div className="flex items-center justify-between mb-3"><div className="font-semibold">Onboarding</div><span className="num text-sm text-ink-3">{done}/{steps.length}</span></div>
      <div className="h-1.5 rounded-full bg-sunken overflow-hidden mb-4"><div className="h-full bg-brand-gradient" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <div className="grid sm:grid-cols-3 gap-2">{steps.map(([k, l]) => <div key={k} className="flex items-center gap-2 text-sm">{onboarding[k] ? <CheckCircle2 className="h-4 w-4 text-stable" /> : <span className="h-4 w-4 rounded-full border-2 border-line-strong" />}<span className={onboarding[k] ? 'text-ink-3' : ''}>{l}</span></div>)}</div>
    </Card>
  );
}

function TeamTab({ admin }: { admin: boolean }) {
  const { data, reload } = useApi<any>('/team');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'treatment_coordinator', title: '' });
  const [created, setCreated] = useState<any>(null);
  if (!data) return null;
  const PERMS: [string, string][] = [['clinical.decide', 'Go/no-go decisions'], ['findings.review', 'Review AI observations'], ['triage.manage', 'Triage'], ['messages.send', 'Message patients'], ['appointments.book', 'Book visits'], ['patients.write', 'Create patients & plans'], ['images.view', 'View images'], ['settings.manage', 'Settings & AI keys']];
  return (
    <div className="space-y-6">
      <Card pad={false}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line"><div className="font-semibold">Team</div>{admin && <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Invite member</Button>}</div>
        <table className="w-full text-sm"><tbody className="divide-y divide-line">{data.members.map((m: any) => (
          <tr key={m.id}><td className="px-5 py-3"><div className="font-medium">{m.name}</div><div className="text-xs text-ink-3">{m.email}</div></td><td className="px-5 py-3 text-ink-2">{m.title}</td>
            <td className="px-5 py-3">{admin ? <select className="input h-8 text-xs w-48" value={m.role} onChange={async (e) => { try { await api(`/team/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); reload(); toast.success('Role updated'); } catch (er) { toast.error('Not updated', (er as Error).message); } }}>{data.roles.map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}</select> : <Pill size="sm" icon={false}>{m.roleLabel}</Pill>}</td>
            <td className="px-5 py-3 text-xs text-ink-3">{m.branchIds.length ? `${m.branchIds.length} branch` : 'All branches'}</td><td className="px-5 py-3 text-xs text-ink-3">{m.lastLoginAt ? `Active ${ago(m.lastLoginAt)}` : 'Never signed in'}</td></tr>
        ))}</tbody></table>
      </Card>
      <Card pad={false} className="overflow-x-auto">
        <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Role permissions</div>
        <table className="w-full text-sm min-w-[720px]"><thead><tr className="border-b border-line bg-raised"><th className="px-5 py-2.5 text-left text-xs font-medium text-ink-3">Permission</th>{data.roles.map((r: any) => <th key={r.id} className="px-3 py-2.5 text-xs font-medium text-ink-3">{r.label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{PERMS.map(([p, l]) => <tr key={p}><td className="px-5 py-2.5">{l}</td>{data.roles.map((r: any) => <td key={r.id} className="text-center">{r.permissions.includes(p) ? <CheckCircle2 className="h-4 w-4 text-stable inline" /> : <span className="text-ink-4">·</span>}</td>)}</tr>)}</tbody></table>
      </Card>
      <Modal open={open} onClose={() => { setOpen(false); setCreated(null); }} title="Invite team member" footer={!created && <><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { setCreated(await api('/team', { body: f })); reload(); } catch (e) { toast.error('Not invited', (e as Error).message); } }}>Invite</Button></>}>
        {created ? <Callout tone="stable" title="Account created">Temporary password: <code className="font-mono font-semibold">{created.temporaryPassword}</code>. Share it securely; the member should change it at first sign-in.</Callout> :
          <div className="space-y-4"><Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field><Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field><Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{data.roles.map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field></div>}
      </Modal>
    </div>
  );
}

function SchedulingTab() {
  const { data, reload } = useApi<any>('/settings/clinic');
  const toast = useToast();
  const [r, setR] = useState<any>(null);
  useEffect(() => { if (data) setR(data.scheduling); }, [data]);
  if (!r) return null;
  const save = async () => { try { await api('/settings/scheduling', { method: 'PUT', body: r }); toast.success('Scheduling rules saved', 'Recommendations recalculate on the next check-in.'); reload(); } catch (e) { toast.error('Not saved', (e as Error).message); } };
  return (
    <div className="space-y-6">
      <Callout tone="info">These rules feed the appointment engine (<code>appt-v1</code>). Each recommendation lists the rule and the minutes it contributed, and staff can always change the date and duration.</Callout>
      <Card>
        <div className="font-semibold mb-4">Chair time by visit type (minutes)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(r.durations).map(([k, v]) => (
            <Field key={k} label={VISIT_KIND_LABELS[k] ?? titleCase(k.replace('_per_', ' per '))}><input type="number" className="input num" value={v as number} onChange={(e) => setR({ ...r, durations: { ...r.durations, [k]: Number(e.target.value) } })} /></Field>
          ))}
        </div>
      </Card>
      <Card>
        <div className="font-semibold mb-4">Clinic rules</div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Buffer between visits"><input type="number" className="input num" value={r.bufferMin} onChange={(e) => setR({ ...r, bufferMin: Number(e.target.value) })} /></Field>
          <Field label="Shared setup when combining"><input type="number" className="input num" value={r.sharedSetupMin} onChange={(e) => setR({ ...r, sharedSetupMin: Number(e.target.value) })} /></Field>
          <Field label="Max long procedures / day"><input type="number" className="input num" value={r.maxLongPerDay} onChange={(e) => setR({ ...r, maxLongPerDay: Number(e.target.value) })} /></Field>
          <Field label="Slot granularity"><input type="number" className="input num" value={r.slotStepMin} onChange={(e) => setR({ ...r, slotStepMin: Number(e.target.value) })} /></Field>
          <Field label="Routine review every N stages"><input type="number" className="input num" value={r.visitEveryStages ?? ''} onChange={(e) => setR({ ...r, visitEveryStages: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Lunch block"><div className="flex gap-2"><input className="input num" value={r.lunch?.start ?? ''} onChange={(e) => setR({ ...r, lunch: { ...(r.lunch ?? { end: '13:30' }), start: e.target.value } })} /><input className="input num" value={r.lunch?.end ?? ''} onChange={(e) => setR({ ...r, lunch: { ...(r.lunch ?? { start: '12:30' }), end: e.target.value } })} /></div></Field>
        </div>
        <Button className="mt-5" variant="primary" onClick={save}>Save rules</Button>
      </Card>
    </div>
  );
}

function AiTab() {
  const { data, reload } = useApi<any>('/ai-providers');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ provider: 'anthropic', label: '', model: '', endpoint: '', apiKey: '', priority: 1, monthlyBudgetUsd: 100, perCallMaxUsd: 0.5 });
  if (!data) return null;
  const adapter = data.adapters.find((a: any) => a.id === f.provider);
  const add = async () => {
    try { await api('/ai-providers', { body: { ...f, model: f.model || adapter.defaultModel, label: f.label || adapter.label, endpoint: adapter.endpointConfigurable ? f.endpoint : null } }); setOpen(false); reload(); toast.success('Provider added', 'The key is encrypted and cannot be viewed again.'); setF({ ...f, apiKey: '' }); }
    catch (e) { toast.error('Not added', (e as Error).message); }
  };
  return (
    <div className="space-y-6">
      <Callout tone="attention" title="General-purpose models are not validated detectors">Vision LLMs describe visible features for clinician review. Findings are always shown as "possible" or "cannot assess" and need a clinician to confirm, dismiss or correct them.</Callout>
      <div className="grid md:grid-cols-3 gap-4">{data.separation.map((s: any) => <Card key={s.id} className="!p-4"><div className="label">{s.label}</div><div className="text-sm mt-1.5">{s.engine}</div></Card>)}</div>
      <Card pad={false}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line"><div><div className="font-semibold">Bring your own AI key</div><div className="text-xs text-ink-3">Tried in priority order. Fallback moves to the next provider on error, timeout, invalid output or budget.</div></div><Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Add provider</Button></div>
        {data.configs.length === 0 ? <Empty icon={<BrainCircuit className="h-5 w-5" />} title="No provider configured">AI observations are off. Check-ins still get deterministic quality checks and go/no-go rules.{data.platformFallbackAvailable && ' Your plan includes platform AI credits as a fallback.'}</Empty> : (
          <ul className="divide-y divide-line">{data.configs.map((c: any) => (
            <li key={c.id} className="px-5 py-4 flex flex-wrap items-center gap-4">
              <span className="num h-7 w-7 rounded-full bg-sunken grid place-items-center text-xs font-semibold">{c.priority}</span>
              <div className="min-w-[200px] flex-1"><div className="font-medium">{c.label}</div><div className="text-xs text-ink-3">{c.provider} · {c.model}{c.endpoint ? ` · ${c.endpoint}` : ''} · key ••••{c.keyLast4}</div>
                {c.lastRun && <div className="text-2xs mt-1 flex items-center gap-1">{c.lastRun.status === 'error' ? <AlertTriangle className="h-3 w-3 text-urgent" /> : <CheckCircle2 className="h-3 w-3 text-stable" />}<span className="text-ink-3">Last call {ago(c.lastRun.created_at)} · {c.lastRun.status}{c.lastRun.error ? `: ${c.lastRun.error}` : ''}</span></div>}</div>
              <div className="w-48"><div className="flex justify-between text-2xs text-ink-3 mb-1"><span>{usd(c.spendThisMonth)} this month</span><span>{usd(c.monthlyBudgetUsd)}</span></div><div className="h-1.5 rounded-full bg-sunken overflow-hidden"><div className="h-full bg-brand-gradient" style={{ width: `${Math.min(100, (c.spendThisMonth / c.monthlyBudgetUsd) * 100)}%` }} /></div><div className="text-2xs text-ink-4 mt-1">max {usd(c.perCallMaxUsd)} per call</div></div>
              <Toggle checked={c.enabled} onChange={async (v) => { await api(`/ai-providers/${c.id}`, { method: 'PATCH', body: { enabled: v } }); reload(); }} />
              <button className="text-ink-4 hover:text-urgent" onClick={async () => { await api(`/ai-providers/${c.id}`, { method: 'DELETE' }); reload(); }}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card className="!p-4"><div className="flex gap-3 text-sm text-ink-2"><Lock className="h-4 w-4 text-ink-3 mt-0.5 shrink-0" /><div>Keys are encrypted with AES-256-GCM using your clinic's data key. They are decrypted in memory only for the duration of a single call and are never returned by the API, written to logs, or sent to the patient app. Only clinic admins can manage them, and every change is audited.</div></div></Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add AI provider" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!f.apiKey} onClick={add}>Save encrypted</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">{data.adapters.map((a: any) => <button key={a.id} onClick={() => setF({ ...f, provider: a.id, model: '' })} className={clsx('rounded-lg border p-3 text-left text-sm', f.provider === a.id ? 'border-ember bg-ember-soft/60 font-medium' : 'border-line')}>{a.label}</button>)}</div>
          <Field label="Model"><input list="models" className="input" placeholder={adapter?.defaultModel} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /><datalist id="models">{adapter?.models.map((m: string) => <option key={m} value={m} />)}</datalist></Field>
          {adapter?.endpointConfigurable && <Field label="Endpoint URL" hint="Azure OpenAI deployment, OpenRouter, or a self-hosted vLLM server"><input className="input" value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value })} placeholder="https://…/v1" /></Field>}
          <Field label="API key"><input type="password" autoComplete="off" className="input font-mono" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3"><Field label="Priority"><input type="number" className="input num" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></Field><Field label="Monthly budget $"><input type="number" className="input num" value={f.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: Number(e.target.value) })} /></Field><Field label="Max per call $"><input type="number" step="0.05" className="input num" value={f.perCallMaxUsd} onChange={(e) => setF({ ...f, perCallMaxUsd: Number(e.target.value) })} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}

function PrivacyTab() {
  const { data, reload } = useApi<any>('/settings/clinic');
  const toast = useToast();
  const [r, setR] = useState<any>(null);
  useEffect(() => { if (data) setR(data.retention); }, [data]);
  if (!r) return null;
  return (
    <div className="space-y-6">
      <Card>
        <div className="font-semibold mb-4">Data retention</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Check-in images (days)"><input type="number" className="input num" value={r.imagesDays} onChange={(e) => setR({ ...r, imagesDays: Number(e.target.value) })} /></Field>
          <Field label="Messages (days)"><input type="number" className="input num" value={r.messagesDays} onChange={(e) => setR({ ...r, messagesDays: Number(e.target.value) })} /></Field>
          <Field label="Purge after treatment ends (days)"><input type="number" className="input num" value={r.purgeAfterTreatmentDays} onChange={(e) => setR({ ...r, purgeAfterTreatmentDays: Number(e.target.value) })} /></Field>
          <Field label="Audit log (years)" hint="Minimum 6 years"><input type="number" min={6} className="input num" value={r.auditYears} onChange={(e) => setR({ ...r, auditYears: Number(e.target.value) })} /></Field>
        </div>
        <Button className="mt-5" variant="primary" onClick={async () => { try { await api('/settings/retention', { method: 'PUT', body: r }); toast.success('Retention policy saved'); reload(); } catch (e) { toast.error('Not saved', (e as Error).message); } }}>Save policy</Button>
        <p className="text-xs text-ink-3 mt-3">A nightly job deletes expired data and records a tombstone in the audit log. Baseline reference images are kept until the plan is archived.</p>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        {[
          { i: Lock, t: 'Encryption', d: 'TLS in transit. Images, AI keys and webhook secrets are encrypted at rest with AES-256-GCM, using per-clinic data keys wrapped by a platform master key (KMS in production).' },
          { i: ShieldCheck, t: 'Consent', d: 'Separate consent for photos, AI processing, messaging and research. Without AI consent, a patient\'s images are never sent to a model.' },
          { i: Users, t: 'Access control', d: 'Role-based permissions, branch scoping and strict clinic isolation. Super admins cannot open patient records.' },
          { i: Server, t: 'Backups', d: 'Nightly encrypted snapshots with 35-day point-in-time recovery. Restores are drilled quarterly.' },
        ].map((x) => <Card key={x.t} className="!p-4"><x.i className="h-5 w-5 text-ember" /><div className="font-semibold mt-2">{x.t}</div><p className="text-sm text-ink-3 mt-1">{x.d}</p></Card>)}
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { data: keys, reload: rk } = useApi<any>('/api-keys');
  const { data: hooks, reload: rh } = useApi<any>('/webhooks');
  const toast = useToast();
  const [secret, setSecret] = useState<any>(null);
  const [keyForm, setKeyForm] = useState<{ open: boolean; name: string; scopes: string[] }>({ open: false, name: '', scopes: ['patients:read'] });
  const [hookForm, setHookForm] = useState<{ open: boolean; url: string; events: string[] }>({ open: false, url: '', events: ['decision.made'] });
  if (!keys || !hooks) return null;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between"><div><div className="font-semibold">Integration API</div><div className="text-sm text-ink-3">REST API for practice-management systems and treatment-plan viewers. Images are never exposed through it.</div></div><a className="link text-sm" href="/api/v1/openapi.yaml" target="_blank" rel="noreferrer">OpenAPI spec</a></div>
        <pre className="mt-4 rounded-lg bg-navy text-white/85 text-xs p-4 overflow-x-auto"><code>{`curl https://api.orthomonitoring.ai/api/v1/integrations/patients \\\n  -H "Authorization: Bearer omk_live_…"\n\ncurl -X PUT …/integrations/patients/{id}/plan -d '{"system":"Aligners","total_upper":24,…}'`}</code></pre>
      </Card>
      <Card pad={false}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line"><div className="font-semibold">API keys</div><Button size="sm" variant="primary" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setKeyForm({ ...keyForm, open: true })}>Create key</Button></div>
        <ul className="divide-y divide-line">{keys.keys.map((k: any) => <li key={k.id} className="px-5 py-3 flex items-center gap-3 text-sm"><div className="flex-1"><div className="font-medium">{k.name}</div><div className="text-xs text-ink-3 font-mono">{k.prefix}… · {k.scopes.join(', ')}</div></div><span className="text-xs text-ink-3">{k.lastUsedAt ? `Used ${ago(k.lastUsedAt)}` : 'Never used'}</span>{k.revokedAt ? <Pill size="sm" icon={false}>revoked</Pill> : <Button size="sm" variant="ghost" onClick={async () => { await api(`/api-keys/${k.id}`, { method: 'DELETE' }); rk(); }}>Revoke</Button>}</li>)}</ul>
      </Card>
      <Card pad={false}>
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line"><div><div className="font-semibold">Webhooks</div><div className="text-xs text-ink-3">Signed with HMAC-SHA256 (X-OMA-Signature), retried with backoff, payloads contain ids only</div></div><Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setHookForm({ ...hookForm, open: true })}>Add endpoint</Button></div>
        <ul className="divide-y divide-line">{hooks.endpoints.map((h: any) => <li key={h.id} className="px-5 py-3 flex items-center gap-3 text-sm"><div className="flex-1 min-w-0"><div className="font-mono text-xs truncate">{h.url}</div><div className="flex flex-wrap gap-1 mt-1">{h.events.map((e: string) => <Pill key={e} size="sm" icon={false}>{e}</Pill>)}</div></div><Pill size="sm" tone={h.enabled ? 'stable' : 'neutral'} icon={false}>{h.enabled ? 'enabled' : 'disabled'}</Pill><button className="text-ink-4 hover:text-urgent" onClick={async () => { await api(`/webhooks/${h.id}`, { method: 'DELETE' }); rh(); }}><Trash2 className="h-4 w-4" /></button></li>)}</ul>
        {hooks.deliveries.length > 0 && <div className="px-5 py-3 border-t border-line"><div className="label mb-2">Recent deliveries</div>{hooks.deliveries.slice(0, 6).map((d: any) => <div key={d.id} className="text-xs flex gap-3 py-0.5"><span className="font-mono">{d.event}</span><span className="text-ink-3">{d.status} · {d.attempts} attempts{d.responseCode ? ` · HTTP ${d.responseCode}` : ''}</span></div>)}</div>}
      </Card>
      <Modal open={keyForm.open} onClose={() => setKeyForm({ ...keyForm, open: false })} title="Create API key" footer={<><Button variant="ghost" onClick={() => setKeyForm({ ...keyForm, open: false })}>Cancel</Button><Button variant="primary" onClick={async () => { try { setSecret(await api('/api-keys', { body: { name: keyForm.name, scopes: keyForm.scopes } })); setKeyForm({ ...keyForm, open: false }); rk(); } catch (e) { toast.error('Not created', (e as Error).message); } }}>Create</Button></>}>
        <div className="space-y-4"><Field label="Name"><input className="input" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="Dolphin sync" /></Field>
          <div className="grid grid-cols-2 gap-2">{keys.scopes.map((s: string) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keyForm.scopes.includes(s)} onChange={(e) => setKeyForm({ ...keyForm, scopes: e.target.checked ? [...keyForm.scopes, s] : keyForm.scopes.filter((x) => x !== s) })} />{s}</label>)}</div></div>
      </Modal>
      <Modal open={hookForm.open} onClose={() => setHookForm({ ...hookForm, open: false })} title="Add webhook endpoint" footer={<><Button variant="ghost" onClick={() => setHookForm({ ...hookForm, open: false })}>Cancel</Button><Button variant="primary" onClick={async () => { try { setSecret(await api('/webhooks', { body: { url: hookForm.url, events: hookForm.events } })); setHookForm({ ...hookForm, open: false }); rh(); } catch (e) { toast.error('Not added', (e as Error).message); } }}>Add</Button></>}>
        <div className="space-y-4"><Field label="HTTPS URL"><input className="input font-mono text-xs" value={hookForm.url} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">{hooks.events.map((s: string) => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hookForm.events.includes(s)} onChange={(e) => setHookForm({ ...hookForm, events: e.target.checked ? [...hookForm.events, s] : hookForm.events.filter((x) => x !== s) })} />{s}</label>)}</div></div>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Copy your secret now">
        <p className="text-sm text-ink-2 mb-3">{secret?.note}</p>
        <div className="flex gap-2"><code className="flex-1 rounded-lg bg-sunken px-3 py-2.5 font-mono text-xs break-all">{secret?.secret}</code><Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard?.writeText(secret.secret); toast.success('Copied'); }} /></div>
      </Modal>
    </div>
  );
}

function AuditTab() {
  const [action, setAction] = useState('');
  const { data } = useApi<any[]>(`/audit${action ? `?action=${action}` : ''}`, [action]);
  const [verify, setVerify] = useState<any>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-56" value={action} onChange={(e) => setAction(e.target.value)}>{[['', 'All events'], ['decision', 'Decisions'], ['finding', 'Finding reviews'], ['image.view', 'Image views'], ['ai_provider', 'AI key changes'], ['auth', 'Sign-ins'], ['settings', 'Settings'], ['appointment', 'Appointments']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={async () => setVerify(await api('/audit/verify'))}>Verify hash chain</Button>
        {verify && (verify.ok ? <Pill tone="stable">Chain intact · {verify.checked} entries</Pill> : <Pill tone="urgent">Chain broken at {verify.brokenAt}</Pill>)}
      </div>
      <Card pad={false} className="overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]"><thead><tr className="border-b border-line bg-raised text-left">{['When', 'Actor', 'Action', 'Entity', 'Detail', 'Hash'].map((h) => <th key={h} className="px-4 py-2.5 text-xs font-medium text-ink-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{(data ?? []).map((a) => <tr key={a.id}><td className="px-4 py-2 whitespace-nowrap text-ink-3 text-xs">{fmtDateTime(a.createdAt)}</td><td className="px-4 py-2">{a.actorName ?? a.actorType}</td><td className="px-4 py-2 font-mono text-xs">{a.action}</td><td className="px-4 py-2 text-xs text-ink-3">{a.entity}</td><td className="px-4 py-2 text-xs text-ink-3 truncate max-w-xs">{a.meta ? JSON.stringify(a.meta) : ''}</td><td className="px-4 py-2 font-mono text-2xs text-ink-4">{a.hash}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

function BillingTab() {
  const { data } = useApi<any>('/settings/clinic');
  if (!data) return null;
  const L = data.plan.limits, U = data.usage;
  const meter = (label: string, used: number, limit?: number) => (
    <div><div className="flex justify-between text-sm mb-1.5"><span>{label}</span><span className="num text-ink-3">{used}{limit ? ` / ${limit}` : ''}</span></div><div className="h-2 rounded-full bg-sunken overflow-hidden"><div className={clsx('h-full', limit && used / limit > 0.9 ? 'bg-urgent' : 'bg-brand-gradient')} style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 8}%` }} /></div></div>
  );
  return (
    <div className="space-y-6">
      <Card className="!p-6 bg-navy text-white border-navy">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-2xs uppercase tracking-[0.1em] text-white/50 font-semibold">Current plan</div><div className="font-serif text-4xl font-semibold mt-1">{data.plan.name}</div><div className="text-white/60 text-sm">{data.plan.priceMonthUsd ? `$${data.plan.priceMonthUsd} / month` : 'Custom pricing'}</div></div>
          <div className="flex flex-wrap gap-1.5">{Object.entries(data.plan.features).filter(([, v]) => v).map(([k]) => <span key={k} className="text-2xs rounded-full bg-white/10 px-2.5 py-1">{titleCase(k.replace(/([A-Z])/g, '_$1').toLowerCase())}</span>)}</div></div>
      </Card>
      <Card><div className="font-semibold mb-5">Usage this month</div><div className="grid md:grid-cols-2 gap-6">
        {meter('Active patients', U.activePatients, L.activePatients)}{meter('Branches', U.branches, L.branches)}{meter('Team seats', U.seats, L.seats)}{meter('Check-ins', U.checkinsThisMonth)}
        {meter('AI calls', U.aiCallsThisMonth)}<div><div className="flex justify-between text-sm"><span>AI spend (your keys)</span><span className="num text-ink-3">{usd(U.aiCostThisMonth)}</span></div><div className="text-xs text-ink-3 mt-1">Storage {U.storageMb} MB (encrypted)</div></div>
      </div></Card>
    </div>
  );
}
