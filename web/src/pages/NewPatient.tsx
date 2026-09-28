import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Check, Plus, Trash2, ArrowRight, ArrowLeft, KeyRound } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Callout, Card, Field, PageHeader, Pill, Toggle } from '../components/ui';
import { ToothChart } from './PatientProfile';
import { addDaysIso, fmtDate, todayIso } from '../lib/format';

const STEPS = ['Patient', 'Consent', 'Protocol', 'Treatment plan', 'Invite'];

export function NewPatient() {
  const [step, setStep] = useState(0);
  const nav = useNavigate();
  const toast = useToast();
  const { data: clinic } = useApi<any>('/settings/clinic');
  const { data: team } = useApi<any>('/team');
  const { data: protocols } = useApi<any[]>('/protocols');
  const [f, setF] = useState({ firstName: '', lastName: '', dob: '', email: '', phone: '', externalRef: '', minor: false, gName: '', gRel: 'Parent', gPhone: '', branchId: '', doctorId: '', protocolId: '', mode: 'aligner' });
  const [consent, setConsent] = useState({ photos: true, ai_processing: true, messaging: true, research: false });
  const [patientId, setPatientId] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const doctors = (team?.members ?? []).filter((m: any) => ['orthodontist', 'dentist', 'clinic_admin'].includes(m.role) && m.title?.match(/Orthodont|Dent/));
  useEffect(() => { if (clinic && !f.branchId) set('branchId', clinic.branches[0]?.id); }, [clinic]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (doctors.length && !f.doctorId) set('doctorId', doctors[0].id); }, [doctors.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (protocols?.length && !f.protocolId) set('protocolId', protocols[0].id); }, [protocols]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true);
    try {
      const p = await api('/patients', { body: { firstName: f.firstName, lastName: f.lastName, dob: f.dob || undefined, email: f.email || undefined, phone: f.phone || undefined, externalRef: f.externalRef || undefined,
        branchId: f.branchId, doctorId: f.doctorId, protocolId: f.protocolId, mode: protocols?.find((p) => p.id === f.protocolId)?.mode ?? 'aligner',
        guardian: f.minor ? { name: f.gName, relationship: f.gRel, phone: f.gPhone } : null, consent } });
      setPatientId(p.id); setStep(3);
    } catch (e) { toast.error('Could not create patient', (e as Error).message); } finally { setBusy(false); }
  };
  const canNext = [f.firstName && f.lastName && (!f.minor || f.gName), consent.photos, f.branchId && f.doctorId && f.protocolId, true, true][step];

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader eyebrow="Onboarding" title="New patient" subtitle="Takes about four minutes. The plan can be imported later from a treatment-plan viewer through the API." />
      <ol className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 flex-1">
            <span className={clsx('h-7 w-7 rounded-full grid place-items-center text-xs font-semibold shrink-0', i < step ? 'bg-stable text-white' : i === step ? 'bg-navy text-white dark:bg-white dark:text-navy' : 'bg-sunken text-ink-3')}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</span>
            <span className={clsx('text-sm hidden sm:block', i === step ? 'font-semibold text-ink' : 'text-ink-3')}>{s}</span>
            {i < STEPS.length - 1 && <span className="flex-1 h-px bg-line" />}
          </li>
        ))}
      </ol>
      <Card className="!p-7">
        {step === 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="First name"><input className="input" value={f.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus /></Field>
            <Field label="Last name"><input className="input" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
            <Field label="Date of birth"><input type="date" className="input" value={f.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
            <Field label="Practice system reference" hint="Used to match records over the API"><input className="input" value={f.externalRef} onChange={(e) => set('externalRef', e.target.value)} placeholder="PMS-10442" /></Field>
            <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Mobile"><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <div className="sm:col-span-2 pt-2"><Toggle checked={f.minor} onChange={(v) => set('minor', v)} label="Patient is a minor" description="A guardian receives notifications and gives consent" /></div>
            {f.minor && <>
              <Field label="Guardian name"><input className="input" value={f.gName} onChange={(e) => set('gName', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Relationship"><input className="input" value={f.gRel} onChange={(e) => set('gRel', e.target.value)} /></Field><Field label="Guardian phone"><input className="input" value={f.gPhone} onChange={(e) => set('gPhone', e.target.value)} /></Field></div>
            </>}
          </div>
        )}
        {step === 1 && (
          <div className="space-y-5">
            <Callout tone="info">Record consent as given by the patient{f.minor ? ' or guardian' : ''}. Each item can be changed later from the patient profile, and every change is audited.</Callout>
            <Toggle checked={consent.photos} onChange={(v) => setConsent({ ...consent, photos: v })} label="Remote monitoring photos (required)" description="Intraoral photos are captured in the app, encrypted and stored for the clinic's retention period." />
            <Toggle checked={consent.ai_processing} onChange={(v) => setConsent({ ...consent, ai_processing: v })} label="AI-assisted observations" description="Photos may be sent to the clinic's configured AI provider to generate observations for clinician review. Without this, only deterministic quality checks run." />
            <Toggle checked={consent.messaging} onChange={(v) => setConsent({ ...consent, messaging: v })} label="Secure messaging & reminders" />
            <Toggle checked={consent.research} onChange={(v) => setConsent({ ...consent, research: v })} label="Use de-identified images for evaluation" description="Lets clinicians add images to labelled evaluation sets used to measure AI performance." />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Branch"><select className="input" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>{clinic?.branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="Treating doctor"><select className="input" value={f.doctorId} onChange={(e) => set('doctorId', e.target.value)}>{doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            </div>
            <div className="label">Monitoring protocol</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {protocols?.map((p) => (
                <button key={p.id} onClick={() => set('protocolId', p.id)} className={clsx('text-left rounded-xl border p-4 transition', f.protocolId === p.id ? 'border-ember bg-ember-soft/60' : 'border-line hover:border-line-strong')}>
                  <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span>{f.protocolId === p.id && <Check className="h-4 w-4 text-ember" />}</div>
                  <div className="text-xs text-ink-3 mt-1">{p.description}</div>
                  <div className="flex flex-wrap gap-1 mt-2.5"><Pill size="sm" icon={false}>every {p.intervalDays} d</Pill><Pill size="sm" icon={false}>{p.requiredViews.length} photos</Pill>{p.criteria.minWearHours > 0 && <Pill size="sm" icon={false}>≥{p.criteria.minWearHours} h wear</Pill>}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 3 && patientId && <PlanEditor patientId={patientId} onSaved={() => setStep(4)} onCancel={() => setStep(4)} cancelLabel="Skip for now" />}
        {step === 4 && patientId && (
          <div className="text-center py-6">
            <div className="mx-auto h-14 w-14 rounded-full bg-stable-soft text-stable grid place-items-center mb-4"><Check className="h-7 w-7" /></div>
            <h2 className="display text-2xl">{f.firstName} is set up</h2>
            <p className="text-ink-3 mt-1 mb-6">Generate a one-time activation code for the patient app.</p>
            {invite ? (
              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
                <div className="rounded-xl bg-sunken p-4"><div className="label mb-1">Clinic code</div><div className="font-mono text-lg font-semibold">{invite.clinicCode}</div></div>
                <div className="rounded-xl bg-navy text-white p-4"><div className="label !text-white/50 mb-1">Activation code</div><div className="font-mono text-2xl tracking-[0.2em] font-semibold">{invite.activationCode}</div></div>
              </div>
            ) : <Button variant="ember" icon={<KeyRound className="h-4 w-4" />} onClick={async () => setInvite(await api(`/patients/${patientId}/invite`, { method: 'POST' }))}>Generate activation code</Button>}
            <div className="mt-8"><Button variant="primary" onClick={() => nav(`/app/patients/${patientId}`)}>Open patient profile <ArrowRight className="h-4 w-4" /></Button></div>
          </div>
        )}
        {step < 3 && (
          <div className="flex justify-between mt-8 pt-5 border-t border-line">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button>
            {step < 2 ? <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue <ArrowRight className="h-4 w-4" /></Button>
              : <Button variant="primary" disabled={!canNext} loading={busy} onClick={create}>Create patient <ArrowRight className="h-4 w-4" /></Button>}
          </div>
        )}
      </Card>
    </div>
  );
}

interface PlanDraft { system: string; totalUpper: number; totalLower: number; stageDays: number; startDate: string; currentStage: number; doctorInstructions: string;
  attachments: { tooth: number; type: string }[]; ipr: { toothA: number; toothB: number; amountMm: number; stage: number; status?: string }[]; visits: { stage: number; reason: string; procedures: string[] }[] }

export function PlanEditor({ patientId, initial, onSaved, onCancel, cancelLabel = 'Cancel' }: { patientId: string; initial?: any; onSaved: () => void; onCancel?: () => void; cancelLabel?: string }) {
  const toast = useToast();
  const [p, setP] = useState<PlanDraft>(() => initial ? {
    system: initial.system, totalUpper: initial.total_upper, totalLower: initial.total_lower, stageDays: initial.stage_days, startDate: initial.start_date, currentStage: initial.current_stage,
    doctorInstructions: initial.doctor_instructions ?? '', attachments: initial.attachments.map((a: any) => ({ tooth: a.tooth_fdi, type: a.type })),
    ipr: initial.ipr.map((i: any) => ({ toothA: i.tooth_a, toothB: i.tooth_b, amountMm: i.amount_mm, stage: i.stage_no, status: i.status })), visits: initial.visits.map((v: any) => ({ stage: v.stage_no, reason: v.reason, procedures: v.procedures })),
  } : { system: 'Clear aligners', totalUpper: 20, totalLower: 20, stageDays: 14, startDate: todayIso(), currentStage: 1, doctorInstructions: '', attachments: [], ipr: [], visits: [] });
  const [attType, setAttType] = useState('optimized');
  const [tags, setTags] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PlanDraft>(k: K, v: PlanDraft[K]) => setP((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    const t = setTimeout(() => api('/instructions/parse', { body: { text: p.doctorInstructions } }).then((r) => setTags(r.tags)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [p.doctorInstructions]);
  const total = Math.max(p.totalUpper, p.totalLower);
  const schedule = useMemo(() => Array.from({ length: Math.min(total, 6) }, (_, i) => ({ n: i + 1, change: addDaysIso(p.startDate, (i + 1) * p.stageDays) })), [total, p.startDate, p.stageDays]);
  const save = async () => {
    setBusy(true);
    try { await api(`/patients/${patientId}/plan`, { method: 'PUT', body: { ...p, attachments: p.attachments.map((a) => ({ tooth: a.tooth, type: a.type, placedStage: 1 })), ipr: p.ipr.map((i) => ({ ...i, status: i.status ?? 'planned' })) } }); onSaved(); }
    catch (e) { toast.error('Plan not saved', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-7">
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Aligner system"><input className="input" value={p.system} onChange={(e) => set('system', e.target.value)} /></Field>
        <Field label="Upper stages"><input type="number" min={1} className="input num" value={p.totalUpper} onChange={(e) => set('totalUpper', Number(e.target.value))} /></Field>
        <Field label="Lower stages"><input type="number" min={0} className="input num" value={p.totalLower} onChange={(e) => set('totalLower', Number(e.target.value))} /></Field>
        <Field label="Days per aligner"><input type="number" min={3} max={30} className="input num" value={p.stageDays} onChange={(e) => set('stageDays', Number(e.target.value))} /></Field>
        <Field label="Start date"><input type="date" className="input" value={p.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Current aligner"><input type="number" min={1} max={total} className="input num" value={p.currentStage} onChange={(e) => set('currentStage', Number(e.target.value))} /></Field>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-ink-3">Expected changes: {schedule.map((s) => <span key={s.n} className="num rounded bg-sunken px-2 py-1">#{s.n} → {fmtDate(s.change)}</span>)}{total > 6 && <span>… {total} stages, finishing {fmtDate(addDaysIso(p.startDate, total * p.stageDays))}</span>}</div>

      <div>
        <div className="flex items-center justify-between mb-2"><div className="font-semibold text-sm">Attachment map</div>
          <select className="input h-8 w-44 text-xs" value={attType} onChange={(e) => setAttType(e.target.value)}>{['optimized', 'rectangular', 'beveled', 'power_ridge', 'button'].map((t) => <option key={t}>{t}</option>)}</select></div>
        <ToothChart attachments={p.attachments.map((a) => ({ tooth_fdi: a.tooth }))} onToggle={(t) => set('attachments', p.attachments.some((a) => a.tooth === t) ? p.attachments.filter((a) => a.tooth !== t) : [...p.attachments, { tooth: t, type: attType }])} />
        <p className="text-xs text-ink-3 mt-2">Click teeth to toggle attachments. Upload baseline reference photos from the patient profile so the AI can compare against them.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><div className="font-semibold text-sm">IPR schedule</div><Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('ipr', [...p.ipr, { toothA: 12, toothB: 13, amountMm: 0.2, stage: 2 }])}>Add contact</Button></div>
        {p.ipr.map((i, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 mb-2 items-center">
            <input className="input h-9 num" type="number" value={i.toothA} onChange={(e) => set('ipr', p.ipr.map((x, j) => j === idx ? { ...x, toothA: Number(e.target.value) } : x))} aria-label="Tooth A" />
            <input className="input h-9 num" type="number" value={i.toothB} onChange={(e) => set('ipr', p.ipr.map((x, j) => j === idx ? { ...x, toothB: Number(e.target.value) } : x))} aria-label="Tooth B" />
            <input className="input h-9 num" type="number" step="0.05" value={i.amountMm} onChange={(e) => set('ipr', p.ipr.map((x, j) => j === idx ? { ...x, amountMm: Number(e.target.value) } : x))} aria-label="mm" />
            <input className="input h-9 num" type="number" value={i.stage} onChange={(e) => set('ipr', p.ipr.map((x, j) => j === idx ? { ...x, stage: Number(e.target.value) } : x))} aria-label="Before stage" />
            <button className="text-ink-4 hover:text-urgent p-2" onClick={() => set('ipr', p.ipr.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {p.ipr.length > 0 && <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-2xs text-ink-4 -mt-1"><span>Tooth A</span><span>Tooth B</span><span>mm</span><span>Before stage</span><span className="w-8" /></div>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2"><div className="font-semibold text-sm">Planned visits</div><Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('visits', [...p.visits, { stage: 6, reason: 'Progress review', procedures: [] }])}>Add visit</Button></div>
        {p.visits.map((v, idx) => (
          <div key={idx} className="grid grid-cols-[90px_1fr_160px_auto] gap-2 mb-2">
            <input className="input h-9 num" type="number" value={v.stage} onChange={(e) => set('visits', p.visits.map((x, j) => j === idx ? { ...x, stage: Number(e.target.value) } : x))} />
            <input className="input h-9" value={v.reason} onChange={(e) => set('visits', p.visits.map((x, j) => j === idx ? { ...x, reason: e.target.value } : x))} />
            <select className="input h-9" value={v.procedures[0] ?? ''} onChange={(e) => set('visits', p.visits.map((x, j) => j === idx ? { ...x, procedures: e.target.value ? [e.target.value] : [] } : x))}>
              <option value="">Review only</option><option value="ipr">IPR</option><option value="attachments">Attachments</option><option value="scan">Scan</option><option value="archwire">Archwire</option>
            </select>
            <button className="text-ink-4 hover:text-urgent p-2" onClick={() => set('visits', p.visits.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div>
        <Field label="Doctor instructions" hint="Free text. Scheduling-relevant instructions are parsed into tags you can see below (e.g. “IPR 0.3mm 12/13 at stage 10”, “rescan if tracking poor”, “see every 6 stages”).">
          <textarea className="textarea" rows={3} value={p.doctorInstructions} onChange={(e) => set('doctorInstructions', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5 mt-2">{tags.map((t, i) => <Pill key={i} size="sm" tone="info" icon={false}>{t.type.replace(/_/g, ' ')}{t.teeth?.length ? ` ${t.teeth.join('/')}` : ''}{t.amountMm ? ` ${t.amountMm}mm` : ''}{t.stage ? ` @${t.stage}` : ''}{t.stages ? ` every ${t.stages}` : ''}{t.minutes ? ` +${t.minutes}m` : ''}</Pill>)}{p.doctorInstructions && !tags.length && <span className="text-xs text-ink-3">No scheduling tags recognised.</span>}</div>
      </div>

      <div className="flex justify-end gap-2 pt-5 border-t border-line">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>}
        <Button variant="primary" loading={busy} onClick={save}>Save treatment plan</Button>
      </div>
    </div>
  );
}
