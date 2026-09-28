import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCheck, BrainCircuit, CircleSlash } from 'lucide-react';
import { useApi, useKey } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Empty, Kbd, Modal, PageHeader, Pill, Segmented } from '../components/ui';
import { GoNoGoPill, PatientCell, Thumb } from '../components/clinical';
import { PriorityBar } from './Today';
import { VIEW_LABELS } from '../lib/clinical';

export function ReviewQueue() {
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'all';
  const { data, reload } = useApi<any>(`/review-queue?filter=${filter}`, [filter]);
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [cursor, setCursor] = useState(0);
  const [batchOpen, setBatchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = data?.items ?? [];
  const eligible = useMemo(() => items.filter((i: any) => i.gonogo?.batchEligible), [items]);

  useKey('j', useCallback(() => setCursor((c) => Math.min(items.length - 1, c + 1)), [items.length]));
  useKey('k', useCallback(() => setCursor((c) => Math.max(0, c - 1)), []));
  useKey('Enter', useCallback(() => items[cursor] && nav(`/app/review/${items[cursor].checkinId}`), [items, cursor, nav]));

  const runBatch = async () => {
    setBusy(true);
    try {
      const r = await api('/review-queue/batch-go', { body: { checkinIds: eligible.map((e: any) => e.checkinId) } });
      for (const id of r.eligible) await api(`/checkins/${id}/decision`, { body: { type: 'go' } });
      toast.success(`Approved ${r.eligible.length} aligner change${r.eligible.length === 1 ? '' : 's'}`, r.skipped.length ? `${r.skipped.length} skipped: no longer eligible` : 'Patients have been notified.');
      setBatchOpen(false); reload();
    } catch (e) { toast.error('Batch approval failed', (e as Error).message); } finally { setBusy(false); }
  };

  const c = data?.counts ?? {};
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Clinical review" title="Review queue" subtitle="Sorted by clinical priority: urgent reports, possible tracking loss and attachment concerns first, then how long each check-in has waited."
        actions={can('clinical.decide') && <Button variant="ember" disabled={!eligible.length} onClick={() => setBatchOpen(true)} icon={<CheckCheck className="h-4 w-4" />}>Batch Go ({eligible.length})</Button>} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented value={filter} onChange={(v) => { setParams(v === 'all' ? {} : { filter: v }); setCursor(0); }} options={[
          { value: 'all', label: 'All', count: c.all }, { value: 'urgent', label: 'Urgent', count: c.urgent }, { value: 'tracking', label: 'Tracking', count: c.tracking },
          { value: 'attachments', label: 'Attachments', count: c.attachments }, { value: 'ready', label: 'Ready to advance', count: c.ready }, { value: 'mine', label: 'My patients', count: c.mine },
        ]} />
        <div className="hidden md:flex items-center gap-1.5 text-xs text-ink-3"><Kbd>J</Kbd><Kbd>K</Kbd> move · <Kbd>↵</Kbd> open</div>
      </div>

      <Card pad={false}>
        {items.length === 0 ? <Empty icon={<CheckCheck className="h-5 w-5" />} title="Nothing here">No check-ins match this filter.</Empty> : (
          <ul className="divide-y divide-line">
            {items.map((i: any, idx: number) => (
              <li key={i.checkinId} onClick={() => nav(`/app/review/${i.checkinId}`)} onMouseEnter={() => setCursor(idx)}
                className={clsx('px-5 py-4 grid grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.4fr)_auto] items-center gap-5 cursor-pointer transition', idx === cursor ? 'bg-raised' : 'hover:bg-raised')}>
                <PriorityBar score={i.priority} />
                <div className="min-w-0">
                  <PatientCell id={i.patientId} name={i.patientName} hue={i.avatarHue} sub={`Aligner ${i.stageNo ?? '—'} · waiting ${i.waitingHours} h`} />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {i.reasons.slice(0, 3).map((r: string) => <Pill key={r} size="sm" tone={/P1|P2|gap|damage/i.test(r) ? 'urgent' : /attachment|wear|retake|Pain/i.test(r) ? 'attention' : 'neutral'} icon={false}>{r}</Pill>)}
                    {!i.reasons.length && <Pill size="sm" tone="stable" icon={false}>Routine</Pill>}
                  </div>
                </div>
                <div className="hidden md:flex gap-1.5">
                  {i.thumbs.map((t: any) => <Thumb key={t.id} id={t.id} quality={t.quality_status} className="h-14 w-[74px]" label={VIEW_LABELS[t.view]?.split(' ')[0]} />)}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <GoNoGoPill rec={i.gonogo?.recommendation} confidence={i.gonogo?.confidence} />
                  <span className="text-2xs text-ink-3 inline-flex items-center gap-1">
                    {i.aiStatus?.status === 'completed' ? <><BrainCircuit className="h-3 w-3" />{i.findings.length} observation{i.findings.length === 1 ? '' : 's'}</> : <><CircleSlash className="h-3 w-3" />AI {i.aiStatus?.status?.replace('_', ' ') ?? 'pending'}</>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="Approve next aligner for eligible patients"
        footer={<><Button variant="ghost" onClick={() => setBatchOpen(false)}>Cancel</Button><Button variant="ember" loading={busy} onClick={runBatch}>Approve {eligible.length}</Button></>}>
        <p className="text-sm text-ink-2 mb-4">These check-ins passed <strong>every</strong> go/no-go check with high confidence and have no open observations. Each approval is recorded as your decision in the audit trail.</p>
        <ul className="space-y-2">{eligible.map((e: any) => <li key={e.checkinId} className="flex items-center justify-between rounded-lg border border-line px-3 py-2"><span className="text-sm font-medium">{e.patientName}</span><span className="text-sm text-ink-3 num">Aligner {e.stageNo} → {e.stageNo + 1}</span></li>)}</ul>
      </Modal>
    </div>
  );
}
