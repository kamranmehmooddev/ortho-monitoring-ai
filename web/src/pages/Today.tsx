import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, Siren, Clock3, CalendarDays, Sparkles, Waves, Paperclip, Scissors, CircleCheck, BrainCircuit } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Button, Card, Callout, Empty, PageHeader, Pill, Skeleton, Stat } from '../components/ui';
import { GoNoGoPill, PatientCell } from '../components/clinical';
import { ago, fmtDay, fmtTime, fmtDate, until } from '../lib/format';
import { URGENCY_TONE, VISIT_KIND_LABELS } from '../lib/clinical';

const ISSUE_LABEL: Record<string, string> = { aligner_cracked: 'Cracked aligner', aligner_lost: 'Lost aligner', attachment_off: 'Attachment off', poor_fit: 'Poor fit', pain: 'Pain', irritation: 'Irritation', bracket_loose: 'Loose bracket', wire_poking: 'Poking wire', elastic_hook: 'Elastic hook', other: 'Other' };

export function Today() {
  const { me } = useAuth();
  const { data: d, loading } = useApi<any>('/dashboard');
  const nav = useNavigate();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = me?.name.replace(/^Dr\.?\s+/, 'Dr. ').split(' ').slice(0, 2).join(' ');

  if (loading || !d) return <div className="space-y-4"><Skeleton className="h-12 w-80" /><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-80" /></div>;
  const k = d.kpis;

  return (
    <div className="animate-in">
      <PageHeader eyebrow={new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        title={<>{greet}, {first}</>}
        subtitle={<>{k.awaitingReview} check-ins waiting for review{k.urgentOpen ? <> · <span className="text-urgent font-medium">{k.urgentOpen} urgent reports</span></> : null} · {k.readyForStageChange} look ready for their next aligner.</>}
        actions={<Button variant="primary" size="lg" onClick={() => nav('/app/review')} icon={<ClipboardCheck className="h-4 w-4" />}>Start reviewing</Button>} />

      {!k.aiConfigured && (
        <div className="mb-6"><Callout tone="info" title="AI observations are off" icon={<BrainCircuit className="h-4 w-4" />}>
          No AI provider is configured, so new check-ins get quality checks and go/no-go rules only. Add a vision model key in <Link className="link" to="/app/settings/ai">Settings → AI providers</Link>. Observations marked <strong>Demo data</strong> were seeded for demonstration.
        </Callout></div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Awaiting review" value={k.awaitingReview} tone="info" hint={k.medianTurnaroundHours != null ? `Median turnaround ${Math.round(k.medianTurnaroundHours)} h` : undefined} onClick={() => nav('/app/review')} />
        <Stat label="Triage" value={k.triageOpen} tone={k.urgentOpen ? 'urgent' : 'neutral'} hint={`${k.urgentOpen} P1–P2 within SLA window`} onClick={() => nav('/app/triage')} />
        <Stat label="Overdue check-ins" value={k.overdue} tone="attention" hint="Past interval + grace period" onClick={() => nav('/app/patients?status=active')} />
        <Stat label="Ready for next aligner" value={k.readyForStageChange} tone="stable" hint={`${k.reviewedToday} decisions today · ${k.activePatients} active patients`} onClick={() => nav('/app/review?filter=ready')} />
      </div>

      <div className="grid xl:grid-cols-[1.35fr_1fr] gap-6">
        <div className="space-y-6">
          <Card pad={false}>
            <Head icon={<ClipboardCheck className="h-4 w-4" />} title="Priority review" count={k.awaitingReview} to="/app/review" />
            {d.awaiting.length === 0 ? <Empty title="All caught up">No check-ins are waiting for review.</Empty> : (
              <ul className="divide-y divide-line">
                {d.awaiting.map((a: any) => (
                  <li key={a.checkinId} onClick={() => nav(`/app/review/${a.checkinId}`)} className="px-5 py-3.5 flex items-center gap-4 hover:bg-raised cursor-pointer transition">
                    <PriorityBar score={a.priority} />
                    <div className="flex-1 min-w-0"><PatientCell id={a.patientId} name={a.patientName} hue={a.avatarHue} sub={a.reasons.length ? a.reasons.slice(0, 2).join(' · ') : `Aligner ${a.stageNo} · routine`} /></div>
                    <GoNoGoPill rec={a.gonogo?.recommendation} size="sm" />
                    <span className="text-xs text-ink-3 w-16 text-right">{ago(a.submittedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <MiniList icon={<Waves className="h-4 w-4" />} title="Possible tracking issues" items={d.trackingIssues} empty="No possible seating gaps"
              render={(x: any) => <Row key={x.checkinId} onClick={() => nav(`/app/review/${x.checkinId}`)} left={<PatientCell id={x.patientId} name={x.patientName} hue={x.avatarHue} size={30} sub={`${x.finding.teeth.join(', ')} · ${x.finding.novelty}`} />} right={<Pill size="sm" tone={x.finding.novelty === 'persistent' ? 'urgent' : 'attention'} icon={false}>{x.finding.novelty}</Pill>} />} />
            <MiniList icon={<Paperclip className="h-4 w-4" />} title="Attachment concerns" items={d.attachmentConcerns} empty="No attachment concerns"
              render={(x: any) => <Row key={x.checkinId} onClick={() => nav(`/app/review/${x.checkinId}`)} left={<PatientCell id={x.patientId} name={x.patientName} hue={x.avatarHue} size={30} sub={`Tooth ${x.finding.teeth.join(', ')}`} />} right={<Pill size="sm" tone="attention" icon={false}>possible</Pill>} />} />
            <MiniList icon={<Scissors className="h-4 w-4" />} title="Broken or lost aligners" items={d.brokenOrLost} empty="No appliance reports"
              render={(x: any) => <Row key={x.id} onClick={() => nav('/app/triage')} left={<PatientCell id={x.patientId} name={x.patientName} hue={x.avatarHue} size={30} sub={`${ISSUE_LABEL[x.category]} · ${ago(x.createdAt)}`} />} right={<Pill size="sm" tone={URGENCY_TONE[x.urgency]}>{x.urgency}</Pill>} />} />
            <MiniList icon={<CircleCheck className="h-4 w-4" />} title="Ready for stage change" items={d.readyForStageChange} empty="None ready yet"
              render={(x: any) => <Row key={x.checkinId} onClick={() => nav(`/app/review/${x.checkinId}`)} left={<PatientCell id={x.patientId} name={x.patientName} hue={x.avatarHue} size={30} sub={`Aligner ${x.stageNo} → ${x.stageNo + 1}`} />} right={<Pill size="sm" tone={x.confidence === 'high' ? 'stable' : 'uncertain'} icon={false}>{x.confidence}</Pill>} />} />
          </div>
        </div>

        <div className="space-y-6">
          <Card pad={false}>
            <Head icon={<Siren className="h-4 w-4" />} title="Triage" count={d.triage.length} to="/app/triage" />
            {d.triage.length === 0 ? <Empty title="No open reports" /> : (
              <ul className="divide-y divide-line">
                {d.triage.map((t: any) => (
                  <li key={t.id} className="px-5 py-3 flex items-center gap-3 hover:bg-raised cursor-pointer" onClick={() => nav('/app/triage')}>
                    <Pill tone={URGENCY_TONE[t.urgency]} size="sm">{t.urgency}</Pill>
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{t.patientName}</div><div className="text-xs text-ink-3 truncate">{ISSUE_LABEL[t.category]}{t.details ? ` · ${t.details}` : ''}</div></div>
                    <span className={t.slaDueAt < new Date().toISOString() ? 'text-xs text-urgent font-medium' : 'text-xs text-ink-3'}>{until(t.slaDueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <Head icon={<Sparkles className="h-4 w-4" />} title="Suggested visits" count={d.recommendations.length} to="/app/calendar" />
            {d.recommendations.length === 0 ? <Empty title="No visits suggested" /> : (
              <ul className="divide-y divide-line">
                {d.recommendations.map((r: any) => (
                  <li key={r.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0"><PatientCell id={r.patientId} name={r.patientName} hue={r.avatarHue} size={30} sub={r.label ?? VISIT_KIND_LABELS[r.kind]} /></div>
                    <div className="text-right"><div className="num text-sm font-medium">{r.durationMin} min</div><div className="text-2xs text-ink-3">by {fmtDate(r.latest)}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <Head icon={<CalendarDays className="h-4 w-4" />} title="Upcoming visits" count={d.upcomingVisits.length} to="/app/calendar" />
            <ul className="divide-y divide-line">
              {d.upcomingVisits.slice(0, 6).map((a: any) => (
                <li key={a.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-16 shrink-0"><div className="text-2xs text-ink-3">{fmtDay(a.startAt).split(',')[0]}</div><div className="num text-sm font-semibold">{fmtTime(a.startAt)}</div></div>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{a.patientName}</div><div className="text-xs text-ink-3">{VISIT_KIND_LABELS[a.type] ?? a.type} · {a.durationMin} min</div></div>
                </li>
              ))}
            </ul>
          </Card>

          <Card pad={false}>
            <Head icon={<Clock3 className="h-4 w-4" />} title="Overdue check-ins" count={d.overdue.length} to="/app/patients" />
            <ul className="divide-y divide-line">
              {d.overdue.map((o: any) => <Row key={o.patientId} left={<PatientCell id={o.patientId} name={o.patientName} hue={o.avatarHue} size={30} sub={o.lastSubmitted ? `Last check-in ${ago(o.lastSubmitted)}` : 'No check-in yet'} />} right={<Pill size="sm" tone="attention" icon={false}>{o.overdueDays} d overdue</Pill>} />)}
              {d.overdue.length === 0 && <Empty title="Everyone is on schedule" />}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Head({ icon, title, count, to }: { icon: ReactNode; title: string; count?: number; to: string }) {
  return (
    <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-line">
      <div className="flex items-center gap-2 font-semibold text-ink"><span className="text-ink-3">{icon}</span>{title}{count != null && <span className="num text-xs font-medium text-ink-3 bg-sunken rounded-full px-2 py-0.5">{count}</span>}</div>
      <Link to={to} className="text-xs text-ink-3 hover:text-ember-ink inline-flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
    </div>
  );
}
function MiniList({ icon, title, items, render, empty }: { icon: ReactNode; title: string; items: any[]; render: (x: any) => ReactNode; empty: string }) {
  return (
    <Card pad={false}>
      <div className="px-5 pt-4 pb-3 flex items-center gap-2 font-semibold text-ink border-b border-line"><span className="text-ink-3">{icon}</span>{title}<span className="num text-xs font-medium text-ink-3 bg-sunken rounded-full px-2 py-0.5">{items.length}</span></div>
      {items.length ? <ul className="divide-y divide-line">{items.slice(0, 4).map(render)}</ul> : <div className="px-5 py-6 text-sm text-ink-3">{empty}</div>}
    </Card>
  );
}
function Row({ left, right, onClick }: { left: ReactNode; right?: ReactNode; onClick?: () => void }) {
  return <li onClick={onClick} className={`px-5 py-3 flex items-center justify-between gap-3 ${onClick ? 'hover:bg-raised cursor-pointer' : ''}`}><div className="min-w-0 flex-1">{left}</div>{right}</li>;
}
export function PriorityBar({ score }: { score: number }) {
  const tone = score >= 60 ? 'bg-urgent' : score >= 25 ? 'bg-attention' : 'bg-stable';
  return <span className="flex flex-col items-center gap-1 w-8 shrink-0" title={`Priority ${score}`}><span className={`h-8 w-1.5 rounded-full ${tone}`} style={{ opacity: 0.35 + Math.min(1, score / 100) * 0.65 }} /><span className="num text-2xs text-ink-3">{score}</span></span>;
}
