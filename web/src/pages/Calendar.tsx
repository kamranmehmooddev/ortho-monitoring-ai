import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, CalendarPlus, X } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Empty, PageHeader, Pill } from '../components/ui';
import { PatientCell, RecommendationCard, type Rec } from '../components/clinical';
import { BookingModal } from '../components/clinical/BookingModal';
import { VISIT_KIND_LABELS } from '../lib/clinical';
import { addDaysIso, fmtTime, todayIso } from '../lib/format';

const START_H = 8, END_H = 18, PX = 92; // px per hour
const KIND_CLS: Record<string, string> = {
  ipr: 'bg-info-soft border-info/40 text-info', tracking_assessment: 'bg-urgent-soft border-urgent/40 text-urgent', attachment_replacement: 'bg-attention-soft border-attention/40 text-attention',
  repair: 'bg-urgent-soft border-urgent/40 text-urgent', debond: 'bg-uncertain-soft border-uncertain/40 text-uncertain', refinement_scan: 'bg-uncertain-soft border-uncertain/40 text-uncertain', progress_review: 'bg-stable-soft border-stable/40 text-stable',
};

function monday(d: string) { const x = new Date(`${d}T00:00:00Z`); const wd = (x.getUTCDay() + 6) % 7; return addDaysIso(d, -wd); }

export function Calendar() {
  const [week, setWeek] = useState(monday(todayIso()));
  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDaysIso(week, i)), [week]);
  const { data: appts, reload } = useApi<any[]>(`/appointments?from=${week}&to=${addDaysIso(week, 7)}`, [week]);
  const { data: recs, reload: reloadRecs } = useApi<any[]>('/recommendations');
  const { data: avail } = useApi<any[]>('/availability');
  const [booking, setBooking] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const { can } = useAuth();
  const toast = useToast();
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);

  const setStatus = async (id: string, status: string) => { await api(`/appointments/${id}`, { method: 'PATCH', body: { status } }); setSelected(null); reload(); toast.success(`Appointment ${status.replace('_', ' ')}`); };
  const dismiss = async (id: string) => { await api(`/recommendations/${id}`, { body: { action: 'dismiss' } }); reloadRecs(); };

  return (
    <div className="animate-in">
      <PageHeader eyebrow="Scheduling" title="Calendar" subtitle="Suggested visits show when to see each patient, how much chair time to reserve, and why. Drop them into a free slot or override the date and duration."
        actions={<div className="flex items-center gap-1.5"><Button variant="secondary" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setWeek(addDaysIso(week, -7))} /><Button variant="secondary" size="sm" onClick={() => setWeek(monday(todayIso()))}>This week</Button><Button variant="secondary" size="sm" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setWeek(addDaysIso(week, 7))} /></div>} />
      <div className="grid 2xl:grid-cols-[1fr_380px] gap-6 items-start">
        <Card pad={false} className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(5, 1fr)` }}>
              <div />
              {days.map((d) => { const dt = new Date(`${d}T00:00:00Z`); const isToday = d === todayIso(); return (
                <div key={d} className="px-3 py-3 border-l border-line"><div className="text-2xs uppercase tracking-wide text-ink-3">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</div><div className={clsx('display text-xl num', isToday && 'text-ember-ink')}>{dt.getUTCDate()}</div></div>
              ); })}
            </div>
            <div className="grid relative" style={{ gridTemplateColumns: `56px repeat(5, 1fr)` }}>
              <div>{hours.map((h) => <div key={h} className="text-2xs text-ink-4 text-right pr-2 -translate-y-1.5" style={{ height: PX }}>{String(h).padStart(2, '0')}:00</div>)}</div>
              {days.map((d) => {
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                const windows = (avail ?? []).filter((a) => a.weekday === wd);
                return (
                  <div key={d} className="relative border-l border-line" style={{ height: hours.length * PX }}>
                    {hours.map((h) => <div key={h} className="border-b border-line/60" style={{ height: PX }} />)}
                    {windows.length === 0 && <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(var(--line)/0.5)_6px,rgb(var(--line)/0.5)_7px)]" />}
                    {(appts ?? []).filter((a) => a.startAt.startsWith(d)).map((a) => {
                      const [hh, mm] = a.startAt.slice(11, 16).split(':').map(Number);
                      const top = ((hh - START_H) + mm / 60) * PX, h = Math.max(22, (a.durationMin / 60) * PX - 3);
                      return (
                        <button key={a.id} onClick={() => setSelected(a)} className={clsx('absolute left-1 right-1 rounded-md border px-2 py-1 text-left overflow-hidden transition hover:shadow-pop', KIND_CLS[a.type] ?? 'bg-sunken border-line', a.status === 'requested' && 'border-dashed', a.status === 'completed' && 'opacity-50')} style={{ top, height: h }}>
                          <div className="text-[11px] font-semibold text-ink truncate">{a.patientName}{h <= 40 && <span className="font-normal opacity-80"> · {fmtTime(a.startAt)} · {a.typeLabel}</span>}</div>
                          {h > 40 && <div className="text-[10px] truncate">{fmtTime(a.startAt)} · {a.typeLabel} · {a.durationMin}m</div>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between"><div className="font-semibold">Suggested visits</div><span className="num text-xs text-ink-3">{recs?.length ?? 0}</span></div>
          {(recs ?? []).length === 0 && <Card><Empty title="No suggestions">Nothing requires a visit right now.</Empty></Card>}
          {(recs ?? []).map((r: Rec & { patientId: string; patientName: string; avatarHue: number }) => (
            <div key={r.id}>
              <div className="mb-1.5 flex items-center justify-between"><PatientCell id={r.patientId} name={r.patientName} hue={r.avatarHue} size={28} /></div>
              <RecommendationCard r={r} action={can('appointments.book') && <div className="flex gap-2"><Button size="sm" variant="primary" icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setBooking(r)}>Book</Button><Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => dismiss(r.id)}>Dismiss</Button></div>} />
            </div>
          ))}
        </div>
      </div>
      {booking && <BookingModal open={!!booking} onClose={() => setBooking(null)} patientId={booking.patientId} patientName={booking.patientName} rec={booking} onBooked={() => { reload(); reloadRecs(); }} />}
      {selected && (
        <div className="fixed inset-0 z-40 bg-navy-900/30" onClick={() => setSelected(null)}>
          <div className="absolute right-4 top-20 w-[340px] card shadow-pop p-5 animate-in" onClick={(e) => e.stopPropagation()}>
            <PatientCell id={selected.patientId} name={selected.patientName} hue={selected.avatarHue} sub={selected.doctor} />
            <div className="mt-4 text-sm space-y-1.5"><div><span className="text-ink-3">When</span> · {selected.startAt.replace('T', ' ')} ({selected.durationMin} min)</div><div><span className="text-ink-3">Type</span> · {VISIT_KIND_LABELS[selected.type] ?? selected.type}</div><div><span className="text-ink-3">Chair</span> · {selected.chair}</div>{selected.notes && <div className="text-ink-3">{selected.notes}</div>}<Pill size="sm" icon={false}>{selected.status}</Pill></div>
            {can('appointments.book') && <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line"><Button size="sm" variant="primary" onClick={() => setStatus(selected.id, 'completed')}>Mark completed</Button><Button size="sm" variant="secondary" onClick={() => setStatus(selected.id, 'no_show')}>No-show</Button><Button size="sm" variant="ghost" onClick={() => setStatus(selected.id, 'cancelled')}>Cancel</Button></div>}
          </div>
        </div>
      )}
    </div>
  );
}
