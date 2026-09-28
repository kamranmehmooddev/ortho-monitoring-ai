import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { KeyRound, Mail, Phone, ShieldCheck, ShieldOff, CalendarPlus, RefreshCw, Camera, CheckCircle2, Flag, CalendarDays, Layers, Copy } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Avatar, Button, Card, Empty, Modal, PageHeader, Pill, Skeleton, Tabs } from '../components/ui';
import { FindingCard, GoNoGoPill, RecommendationCard, StageRing, Thumb, type Finding } from '../components/clinical';
import { ImageCompare } from '../components/clinical/ImageCompare';
import { BookingModal } from '../components/clinical/BookingModal';
import { Thread } from './Messages';
import { PlanEditor } from './NewPatient';
import { URGENCY_TONE, VIEWS, VIEW_LABELS } from '../lib/clinical';
import { ago, fmtDate, fmtDateLong, fmtDateTime, titleCase } from '../lib/format';

type Tab = 'overview' | 'timeline' | 'images' | 'plan' | 'messages' | 'audit';

export function PatientProfile() {
  const { id } = useParams();
  const { data: d, reload } = useApi<any>(`/patients/${id}`, [id]);
  const [tab, setTab] = useState<Tab>('overview');
  const [invite, setInvite] = useState<any>(null);
  const [booking, setBooking] = useState(false);
  const { can } = useAuth();
  const toast = useToast();
  if (!d) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  const p = d.patient;
  const age = p.dob ? Math.floor((Date.now() - new Date(p.dob).getTime()) / 3.15576e10) : null;

  return (
    <div className="animate-in">
      <Card className="mb-6 !p-6">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar name={p.name} hue={p.avatarHue} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="display text-[30px] leading-none">{p.name}</h1><Pill tone={p.status === 'active' ? 'stable' : 'info'} size="sm">{titleCase(p.status)}</Pill><Pill tone="neutral" size="sm" icon={false}>{titleCase(p.mode)}</Pill></div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-ink-3">
              {age != null && <span>{age} years</span>}<span>{p.protocolName}</span><span>{p.doctorName} · {p.branchName}</span>
              {p.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{p.email}</span>}
              {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{p.phone}</span>}
              {p.externalRef && <span className="num">PMS {p.externalRef}</span>}
            </div>
            {p.guardian && <div className="text-xs text-ink-3 mt-1">Guardian: {p.guardian.name} ({p.guardian.relationship}){p.guardian.phone ? ` · ${p.guardian.phone}` : ''}</div>}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {[['photos', 'Photos'], ['ai_processing', 'AI processing'], ['messaging', 'Messaging'], ['research', 'Research use']].map(([k, l]) => (
                <span key={k} className={clsx('inline-flex items-center gap-1 text-2xs font-medium rounded-full px-2 h-5', p.consent[k] ? 'bg-stable-soft text-stable' : 'bg-sunken text-ink-3 line-through')}>{p.consent[k] ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}{l}</span>
              ))}
            </div>
          </div>
          {d.plan && <div className="flex items-center gap-4 pr-2"><StageRing stage={d.plan.current_stage} total={d.plan.totalStages} size={84} /><div className="text-sm"><div className="text-ink-3 text-xs">Next change</div><div className="font-semibold">{fmtDate(p.plan?.nextChange)}</div><div className="text-ink-3 text-xs mt-2">Next check-in</div><div className="font-semibold">{fmtDate(d.nextCheckin.date)}</div></div></div>}
          <div className="flex flex-col gap-2">
            {can('patients.write') && <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={async () => setInvite(await api(`/patients/${p.id}/invite`, { method: 'POST' }))}>{p.status === 'invited' ? 'Send app invite' : 'New device code'}</Button>}
            {can('appointments.book') && <Button variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setBooking(true)}>Book visit</Button>}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'timeline', label: 'Timeline' }, { value: 'images', label: 'Images' }, { value: 'plan', label: 'Plan & stages' }, { value: 'messages', label: 'Messages' }, ...(can('audit.view') ? [{ value: 'audit' as Tab, label: 'Audit' }] : [])]} />

      {tab === 'overview' && <Overview d={d} onBook={() => setBooking(true)} reload={reload} />}
      {tab === 'timeline' && <Timeline id={p.id} />}
      {tab === 'images' && <Images d={d} />}
      {tab === 'plan' && <PlanTab d={d} reload={reload} />}
      {tab === 'messages' && <Card pad={false} className="h-[620px] flex flex-col"><Thread patientId={p.id} consent={p.consent.messaging} /></Card>}
      {tab === 'audit' && <AuditTab patientId={p.id} />}

      <BookingModal open={booking} onClose={() => setBooking(false)} patientId={p.id} patientName={p.name} rec={d.recommendation} onBooked={reload} />
      <Modal open={!!invite} onClose={() => setInvite(null)} title="Patient app activation">
        {invite && <div className="text-center">
          <p className="text-sm text-ink-2 mb-5">Ask {p.firstName} to install <strong>Ortho Monitoring AI</strong> and enter these codes. They are single-use and expire {fmtDate(invite.expiresAt)}.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-sunken p-4"><div className="label mb-1">Clinic code</div><div className="font-mono text-lg font-semibold">{invite.clinicCode}</div></div>
            <div className="rounded-xl bg-navy text-white p-4"><div className="label !text-white/50 mb-1">Activation code</div><div className="font-mono text-2xl tracking-[0.2em] font-semibold">{invite.activationCode}</div></div>
          </div>
          <Button className="mt-5" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard?.writeText(`${invite.clinicCode} ${invite.activationCode}`); toast.success('Copied'); }}>Copy codes</Button>
        </div>}
      </Modal>
    </div>
  );
}

function Overview({ d, onBook, reload }: { d: any; onBook: () => void; reload: () => void }) {
  const { can } = useAuth();
  const open = d.findings.filter((f: Finding) => f.status === 'open');
  const refresh = async () => { await api(`/patients/${d.patient.id}/recommendation/refresh`, { method: 'POST' }); reload(); };
  return (
    <div className="grid xl:grid-cols-[1.3fr_1fr] gap-6 items-start">
      <div className="space-y-6">
        <Card pad={false}>
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line"><div className="font-semibold">Check-ins</div><span className="text-xs text-ink-3">{d.checkins.length} total</span></div>
          {d.checkins.length === 0 ? <Empty icon={<Camera className="h-5 w-5" />} title="No check-ins yet">Check-ins will appear here once the patient activates the app.</Empty> : (
            <ul className="divide-y divide-line">
              {d.checkins.slice(0, 8).map((c: any) => (
                <li key={c.id}><Link to={`/app/review/${c.id}`} className="px-5 py-3 flex items-center gap-4 hover:bg-raised">
                  <div className="w-24"><div className="text-sm font-medium">{fmtDate(c.submittedAt)}</div><div className="text-2xs text-ink-3">{ago(c.submittedAt)}</div></div>
                  <div className="flex-1 text-sm text-ink-2">Aligner {c.stageNo ?? '—'} · {c.imageCount} photos · wear {c.wear ?? '—'} · fit {c.fit ?? '—'}</div>
                  <Pill size="sm" tone={c.status === 'reviewed' ? 'stable' : c.status === 'retake_requested' ? 'attention' : 'info'} icon={false}>{titleCase(c.status)}</Pill>
                  {c.decision ? <Pill size="sm" tone={c.decision === 'go' ? 'stable' : c.decision === 'visit' ? 'urgent' : 'attention'}>Decided: {c.decision.replace('_', '-')}</Pill> : <GoNoGoPill rec={c.gonogo} size="sm" />}
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        {open.length > 0 && <div><div className="label mb-2.5">Open observations</div><div className="grid md:grid-cols-2 gap-3">{open.map((f: Finding) => <FindingCard key={f.id} f={f} canReview={false} />)}</div></div>}
        <Card>
          <div className="flex items-center justify-between mb-3"><div className="font-semibold">Wear time · 28 days</div><span className="text-xs text-ink-3">self-reported</span></div>
          <div className="flex items-end gap-[3px] h-24">{d.wear.map((w: any) => <div key={w.date} title={`${w.date}: ${w.hours} h`} className={clsx('flex-1 rounded-sm', w.hours >= 20 ? 'bg-stable/70' : w.hours >= 16 ? 'bg-attention/70' : 'bg-urgent/70')} style={{ height: `${(w.hours / 24) * 100}%` }} />)}{!d.wear.length && <span className="text-sm text-ink-3">No wear logged.</span>}</div>
        </Card>
      </div>
      <div className="space-y-6">
        {d.recommendation ? <RecommendationCard r={d.recommendation} action={<div className="flex gap-2">{can('appointments.book') && <Button variant="primary" size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={onBook}>Review & book</Button>}<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refresh}>Recalculate</Button></div>} />
          : <Card><div className="font-semibold mb-1">No visit needed yet</div><p className="text-sm text-ink-3">No planned procedure, instruction or open concern needs an in-person visit in the next three stages.</p><Button size="sm" variant="ghost" className="mt-2 -ml-2" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={refresh}>Recalculate</Button></Card>}
        <Card>
          <div className="font-semibold mb-1">Next check-in · {fmtDateLong(d.nextCheckin.date)}</div>
          <ul className="text-sm text-ink-3 list-disc pl-4 space-y-0.5">{d.nextCheckin.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
        </Card>
        <Card pad={false}>
          <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Appointments</div>
          <ul className="divide-y divide-line">{d.appointments.slice(0, 6).map((a: any) => <li key={a.id} className="px-5 py-2.5 flex items-center justify-between text-sm"><span><span className="font-medium">{fmtDateTime(a.startAt)}</span><span className="text-ink-3"> · {titleCase(a.type)} · {a.durationMin} min</span></span><Pill size="sm" icon={false} tone={a.status === 'booked' ? 'info' : a.status === 'completed' ? 'stable' : a.status === 'requested' ? 'attention' : 'neutral'}>{a.status}</Pill></li>)}</ul>
          {!d.appointments.length && <div className="px-5 py-4 text-sm text-ink-3">No appointments.</div>}
        </Card>
        {d.issues.length > 0 && <Card pad={false}><div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Patient reports</div><ul className="divide-y divide-line">{d.issues.map((i: any) => <li key={i.id} className="px-5 py-2.5 flex items-center gap-2.5 text-sm"><Pill size="sm" tone={URGENCY_TONE[i.urgency]}>{i.urgency}</Pill><span className="flex-1">{i.label}</span><span className="text-xs text-ink-3">{i.status} · {ago(i.createdAt)}</span></li>)}</ul></Card>}
      </div>
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const { data } = useApi<any[]>(`/patients/${id}/timeline`, [id]);
  const icon: Record<string, any> = { checkin: Camera, decision: CheckCircle2, issue: Flag, appointment: CalendarDays, stage: Layers };
  const tone: Record<string, string> = { stable: 'bg-stable-soft text-stable', attention: 'bg-attention-soft text-attention', urgent: 'bg-urgent-soft text-urgent', info: 'bg-info-soft text-info' };
  if (!data) return <Skeleton className="h-96" />;
  return (
    <Card className="!p-7">
      <ol className="relative border-l border-line ml-4 space-y-6">
        {data.map((e, i) => {
          const I = icon[e.type] ?? Flag;
          return (
            <li key={i} className="pl-8 relative">
              <span className={clsx('absolute -left-[17px] top-0 h-8 w-8 rounded-full grid place-items-center ring-4 ring-surface', tone[e.tone ?? 'info'])}><I className="h-4 w-4" /></span>
              <div className="flex flex-wrap items-baseline gap-x-3"><span className="font-medium">{e.title}</span><span className="text-xs text-ink-3">{fmtDateTime(e.at)}</span></div>
              {e.detail && <div className="text-sm text-ink-3 mt-0.5">{e.detail}</div>}
              {e.images?.length > 0 && <Link to={`/app/review/${e.ref}`} className="flex gap-1.5 mt-2">{e.images.map((im: string) => <Thumb key={im} id={im} className="h-12 w-16" />)}</Link>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Images({ d }: { d: any }) {
  const [view, setView] = useState('front');
  const [data, setData] = useState<any[] | null>(null);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(d.checkins.slice(0, 12).map((c: any) => api(`/checkins/${c.id}`).then((x) => ({ c, images: x.images })).catch(() => null))).then((r) => setData(r.filter(Boolean)));
  }, [d.checkins]);
  const series = (data ?? []).map((x: any) => ({ date: x.c.submittedAt, stage: x.c.stageNo, img: x.images.find((i: any) => i.view === view && i.qualityStatus !== 'unusable') ?? x.images.find((i: any) => i.view === view) })).filter((s) => s.img).reverse();
  useEffect(() => { if (series.length) { setA(series[0].img.id); setB(series[series.length - 1].img.id); } }, [view, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sa = series.find((s) => s.img.id === a), sb = series.find((s) => s.img.id === b);
  const ref = d.referenceImages.find((r: any) => r.view === view);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">{VIEWS.map((v) => <button key={v} onClick={() => setView(v)} className={clsx('h-9 px-3 rounded-lg border text-sm font-medium', view === v ? 'bg-navy text-white border-navy dark:bg-white dark:text-navy' : 'bg-surface border-line text-ink-2')}>{VIEW_LABELS[v]}</button>)}</div>
      {!data ? <Skeleton className="h-96" /> : series.length === 0 ? <Card><Empty title="No images for this view" /></Card> : <>
        <ImageCompare key={`${a}-${b}`} panels={[...(ref ? [{ key: 'ref', title: 'Baseline', imageId: ref.id }] : []), { key: 'a', title: `Aligner ${sa?.stage ?? ''}`, subtitle: fmtDate(sa?.date), imageId: a }, { key: 'b', title: `Aligner ${sb?.stage ?? ''}`, subtitle: fmtDate(sb?.date), imageId: b }]} annotations={[]} />
        <Card>
          <div className="label mb-3">Progression: click to set as left (A) or right (B)</div>
          <div className="flex gap-3 overflow-x-auto scroll-thin pb-2">
            {series.map((s) => (
              <div key={s.img.id} className="shrink-0 text-center">
                <Thumb id={s.img.id} quality={s.img.qualityStatus} className="h-24 w-32" active={s.img.id === a || s.img.id === b} onClick={() => setB(s.img.id)} />
                <div className="text-2xs text-ink-3 mt-1.5 num">#{s.stage} · {fmtDate(s.date)}</div>
                <div className="flex justify-center gap-1 mt-1"><button onClick={() => setA(s.img.id)} className={clsx('text-2xs px-1.5 rounded', a === s.img.id ? 'bg-ember text-white' : 'bg-sunken')}>A</button><button onClick={() => setB(s.img.id)} className={clsx('text-2xs px-1.5 rounded', b === s.img.id ? 'bg-ember text-white' : 'bg-sunken')}>B</button></div>
              </div>
            ))}
          </div>
        </Card>
      </>}
    </div>
  );
}

function PlanTab({ d, reload }: { d: any; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const plan = d.plan;
  if (!plan || editing) return <Card><PlanEditor patientId={d.patient.id} initial={plan} onSaved={() => { setEditing(false); reload(); toast.success('Treatment plan saved'); }} onCancel={plan ? () => setEditing(false) : undefined} /></Card>;
  const markIpr = async (id: string, status: string) => { await api(`/ipr/${id}`, { method: 'PATCH', body: { status } }); reload(); toast.success(`IPR marked ${status}`); };
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between mb-4"><div><div className="font-semibold">{plan.system}</div><div className="text-sm text-ink-3">{plan.totalStages} stages · {plan.stage_days}-day changes · started {fmtDate(plan.start_date)}</div></div>{can('patients.write') && <Button variant="secondary" onClick={() => setEditing(true)}>Edit plan</Button>}</div>
        <div className="grid grid-cols-6 sm:grid-cols-10 lg:grid-cols-[repeat(15,minmax(0,1fr))] gap-1.5">
          {plan.stages.map((s: any) => (
            <div key={s.stage_no} className={clsx('rounded-lg px-2 py-2 text-center border', s.status === 'active' ? 'border-ember bg-ember-soft' : s.status === 'completed' ? 'border-line bg-sunken' : s.status === 'held' ? 'border-attention bg-attention-soft' : 'border-line')}>
              <div className="num font-semibold text-sm">{s.stage_no}</div><div className="text-[10px] text-ink-3 num">{fmtDate(s.actual_start ?? s.expected_start)}</div>
              {plan.ipr.some((i: any) => i.stage_no === s.stage_no) && <div className="text-[9px] font-semibold text-info mt-0.5">IPR</div>}
            </div>
          ))}
        </div>
      </Card>
      <div className="grid lg:grid-cols-3 gap-6">
        <Card><div className="font-semibold mb-3">Attachment map</div><ToothChart attachments={plan.attachments} /><ul className="mt-4 space-y-1 text-sm">{plan.attachments.map((a: any) => <li key={a.id} className="flex justify-between"><span className="num font-medium">{a.tooth_fdi}</span><span className="text-ink-3">{a.type} · from stage {a.placed_stage}</span></li>)}</ul></Card>
        <Card><div className="font-semibold mb-3">IPR schedule</div>{plan.ipr.length ? <ul className="space-y-2.5">{plan.ipr.map((i: any) => <li key={i.id} className="flex items-center gap-2 text-sm"><span className="num font-medium w-14">{i.tooth_a}/{i.tooth_b}</span><span className="text-ink-3 flex-1">{i.amount_mm} mm · stage {i.stage_no}</span><Pill size="sm" icon={false} tone={i.status === 'done' ? 'stable' : i.status === 'skipped' ? 'neutral' : 'info'}>{i.status}</Pill>{i.status === 'planned' && can('clinical.decide') && <Button size="sm" variant="ghost" onClick={() => markIpr(i.id, 'done')}>Mark done</Button>}</li>)}</ul> : <p className="text-sm text-ink-3">No IPR planned.</p>}
          <p className="text-2xs text-ink-4 mt-4">IPR status is recorded chairside. It is never inferred from photos.</p></Card>
        <Card><div className="font-semibold mb-3">Doctor instructions</div><p className="text-sm text-ink-2 whitespace-pre-line">{plan.doctor_instructions ?? 'None'}</p>
          {plan.instruction_tags.length > 0 && <><div className="label mt-4 mb-2">Parsed for scheduling · instr-parse-v1</div><div className="flex flex-wrap gap-1.5">{plan.instruction_tags.map((t: any, i: number) => <Pill key={i} size="sm" tone="info" icon={false}>{t.type.replace(/_/g, ' ')}{t.teeth?.length ? ` ${t.teeth.join('/')}` : ''}{t.amountMm ? ` ${t.amountMm}mm` : ''}{t.stage ? ` @${t.stage}` : ''}{t.stages ? ` every ${t.stages}` : ''}{t.minutes ? ` +${t.minutes}m` : ''}</Pill>)}</div></>}
          <div className="label mt-5 mb-2">Planned visits</div>{plan.visits.length ? plan.visits.map((v: any) => <div key={v.id} className="text-sm"><span className="num font-medium">Stage {v.stage_no}</span> · {v.reason}</div>) : <p className="text-sm text-ink-3">None</p>}</Card>
      </div>
      <Card pad={false}><div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Stage history & decisions</div>
        <ul className="divide-y divide-line">{d.decisions.map((x: any) => <li key={x.id} className="px-5 py-3 flex items-start gap-3 text-sm"><Pill size="sm" tone={x.type === 'go' ? 'stable' : x.type === 'visit' ? 'urgent' : 'attention'} icon={false}>{x.type.replace('_', '-')}</Pill><div className="flex-1 min-w-0"><div className="text-ink">{x.type === 'go' ? `Aligner ${x.stageFrom} → ${x.stageTo}` : x.type === 'no_go' ? `Held on ${x.stageFrom} for ${x.holdDays} d` : titleCase(x.type)}{x.overrode && <span className="text-2xs text-attention ml-2">override</span>}</div><div className="text-xs text-ink-3 line-clamp-1">{x.message}</div></div><span className="text-xs text-ink-3 whitespace-nowrap">{x.decidedBy} · {fmtDate(x.decidedAt)}</span></li>)}</ul>
      </Card>
    </div>
  );
}

export function ToothChart({ attachments, onToggle }: { attachments: { tooth_fdi: number; type?: string }[]; onToggle?: (fdi: number) => void }) {
  const has = new Set(attachments.map((a) => a.tooth_fdi));
  const row = (q1: number, q2: number) => [...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => q1 * 10 + n), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => q2 * 10 + n)];
  const cell = (t: number) => (
    <button key={t} type="button" disabled={!onToggle} onClick={() => onToggle?.(t)} title={`${t}`}
      className={clsx('h-8 rounded-md text-[10px] num font-medium border transition', has.has(t) ? 'bg-brand-gradient text-navy border-transparent' : 'border-line text-ink-4', onToggle && 'hover:border-ember')}>{t}</button>
  );
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-16 gap-1" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>{row(1, 2).map(cell)}</div>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>{row(4, 3).map(cell)}</div>
      <div className="flex justify-between text-2xs text-ink-4"><span>Patient right</span><span>Patient left</span></div>
    </div>
  );
}

function AuditTab({ patientId }: { patientId: string }) {
  const { data } = useApi<any[]>(`/audit?patientId=${patientId}`, [patientId]);
  return (
    <Card pad={false}>
      <table className="w-full text-sm"><thead><tr className="border-b border-line bg-raised text-left">{['When', 'Who', 'Action', 'Detail'].map((h) => <th key={h} className="px-5 py-2.5 text-xs font-medium text-ink-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{(data ?? []).map((a) => <tr key={a.id}><td className="px-5 py-2.5 whitespace-nowrap text-ink-3">{fmtDateTime(a.createdAt)}</td><td className="px-5 py-2.5">{a.actorName ?? a.actorType}</td><td className="px-5 py-2.5 font-mono text-xs">{a.action}</td><td className="px-5 py-2.5 text-xs text-ink-3 truncate max-w-md">{a.meta ? JSON.stringify(a.meta) : ''}</td></tr>)}</tbody></table>
    </Card>
  );
}
