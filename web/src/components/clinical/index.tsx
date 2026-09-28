import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, PencilLine, CheckCircle2, XCircle, CircleDashed, Clock, CalendarPlus, Sparkles, ImageOff, RotateCcw } from 'lucide-react';
import { useImage } from '../../lib/hooks';
import { Avatar, Button, Pill } from '../ui';
import { CATEGORY_OPTIONS, GONOGO_META, QUALITY_TONE, UNCERTAINTY_TONE, VIEW_LABELS, VISIT_KIND_LABELS } from '../../lib/clinical';
import { fmtDay, fmtDate, titleCase } from '../../lib/format';

export function PatientCell({ id, name, hue, sub, size = 36 }: { id: string; name: string; hue?: number; sub?: ReactNode; size?: number }) {
  return (
    <Link to={`/app/patients/${id}`} className="flex items-center gap-3 min-w-0 group" onClick={(e) => e.stopPropagation()}>
      <Avatar name={name} hue={hue} size={size} />
      <span className="min-w-0">
        <span className="block font-medium text-ink truncate group-hover:text-ember-ink transition">{name}</span>
        {sub && <span className="block text-xs text-ink-3 truncate">{sub}</span>}
      </span>
    </Link>
  );
}

export function StageRing({ stage, total, size = 64, label = true }: { stage: number; total: number; size?: number; label?: boolean }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, p = Math.min(1, stage / Math.max(1, total));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id="stage-g" x1="0" x2="1"><stop offset="0" stopColor="#E8590C" /><stop offset="1" stopColor="#F5B400" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#stage-g)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />
      </svg>
      {label && <span className="absolute text-center leading-none"><span className="block display num" style={{ fontSize: size * 0.3 }}>{stage}</span><span className="block text-2xs text-ink-3 num">of {total}</span></span>}
    </div>
  );
}

export function GoNoGoPill({ rec, confidence, size = 'md' }: { rec?: string | null; confidence?: string; size?: 'sm' | 'md' }) {
  if (!rec) return <Pill tone="neutral" size={size}>Pending</Pill>;
  const m = GONOGO_META[rec];
  return <Pill tone={m.tone} size={size}>{m.label}{confidence && <span className="opacity-70 font-normal">· {confidence}</span>}</Pill>;
}

export function Thumb({ id, className, label, quality, onClick, active }: { id: string; className?: string; label?: string; quality?: string | null; onClick?: () => void; active?: boolean }) {
  const url = useImage(id);
  return (
    <button onClick={onClick} className={clsx('relative overflow-hidden rounded-lg bg-lightbox shrink-0 group', active && 'ring-2 ring-ember ring-offset-2 ring-offset-surface', className)}>
      {url ? <img src={url} alt={label ?? ''} className="h-full w-full object-cover transition group-hover:scale-[1.03]" /> : <div className="h-full w-full animate-pulse bg-navy-2" />}
      {label && <span className="absolute left-1.5 bottom-1.5 text-2xs font-medium text-white/90 bg-black/45 backdrop-blur-sm rounded px-1.5 py-0.5">{label}</span>}
      {quality && quality !== 'usable' && <span className={clsx('absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-black/30', quality === 'unusable' ? 'bg-urgent' : 'bg-attention')} />}
    </button>
  );
}

export function QualityPill({ status }: { status?: string | null }) {
  if (!status) return <Pill tone="neutral" size="sm" icon={false}>Not checked</Pill>;
  return <Pill tone={QUALITY_TONE[status]} size="sm">{titleCase(status)}</Pill>;
}

// ── Finding card (confirm / dismiss / correct) ──────────────────────────────
export interface Finding {
  id: string; source: string; category: string; clinicianCategory?: string | null; label: string; teeth: number[]; view?: string | null; imageId?: string | null; bbox?: { x: number; y: number; w: number; h: number } | null;
  assessment: string; novelty: string; uncertainty: string; evidence?: string | null; needsBetterImage: boolean; modelVersion?: string | null; promptVersion?: string | null;
  qualityBand?: string | null; status: string; clinicianNote?: string | null; reviewedAt?: string | null;
}

export function FindingCard({ f, onReview, onFocus, focused, canReview }: { f: Finding; onReview?: (action: string, extra?: { category?: string; note?: string }) => Promise<void>; onFocus?: () => void; focused?: boolean; canReview: boolean }) {
  const [correcting, setCorrecting] = useState(false);
  const [cat, setCat] = useState(f.category);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (a: string, extra?: { category?: string; note?: string }) => { setBusy(a); try { await onReview?.(a, extra); setCorrecting(false); } finally { setBusy(null); } };
  const cannot = f.assessment === 'cannot_assess';
  const statusPill = { confirmed: <Pill tone="stable" size="sm">Confirmed</Pill>, dismissed: <Pill tone="neutral" size="sm">Dismissed</Pill>, corrected: <Pill tone="info" size="sm">Corrected</Pill> }[f.status as 'confirmed'];

  return (
    <div onMouseEnter={onFocus} onClick={onFocus}
      className={clsx('rounded-xl border p-3.5 transition cursor-default', focused ? 'border-ember/60 bg-ember-soft/40' : 'border-line bg-surface hover:border-line-strong', f.status === 'dismissed' && 'opacity-60')}>
      <div className="flex items-start gap-2.5">
        <span className={clsx('mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center shrink-0', cannot ? 'bg-uncertain-soft text-uncertain' : 'bg-attention-soft text-attention')}>
          {cannot ? <CircleDashed className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm text-ink">{f.label}</span>
            {f.teeth.length > 0 && <span className="num text-xs text-ink-3">· {f.teeth.join(', ')}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Pill tone={cannot ? 'uncertain' : 'attention'} size="sm" icon={false}>{cannot ? 'Cannot assess from photo' : 'Possible · for review'}</Pill>
            <Pill tone={UNCERTAINTY_TONE[f.uncertainty]} size="sm" icon={false}>{titleCase(f.uncertainty)} uncertainty</Pill>
            {f.novelty !== 'unknown' && <Pill tone={f.novelty === 'persistent' ? 'urgent' : 'info'} size="sm" icon={false}>{titleCase(f.novelty)}</Pill>}
            {f.view && <Pill tone="neutral" size="sm" icon={false}>{VIEW_LABELS[f.view]}</Pill>}
            {statusPill}
          </div>
          {f.evidence && <p className="text-xs text-ink-2 mt-2 leading-relaxed">{f.evidence}</p>}
          {f.needsBetterImage && <p className="text-xs text-uncertain mt-1.5">A clearer photo of this area would help.</p>}
          {f.clinicianNote && <p className="text-xs text-ink-2 mt-1.5 italic">Clinician note: {f.clinicianNote}</p>}
          <div className="text-2xs text-ink-4 mt-2 flex flex-wrap gap-x-2">
            {f.source === 'seed_demo' ? <span className="text-attention font-medium">Demo data (not model output)</span> : f.source === 'clinician' ? <span>Added by clinician</span> : <span>{f.modelVersion} · {f.promptVersion}</span>}
            {f.qualityBand && <span>· image {f.qualityBand}</span>}
          </div>
        </div>
      </div>
      {canReview && (
        f.status === 'open' ? (
          correcting ? (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <select className="input h-9" value={cat} onChange={(e) => setCat(e.target.value)}>{CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input className="input h-9" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2 justify-end"><Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button><Button size="sm" variant="primary" loading={busy === 'correct'} onClick={() => run('correct', { category: cat, note })}>Save correction</Button></div>
            </div>
          ) : (
            <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
              <Button size="sm" variant="subtle" loading={busy === 'confirm'} icon={<Check className="h-3.5 w-3.5" />} onClick={() => run('confirm')}>Confirm</Button>
              <Button size="sm" variant="subtle" loading={busy === 'dismiss'} icon={<X className="h-3.5 w-3.5" />} onClick={() => run('dismiss')}>Dismiss</Button>
              <Button size="sm" variant="ghost" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => setCorrecting(true)}>Correct</Button>
            </div>
          )
        ) : (
          <div className="mt-2.5 flex justify-end"><button className="text-2xs text-ink-3 hover:text-ink inline-flex items-center gap-1" onClick={() => run('reopen')}><RotateCcw className="h-3 w-3" />Undo</button></div>
        )
      )}
    </div>
  );
}

// ── Go / No-go explanation ───────────────────────────────────────────────────
export interface GoNoGo { recommendation: string; confidence: string; headline: string; checks: { id: string; label: string; passed: boolean; detail: string; effect?: string }[]; suggestedHoldDays: number; batchEligible: boolean; version: string }

export function GoNoGoPanel({ g }: { g: GoNoGo }) {
  const m = GONOGO_META[g.recommendation];
  const accent = { stable: 'from-stable/15', attention: 'from-attention/15', urgent: 'from-urgent/15', info: 'from-info/15', neutral: 'from-ink-4/10', uncertain: 'from-uncertain/15', ember: 'from-ember/15' }[m.tone];
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className={clsx('px-4 py-3.5 bg-gradient-to-r to-transparent', accent)}>
        <div className="flex items-center justify-between gap-2">
          <div className="label">Recommendation · {g.version}</div>
          <Pill tone={g.confidence === 'high' ? 'stable' : g.confidence === 'medium' ? 'attention' : 'uncertain'} size="sm">{titleCase(g.confidence)} confidence</Pill>
        </div>
        <div className="mt-1.5 flex items-center gap-2"><GoNoGoPill rec={g.recommendation} /><span className="font-semibold text-ink">{g.headline}</span></div>
      </div>
      <ul className="divide-y divide-line">
        {g.checks.map((c) => (
          <li key={c.id} className="px-4 py-2.5 flex gap-2.5">
            {c.passed ? <CheckCircle2 className="h-4 w-4 text-stable mt-0.5 shrink-0" /> : <XCircle className={clsx('h-4 w-4 mt-0.5 shrink-0', c.effect === 'lower_confidence' ? 'text-attention' : 'text-urgent')} />}
            <div className="min-w-0"><div className="text-sm text-ink">{c.label}</div><div className="text-xs text-ink-3">{c.detail}</div></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Appointment recommendation ───────────────────────────────────────────────
export interface Rec { id: string; kind: string; label?: string; earliest: string; latest: string; targetDate: string; durationMin: number; uncertainty: string; factors: { text: string; basis: string; minutes?: number }[]; slots: { start: string; chair: number }[]; engineVersion: string }

const BASIS: Record<string, string> = { plan: 'Plan', finding: 'Photo observation', patient_report: 'Patient report', instruction: 'Doctor instruction', rule: 'Clinic rule', availability: 'Availability' };

export function RecommendationCard({ r, action, compact }: { r: Rec; action?: ReactNode; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-line overflow-hidden bg-surface">
      <div className="px-4 py-3.5 flex items-start justify-between gap-3 bg-raised border-b border-line">
        <div>
          <div className="label">Suggested visit · {r.engineVersion}</div>
          <div className="font-semibold text-ink mt-1">{r.label ?? VISIT_KIND_LABELS[r.kind]}</div>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5"><CalendarPlus className="h-4 w-4 text-ink-3" />{r.earliest === r.latest ? fmtDay(r.earliest) : `${fmtDate(r.earliest)} – ${fmtDate(r.latest)}`}</span>
            <span className="inline-flex items-center gap-1.5 num"><Clock className="h-4 w-4 text-ink-3" />{r.durationMin} min</span>
          </div>
        </div>
        <Pill tone={UNCERTAINTY_TONE[r.uncertainty]} size="sm">{titleCase(r.uncertainty)} uncertainty</Pill>
      </div>
      {!compact && (
        <ul className="px-4 py-3 space-y-2">
          {r.factors.map((f, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="text-2xs font-semibold uppercase tracking-wide text-ink-4 w-[92px] shrink-0 pt-0.5">{BASIS[f.basis] ?? f.basis}</span>
              <span className="text-ink-2 flex-1">{f.text}</span>
              {f.minutes != null && <span className="num text-xs text-ink-3 shrink-0">+{f.minutes}m</span>}
            </li>
          ))}
        </ul>
      )}
      {action && <div className="px-4 py-3 border-t border-line bg-raised">{action}</div>}
    </div>
  );
}

export function NoImage() { return <div className="h-full w-full grid place-items-center text-white/40"><ImageOff className="h-6 w-6" /></div>; }
