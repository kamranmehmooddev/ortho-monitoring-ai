import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, PauseCircle, Camera, Building2, BrainCircuit, RefreshCw, Plus, FlaskConical, MessageSquareText, Activity } from 'lucide-react';
import { useApi, useKey } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Callout, Card, Empty, Field, Kbd, Modal, Pill, Skeleton, Toggle } from '../components/ui';
import { FindingCard, GoNoGoPanel, PatientCell, QualityPill, RecommendationCard, StageRing, Thumb, type Finding } from '../components/clinical';
import { ImageCompare, type Annotation } from '../components/clinical/ImageCompare';
import { CATEGORY_OPTIONS, URGENCY_TONE, VIEWS, VIEW_LABELS, VISIT_KIND_LABELS } from '../lib/clinical';
import { ago, fmtDate, fmtDateTime, titleCase } from '../lib/format';

type DecisionType = 'go' | 'no_go' | 'retake' | 'visit';

export function ReviewWorkspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { data: d, reload, loading, error } = useApi<any>(`/checkins/${id}`, [id]);
  const { data: instructions } = useApi<any[]>('/instructions');
  const [view, setView] = useState<string>('front');
  const [focus, setFocus] = useState<Finding | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!d) return;
    setAnnotations(d.annotations);
    const firstFindingView = d.findings.find((f: Finding) => f.status === 'open' && f.view)?.view;
    setView(firstFindingView ?? d.images[0]?.view ?? 'front');
    setFocus(null);
  }, [d]);

  useKey('ArrowRight', useCallback(() => d?.navigation.next && nav(`/app/review/${d.navigation.next}`), [d, nav]));
  useKey('ArrowLeft', useCallback(() => d?.navigation.prev && nav(`/app/review/${d.navigation.prev}`), [d, nav]));
  useKey('v', useCallback(() => setView((v) => VIEWS[(VIEWS.indexOf(v as any) + 1) % VIEWS.length]), []));

  const viewImages = useMemo(() => {
    if (!d) return null;
    const current = d.images.filter((i: any) => i.view === view);
    const cur = current.find((i: any) => i.qualityStatus !== 'unusable') ?? current[0];
    const prev = d.previousImages.find((i: any) => i.view === view);
    const base = d.referenceImages.find((i: any) => i.view === view);
    return { cur, prev, base, all: current };
  }, [d, view]);

  if (error) return <Card><Empty title="Check-in not available">{error.message}</Empty></Card>;
  if (loading || !d || !viewImages) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><div className="grid xl:grid-cols-[1fr_420px] gap-6"><Skeleton className="h-[560px]" /><Skeleton className="h-[560px]" /></div></div>;

  const reviewed = d.checkin.status !== 'awaiting_review';
  const findingsOpen = d.findings.filter((f: Finding) => f.status === 'open').length;
  const ai = d.checkin.aiStatus;

  const reviewFinding = async (f: Finding, action: string, extra?: { category?: string; note?: string }) => {
    try { await api(`/findings/${f.id}/review`, { body: { action, ...extra } }); reload(); }
    catch (e) { toast.error('Could not update observation', (e as Error).message); }
  };
  const annotate = async (imageId: string, kind: string, geometry: any, label?: string) => {
    try { const a = await api(`/images/${imageId}/annotations`, { body: { kind, geometry, label, color: '#F5B400' } }); setAnnotations((x) => [...x, a]); }
    catch (e) { toast.error('Annotation failed', (e as Error).message); }
  };
  const deleteAnnotation = async (aid: string) => { await api(`/annotations/${aid}`, { method: 'DELETE' }); setAnnotations((x) => x.filter((a) => a.id !== aid)); };

  const panels = [
    ...(viewImages.base ? [{ key: 'base', title: 'Baseline', subtitle: 'attachments bonded', imageId: viewImages.base.id }] : []),
    { key: 'prev', title: 'Previous', subtitle: d.previousCheckin ? fmtDate(d.previousCheckin.submittedAt) : 'none', imageId: viewImages.prev?.id ?? null, quality: viewImages.prev?.qualityStatus },
    { key: 'cur', title: 'Current', subtitle: fmtDate(d.checkin.submittedAt), imageId: viewImages.cur?.id ?? null, quality: viewImages.cur?.qualityStatus },
  ];

  return (
    <div className="animate-in">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Link to="/app/review" className="h-9 w-9 rounded-lg border border-line bg-surface grid place-items-center text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" /></Link>
        <PatientCell id={d.patient.id} name={d.patient.name} hue={d.patient.avatarHue} size={44}
          sub={<>{d.patient.protocolName} · {d.patient.doctorName} · {d.patient.branchName}</>} />
        {d.plan && <div className="flex items-center gap-3 pl-4 border-l border-line"><StageRing stage={d.plan.current_stage} total={d.plan.totalStages} size={46} /><div className="text-xs text-ink-3"><div><span className="text-ink font-medium num">{d.plan.daysOnStage}</span> / {d.plan.stage_days} days on aligner</div><div>Submitted {ago(d.checkin.submittedAt)}</div></div></div>}
        <div className="flex-1" />
        {reviewed && <Pill tone="stable">Reviewed {fmtDateTime(d.checkin.reviewedAt)}</Pill>}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ink-3 num mr-1">{d.navigation.index >= 0 ? `${d.navigation.index + 1} of ${d.navigation.total}` : `${d.navigation.total} in queue`}</span>
          <Button size="sm" variant="secondary" disabled={!d.navigation.prev} onClick={() => nav(`/app/review/${d.navigation.prev}`)} icon={<ChevronLeft className="h-4 w-4" />} aria-label="Previous" />
          <Button size="sm" variant="secondary" disabled={!d.navigation.next} onClick={() => nav(`/app/review/${d.navigation.next}`)} icon={<ChevronRight className="h-4 w-4" />} aria-label="Next" />
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_430px] gap-6 items-start">
        {/* LEFT: images & patient context */}
        <div className="space-y-6 min-w-0">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {VIEWS.map((v) => {
                const imgs = d.images.filter((i: any) => i.view === v);
                const q = imgs.some((i: any) => i.qualityStatus === 'usable') ? 'usable' : imgs.some((i: any) => i.qualityStatus === 'limited') ? 'limited' : imgs.length ? 'unusable' : null;
                const nF = d.findings.filter((f: Finding) => f.view === v && f.status === 'open').length;
                return (
                  <button key={v} onClick={() => setView(v)} className={clsx('h-9 px-3 rounded-lg border text-sm font-medium inline-flex items-center gap-2 transition',
                    view === v ? 'bg-navy text-white border-navy dark:bg-white dark:text-navy' : 'bg-surface border-line text-ink-2 hover:border-line-strong')}>
                    <span className={clsx('h-2 w-2 rounded-full', q === 'usable' ? 'bg-stable' : q === 'limited' ? 'bg-attention' : q === 'unusable' ? 'bg-urgent' : 'bg-ink-4')} />
                    {VIEW_LABELS[v]}{nF > 0 && <span className="num text-2xs rounded-full bg-attention text-white px-1.5">{nF}</span>}
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-ink-3 hidden lg:flex items-center gap-1"><Kbd>V</Kbd> next view · <Kbd>←</Kbd><Kbd>→</Kbd> patient · scroll to zoom</span>
            </div>
            <ImageCompare key={view} panels={panels}
              highlight={focus && focus.view === view ? { imageId: focus.imageId ?? viewImages.cur?.id, bbox: focus.bbox } : null}
              annotations={annotations} onAnnotate={can('findings.review') ? annotate : undefined} onDeleteAnnotation={can('findings.review') ? deleteAnnotation : undefined}
              toolbarExtra={viewImages.all.length > 1 && <span className="text-2xs text-white/50">{viewImages.all.length} photos in this view</span>} />
            {viewImages.cur?.quality && <QualityStrip q={viewImages.cur.quality} />}
            <div className="flex gap-2 mt-3 overflow-x-auto scroll-thin pb-1">
              {d.images.map((i: any) => <Thumb key={i.id} id={i.id} quality={i.qualityStatus} active={i.view === view} className="h-16 w-[86px]" label={VIEW_LABELS[i.view]?.split(' ')[0] + (i.withAligner ? '' : ' · no aligner')} onClick={() => setView(i.view)} />)}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <div className="label mb-3">Patient report</div>
              <dl className="grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-ink-3">Aligner worn</dt><dd className="num font-medium">#{d.checkin.reportedAligner ?? '—'} {d.plan && d.checkin.reportedAligner !== d.plan.current_stage && <Pill size="sm" tone="attention" icon={false}>plan: {d.plan.current_stage}</Pill>}</dd>
                <dt className="text-ink-3">Wear (reported)</dt><dd className="font-medium">{d.checkin.wear ?? '—'} h/day</dd>
                <dt className="text-ink-3">Wear log median 7d</dt><dd className="font-medium num">{d.wearMedian7d != null ? `${d.wearMedian7d} h` : '—'}</dd>
                <dt className="text-ink-3">Fit</dt><dd>{d.checkin.fit ? <Pill size="sm" tone={d.checkin.fit === 'good' ? 'stable' : 'attention'} icon={false}>{d.checkin.fit}</Pill> : '—'}</dd>
                <dt className="text-ink-3">Pain</dt><dd className="num font-medium">{d.checkin.painLevel}/10</dd>
                <dt className="text-ink-3">Symptoms</dt><dd>{d.checkin.symptoms.length ? d.checkin.symptoms.map(titleCase).join(', ') : 'None'}</dd>
              </dl>
              {d.checkin.concerns && <blockquote className="mt-4 rounded-lg bg-sunken px-3.5 py-3 text-sm text-ink-2 border-l-2 border-ember">“{d.checkin.concerns}”</blockquote>}
              <WearBars wear={d.wear} />
            </Card>
            <div className="space-y-6">
              <Card>
                <div className="label mb-3 flex items-center gap-1.5"><BrainCircuit className="h-3.5 w-3.5" />AI observation status</div>
                <AiStatus ai={ai} onRerun={can('findings.review') ? async () => { const r = await api(`/checkins/${d.checkin.id}/reanalyze`, { method: 'POST' }); toast[r.status === 'completed' ? 'success' : 'error'](`AI: ${r.status.replace('_', ' ')}`, r.message); reload(); } : undefined} />
              </Card>
              {d.issues.length > 0 && (
                <Card>
                  <div className="label mb-3">Recent patient reports</div>
                  <ul className="space-y-2.5">{d.issues.map((i: any) => (
                    <li key={i.id} className="flex items-start gap-2.5 text-sm"><Pill size="sm" tone={URGENCY_TONE[i.urgency]}>{i.urgency}</Pill><div className="min-w-0"><div className="font-medium">{titleCase(i.category)} <span className="text-ink-3 font-normal">· {i.status}</span></div>{i.details && <div className="text-xs text-ink-3">{i.details}</div>}</div></li>
                  ))}</ul>
                </Card>
              )}
            </div>
          </div>

          {d.plan && <PlanContext plan={d.plan} />}
        </div>

        {/* RIGHT: decision rail */}
        <div className="space-y-5 xl:sticky xl:top-20">
          {d.gonogo && <GoNoGoPanel g={d.gonogo} />}
          {!reviewed && can('clinical.decide') && <DecisionComposer d={d} instructions={instructions ?? []} onDone={(next) => next ? nav(`/app/review/${next}`) : nav('/app/review')} />}
          {!can('clinical.decide') && !reviewed && <Callout tone="info">Clinical decisions need an orthodontist or dentist. You can add notes through messages.</Callout>}

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="label">Observations · {findingsOpen} open</div>
              {can('findings.review') && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>Add missed finding</Button>}
            </div>
            <div className="space-y-2.5">
              {d.findings.length === 0 && <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-ink-3 text-center">No observations. The absence of a finding does not rule out a problem. Please review the images.</div>}
              {d.findings.map((f: Finding) => <FindingCard key={f.id} f={f} canReview={can('findings.review')} focused={focus?.id === f.id}
                onFocus={() => { setFocus(f); if (f.view) setView(f.view); }} onReview={(a, x) => reviewFinding(f, a, x)} />)}
            </div>
          </div>

          {d.recommendation && <RecommendationCard r={d.recommendation} />}
          <Card className="!p-4">
            <div className="label mb-1.5">Next check-in</div>
            <div className="font-medium">{fmtDate(d.nextCheckin.date)}</div>
            <div className="text-xs text-ink-3 mt-0.5">{d.nextCheckin.reasons.join(' · ')}</div>
          </Card>
          {d.decisions.length > 0 && (
            <Card className="!p-4">
              <div className="label mb-2.5">Stage history</div>
              <ul className="space-y-2">{d.decisions.slice(0, 5).map((x: any) => (
                <li key={x.id} className="flex items-center gap-2 text-sm"><Pill size="sm" tone={x.type === 'go' ? 'stable' : x.type === 'visit' ? 'urgent' : 'attention'} icon={false}>{x.type.replace('_', '-')}</Pill>
                  <span className="text-ink-2 truncate flex-1">{x.type === 'go' ? `Aligner ${x.stageFrom} → ${x.stageTo}` : x.type === 'no_go' ? `Held ${x.holdDays} d on ${x.stageFrom}` : x.type}</span>
                  <span className="text-2xs text-ink-3">{fmtDate(x.decidedAt)}</span></li>
              ))}</ul>
            </Card>
          )}
          <EvalLabel d={d} view={view} imageId={viewImages.cur?.id} />
        </div>
      </div>
      <AddFindingModal open={addOpen} onClose={() => setAddOpen(false)} checkinId={d.checkin.id} view={view} imageId={viewImages.cur?.id} onSaved={reload} />
    </div>
  );
}

function QualityStrip({ q }: { q: any }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <QualityPill status={q.status} />
      {q.checks.map((c: any) => (
        <span key={c.id} title={`${c.message} (threshold ${c.threshold})`} className={clsx('inline-flex items-center gap-1 rounded-md px-2 h-6 border', c.passed ? 'border-line text-ink-3' : c.severity === 'hard' ? 'border-urgent/40 text-urgent bg-urgent-soft' : 'border-attention/40 text-attention bg-attention-soft')}>
          {titleCase(c.id)} <span className="num opacity-80">{c.value}</span>
        </span>
      ))}
      <span className="text-2xs text-ink-4 ml-1">{q.version} · deterministic</span>
    </div>
  );
}

function WearBars({ wear }: { wear: { date: string; hours: number }[] }) {
  if (!wear.length) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2"><span className="text-xs text-ink-3 inline-flex items-center gap-1"><Activity className="h-3.5 w-3.5" />Wear log, last 14 days</span><span className="text-2xs text-ink-4">target 22 h</span></div>
      <div className="flex items-end gap-1 h-14 relative">
        <div className="absolute inset-x-0 border-t border-dashed border-stable/50" style={{ bottom: `${(22 / 24) * 100}%` }} />
        {wear.map((w) => <div key={w.date} title={`${w.date}: ${w.hours} h`} className={clsx('flex-1 rounded-sm', w.hours >= 20 ? 'bg-stable/70' : w.hours >= 16 ? 'bg-attention/70' : 'bg-urgent/70')} style={{ height: `${(w.hours / 24) * 100}%` }} />)}
      </div>
    </div>
  );
}

function AiStatus({ ai, onRerun }: { ai: any; onRerun?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const status = ai?.status ?? 'pending';
  const text: Record<string, string> = {
    completed: ai?.provider === 'seed_demo' ? 'Demo record. The observations shown were seeded for demonstration and are not model output.' : ai?.message ?? 'Completed',
    no_provider: 'No AI provider is configured for this clinic. Review is based on image quality checks and go/no-go rules.',
    no_consent: 'The patient has not consented to AI processing. Images were not sent to any provider.',
    no_usable_images: 'No image passed the quality check, so no observations were generated.',
    budget: 'The AI spending limit has been reached. Observations were skipped.',
    failed: ai?.message ?? 'All configured providers failed.',
    pending: 'Analysis is running or has not started.',
  };
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5"><Pill size="sm" tone={status === 'completed' ? (ai?.provider === 'seed_demo' ? 'attention' : 'stable') : status === 'pending' ? 'info' : 'neutral'}>{titleCase(status)}</Pill>
        {ai?.model && <span className="text-2xs text-ink-3">{ai.provider} · {ai.model} · {ai.promptVersion}</span>}</div>
      <p className="text-sm text-ink-2">{text[status] ?? status}</p>
      {ai?.viewNotes?.filter((v: any) => v.limitation).map((v: any) => <p key={v.view} className="text-xs text-ink-3 mt-1">{VIEW_LABELS[v.view]}: {v.limitation}</p>)}
      <p className="text-2xs text-ink-4 mt-2">A general-purpose vision model describes what is visible for clinician review. It is not a validated detector.</p>
      {onRerun && <Button size="sm" variant="ghost" className="mt-2 -ml-2" loading={busy} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={async () => { setBusy(true); try { await onRerun(); } finally { setBusy(false); } }}>Re-run analysis</Button>}
    </div>
  );
}

function PlanContext({ plan }: { plan: any }) {
  const stageNow = plan.current_stage;
  const attachments = plan.attachments.filter((a: any) => a.placed_stage <= stageNow && (!a.removed_stage || a.removed_stage > stageNow));
  const iprSoon = plan.ipr.filter((i: any) => i.stage_no >= stageNow - 1 && i.stage_no <= stageNow + 3);
  return (
    <Card>
      <div className="flex items-center justify-between mb-4"><div className="label">Treatment plan · {plan.system}</div><span className="text-xs text-ink-3">Started {fmtDate(plan.start_date)}</span></div>
      <div className="flex gap-[3px] mb-5">
        {plan.stages.map((s: any) => (
          <div key={s.stage_no} title={`Aligner ${s.stage_no}: ${s.status} · change ${s.expected_change}`}
            className={clsx('h-7 flex-1 rounded-[3px] grid place-items-center text-[9px] num font-medium', s.status === 'completed' ? 'bg-navy/80 text-white/80 dark:bg-white/30' : s.status === 'active' ? 'bg-brand-gradient text-navy' : s.status === 'held' ? 'bg-attention text-white' : 'bg-sunken text-ink-4',
              plan.ipr.some((i: any) => i.stage_no === s.stage_no && i.status === 'planned') && 'ring-2 ring-inset ring-info')}>{plan.stages.length <= 30 ? s.stage_no : ''}</div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-5 text-sm">
        <div><div className="text-xs text-ink-3 mb-1">Attachments active</div><div className="flex flex-wrap gap-1">{attachments.length ? attachments.map((a: any) => <span key={a.id} className="num text-xs rounded border border-line px-1.5 py-0.5" title={a.type}>{a.tooth_fdi}</span>) : '—'}</div></div>
        <div><div className="text-xs text-ink-3 mb-1">IPR around this stage</div>{iprSoon.length ? iprSoon.map((i: any) => <div key={i.id} className="text-xs"><span className="num font-medium">{i.tooth_a}/{i.tooth_b}</span> {i.amount_mm} mm · stage {i.stage_no} <Pill size="sm" tone={i.status === 'done' ? 'stable' : 'info'} icon={false}>{i.status}</Pill></div>) : <span className="text-ink-3">None</span>}</div>
        <div><div className="text-xs text-ink-3 mb-1">Doctor instructions</div><div className="text-xs text-ink-2">{plan.doctor_instructions ?? '—'}</div>
          {plan.instruction_tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{plan.instruction_tags.map((t: any, i: number) => <Pill key={i} size="sm" tone="info" icon={false}>{t.type.replace('_', ' ')}{t.stage ? ` @${t.stage}` : ''}</Pill>)}</div>}</div>
      </div>
    </Card>
  );
}

function DecisionComposer({ d, instructions, onDone }: { d: any; instructions: any[]; onDone: (next: string | null) => void }) {
  const rec = d.gonogo?.recommendation;
  const initial: DecisionType = rec === 'go' ? 'go' : rec === 'retake' ? 'retake' : rec === 'visit' ? 'visit' : 'no_go';
  const [type, setType] = useState<DecisionType>(initial);
  const [hold, setHold] = useState<number>(d.gonogo?.suggestedHoldDays || 4);
  const [chewies, setChewies] = useState(true);
  const [views, setViews] = useState<string[]>(() => d.images.filter((i: any) => i.qualityStatus === 'unusable').map((i: any) => i.view));
  const [instructionId, setInstructionId] = useState('');
  const [message, setMessage] = useState('');
  const [visitDate, setVisitDate] = useState(d.recommendation?.slots?.[0]?.start?.slice(0, 10) ?? d.recommendation?.targetDate ?? '');
  const [visitDur, setVisitDur] = useState<number>(d.recommendation?.durationMin ?? 20);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { setType(initial); }, [d.checkin.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts: { t: DecisionType; label: string; icon: typeof CheckCircle2; cls: string }[] = [
    { t: 'go', label: 'Go', icon: CheckCircle2, cls: 'data-[on=true]:bg-stable data-[on=true]:border-stable' },
    { t: 'no_go', label: 'Hold', icon: PauseCircle, cls: 'data-[on=true]:bg-attention data-[on=true]:border-attention' },
    { t: 'retake', label: 'Retake', icon: Camera, cls: 'data-[on=true]:bg-info data-[on=true]:border-info' },
    { t: 'visit', label: 'Visit', icon: Building2, cls: 'data-[on=true]:bg-urgent data-[on=true]:border-urgent' },
  ];
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/checkins/${d.checkin.id}/decision`, { body: {
        type, message: message || undefined, instructionId: instructionId || undefined,
        ...(type === 'no_go' ? { holdDays: hold, prescribeChewies: chewies } : {}),
        ...(type === 'retake' ? { retakeViews: views } : {}),
        ...(type === 'visit' && visitDate ? { visit: { date: visitDate, durationMin: visitDur, kind: d.recommendation?.kind } } : {}),
      } });
      toast.success({ go: `Aligner ${d.plan?.current_stage + 1} approved`, no_go: `Hold for ${hold} days sent`, retake: 'Retake requested', visit: 'Visit requested' }[type], `${d.patient.name} has been notified.`);
      onDone(d.navigation.next);
    } catch (e) { toast.error('Decision not saved', (e as Error).message); } finally { setBusy(false); }
  };
  const overriding = rec && rec !== type && !(rec === 'not_yet' && type === 'no_go');

  return (
    <Card className="!p-4">
      <div className="label mb-3">Your decision</div>
      <div className="grid grid-cols-4 gap-1.5 mb-4">
        {opts.map((o) => (
          <button key={o.t} data-on={type === o.t} onClick={() => setType(o.t)}
            className={clsx('h-16 rounded-lg border border-line bg-surface flex flex-col items-center justify-center gap-1 text-xs font-semibold text-ink-2 transition hover:border-line-strong data-[on=true]:text-white', o.cls)}>
            <o.icon className="h-5 w-5" />{o.label}
          </button>
        ))}
      </div>
      {type === 'go' && <p className="text-sm text-ink-2 mb-3">Approve aligner <strong className="num">{(d.plan?.current_stage ?? 0) + 1}</strong>. Later expected change dates re-anchor to today.</p>}
      {type === 'no_go' && (
        <div className="space-y-3 mb-3">
          <Field label="Stay on current aligner for"><div className="flex items-center gap-2">{[2, 3, 4, 5, 7].map((n) => <button key={n} onClick={() => setHold(n)} className={clsx('h-8 w-10 rounded-md border text-sm num', hold === n ? 'bg-navy text-white border-navy' : 'border-line')}>{n}</button>)}<span className="text-sm text-ink-3">days</span></div></Field>
          <Toggle checked={chewies} onChange={setChewies} label="Prescribe chewies" description="Adds seating instructions to the patient message" />
        </div>
      )}
      {type === 'retake' && (
        <Field label="Views to retake"><div className="flex flex-wrap gap-1.5 mb-3">{VIEWS.map((v) => <button key={v} onClick={() => setViews((x) => x.includes(v) ? x.filter((y) => y !== v) : [...x, v])} className={clsx('h-8 px-2.5 rounded-md border text-xs font-medium', views.includes(v) ? 'bg-info text-white border-info' : 'border-line text-ink-2')}>{VIEW_LABELS[v]}</button>)}</div></Field>
      )}
      {type === 'visit' && (
        <div className="grid grid-cols-[1fr_110px] gap-2 mb-3">
          <Field label="Date" hint={d.recommendation ? `Suggested ${fmtDate(d.recommendation.earliest)}–${fmtDate(d.recommendation.latest)}` : undefined}><input type="date" className="input h-9" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></Field>
          <Field label="Chair time"><select className="input h-9" value={visitDur} onChange={(e) => setVisitDur(Number(e.target.value))}>{[15, 20, 25, 30, 40, 45, 55, 60, 75, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></Field>
          {d.recommendation && <p className="col-span-2 text-2xs text-ink-3 -mt-1">{VISIT_KIND_LABELS[d.recommendation.kind]}: the front desk confirms the exact time.</p>}
        </div>
      )}
      <div className="space-y-2">
        <select className="input h-9 text-sm" value={instructionId} onChange={(e) => setInstructionId(e.target.value)}>
          <option value="">Add a saved instruction…</option>
          {instructions.map((i) => <option key={i.id} value={i.id}>{i.category} · {i.title}</option>)}
        </select>
        <textarea className="textarea text-sm" rows={2} placeholder="Personal note to the patient (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      {overriding && <p className="text-2xs text-attention mt-2">This differs from the recommendation ({rec?.replace('_', '-')}). Your override is recorded for evaluation.</p>}
      <Button variant="primary" size="lg" className="w-full mt-3" loading={busy} onClick={submit} icon={<MessageSquareText className="h-4 w-4" />}>Send decision to patient</Button>
    </Card>
  );
}

function AddFindingModal({ open, onClose, checkinId, view, imageId, onSaved }: { open: boolean; onClose: () => void; checkinId: string; view: string; imageId?: string; onSaved: () => void }) {
  const [category, setCategory] = useState('tracking_gap');
  const [teeth, setTeeth] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true);
    try {
      await api(`/checkins/${checkinId}/findings`, { body: { category, view, imageId, note, teeth: teeth.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n >= 11 && n <= 48) } });
      toast.success('Finding recorded', 'Counted as a missed observation for AI evaluation.'); onSaved(); onClose();
    } catch (e) { toast.error('Could not save', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a finding the AI missed" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save finding</Button></>}>
      <div className="space-y-4">
        <Field label="Category"><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Teeth (FDI)" hint="e.g. 11, 21"><input className="input" value={teeth} onChange={(e) => setTeeth(e.target.value)} /></Field>
        <Field label="Note"><textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-ink-3">Recorded against the {VIEW_LABELS[view]} view.</p>
      </div>
    </Modal>
  );
}

function EvalLabel({ d, view, imageId }: { d: any; view: string; imageId?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('tracking_gap');
  const [label, setLabel] = useState('present');
  const toast = useToast();
  const { can } = useAuth();
  if (!can('findings.review') || !imageId) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full text-xs text-ink-3 hover:text-ink inline-flex items-center justify-center gap-1.5 py-2"><FlaskConical className="h-3.5 w-3.5" />Label this {VIEW_LABELS[view].toLowerCase()} image for evaluation</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add to clinician-labelled evaluation set"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => {
          try { await api(`/checkins/${d.checkin.id}/eval-case`, { body: { imageId, category, label } }); toast.success('Labelled case added'); setOpen(false); } catch (e) { toast.error('Not added', (e as Error).message); }
        }}>Add case</Button></>}>
        <div className="space-y-4">
          <Field label="Category"><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Ground truth (your clinical judgement)"><select className="input" value={label} onChange={(e) => setLabel(e.target.value)}><option value="present">Present</option><option value="absent">Absent</option><option value="cannot_assess">Cannot assess from this image</option></select></Field>
          <p className="text-xs text-ink-3">Needs the patient's research consent. Labelled cases are used to measure each model version before any accuracy is reported.</p>
        </div>
      </Modal>
    </>
  );
}
