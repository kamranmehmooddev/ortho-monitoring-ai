import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Field, Modal } from '../ui';
import { VISIT_KIND_LABELS } from '../../lib/clinical';
import { fmtDay, fmtTime, todayIso } from '../../lib/format';
import type { Rec } from '.';

/** Books a visit, starting from the engine's recommendation; date, time and duration all stay editable. */
export function BookingModal({ open, onClose, patientId, patientName, rec, onBooked }: { open: boolean; onClose: () => void; patientId: string; patientName: string; rec?: Rec | null; onBooked?: () => void }) {
  const [duration, setDuration] = useState(rec?.durationMin ?? 20);
  const [kind, setKind] = useState(rec?.kind ?? 'progress_review');
  const [from, setFrom] = useState(rec?.earliest ?? todayIso());
  const [slots, setSlots] = useState<{ start: string; chair: number }[]>([]);
  const [pick, setPick] = useState<{ start: string; chair: number } | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) { setDuration(rec?.durationMin ?? 20); setKind(rec?.kind ?? 'progress_review'); setFrom(rec?.earliest ?? todayIso()); setPick(null); setCustom(''); } }, [open, rec]);
  useEffect(() => {
    if (!open) return;
    api(`/slots?patientId=${patientId}&durationMin=${duration}&from=${from}`).then((s) => { setSlots(s); setPick(s[0] ?? null); }).catch(() => setSlots([]));
  }, [open, patientId, duration, from]);
  const edited = rec && (duration !== rec.durationMin || (pick && (pick.start.slice(0, 10) < rec.earliest || pick.start.slice(0, 10) > rec.latest)));
  const book = async () => {
    const startAt = custom || pick?.start;
    if (!startAt) return;
    setBusy(true);
    try {
      await api('/appointments', { body: { patientId, startAt, durationMin: duration, type: kind, chair: pick?.chair ?? 1, recommendationId: rec?.id } });
      toast.success('Visit booked', `${patientName} · ${fmtDay(startAt)} ${fmtTime(startAt)} · ${duration} min`); onBooked?.(); onClose();
    } catch (e) { toast.error('Booking failed', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Book visit · ${patientName}`} width="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!custom && !pick} onClick={book}>Book {duration} min</Button></>}>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Field label="Visit type"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(VISIT_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Chair time"><select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{[10, 15, 20, 25, 30, 35, 40, 45, 55, 60, 75, 90].map((m) => <option key={m} value={m}>{m} min{rec?.durationMin === m ? ' ★' : ''}</option>)}</select></Field>
        <Field label="Search from"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      </div>
      {rec && <p className="text-xs text-ink-3 mb-3">Suggested window {rec.earliest} – {rec.latest} · {rec.durationMin} min ({rec.uncertainty} uncertainty). ★ marks the suggested duration.</p>}
      <div className="label mb-2">Available slots with the treating doctor</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {slots.map((s) => (
          <button key={s.start + s.chair} onClick={() => { setPick(s); setCustom(''); }} className={clsx('rounded-lg border px-3 py-2 text-left transition', pick?.start === s.start && !custom ? 'border-ember bg-ember-soft' : 'border-line hover:border-line-strong')}>
            <div className="text-sm font-medium">{fmtDay(s.start)}</div><div className="text-xs text-ink-3 num">{fmtTime(s.start)} · chair {s.chair}</div>
          </button>
        ))}
        {!slots.length && <div className="col-span-3 text-sm text-ink-3">No free slots in the next 3 weeks. Enter a time manually.</div>}
      </div>
      <div className="mt-4"><Field label="Or a specific time"><input type="datetime-local" className="input" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field></div>
      {edited && <p className="text-2xs text-attention mt-3">This differs from the recommendation and will be recorded as an override for scheduling evaluation.</p>}
    </Modal>
  );
}
