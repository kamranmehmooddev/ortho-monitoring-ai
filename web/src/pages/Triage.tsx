import { useState } from 'react';
import clsx from 'clsx';
import { Phone, MessageSquare, UserCheck, ArrowUpCircle, CheckCircle2, RotateCcw, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Callout, Card, Empty, Modal, PageHeader, Pill, Segmented } from '../components/ui';
import { PatientCell, Thumb } from '../components/clinical';
import { URGENCY_TONE } from '../lib/clinical';
import { ago, until } from '../lib/format';

export function Triage() {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const { data, reload } = useApi<any[]>(`/triage${show === 'all' ? '?resolved=1' : ''}`, [show]);
  const { can } = useAuth();
  const toast = useToast();
  const [resolving, setResolving] = useState<any>(null);
  const [resolution, setResolution] = useState('');
  const act = async (id: string, action: string, extra: object = {}) => {
    try { await api(`/triage/${id}`, { body: { action, ...extra } }); reload(); } catch (e) { toast.error('Action failed', (e as Error).message); }
  };
  const lanes = ['P1', 'P2', 'P3', 'P4'];
  const items = data ?? [];

  return (
    <div className="animate-in">
      <PageHeader eyebrow="Staff queue" title="Triage" subtitle="Patient reports are ranked by urgency with SLA timers. Triage never books an appointment by itself. Staff decide what happens next."
        actions={<Segmented value={show} onChange={setShow} options={[{ value: 'open', label: 'Open', count: items.filter((i) => i.status !== 'resolved').length }, { value: 'all', label: 'Include resolved' }]} />} />
      <div className="mb-6"><Callout tone="attention" title="Emergency guidance">P1 reports show patients emergency guidance straight away (swallowed or inhaled parts, swelling, bleeding that won't stop). Call the patient within the SLA.</Callout></div>
      <div className="grid lg:grid-cols-2 2xl:grid-cols-4 gap-5 items-start">
        {lanes.map((lane) => {
          const laneItems = items.filter((i) => i.urgency === lane);
          return (
            <div key={lane}>
              <div className="flex items-center gap-2 mb-3"><Pill tone={URGENCY_TONE[lane]}>{lane}</Pill><span className="text-sm text-ink-3">{{ P1: '15 min', P2: '4 hours', P3: 'Next business day', P4: '3 business days' }[lane]}</span><span className="ml-auto num text-xs text-ink-3">{laneItems.length}</span></div>
              <div className="space-y-3">
                {laneItems.length === 0 && <div className="rounded-xl border border-dashed border-line-strong py-8 text-center text-sm text-ink-4">Clear</div>}
                {laneItems.map((i) => {
                  const overdue = i.status !== 'resolved' && i.slaDueAt < new Date().toISOString();
                  return (
                    <Card key={i.id} className={clsx('!p-4', i.status === 'resolved' && 'opacity-60', overdue && 'border-urgent/50')}>
                      <div className="flex items-start justify-between gap-2">
                        <PatientCell id={i.patientId} name={i.patientName} hue={i.avatarHue} size={32} sub={ago(i.createdAt)} />
                        <span className={clsx('text-2xs font-medium inline-flex items-center gap-1 rounded-full px-2 py-1', overdue ? 'bg-urgent-soft text-urgent' : 'bg-sunken text-ink-3')}><Timer className="h-3 w-3" />{i.status === 'resolved' ? 'resolved' : until(i.slaDueAt)}</span>
                      </div>
                      <div className="mt-3 font-medium text-sm">{i.label}{i.painLevel ? <span className="text-ink-3 font-normal"> · pain {i.painLevel}/10</span> : null}</div>
                      {i.details && <p className="text-sm text-ink-2 mt-1">“{i.details}”</p>}
                      <div className="flex flex-wrap gap-1 mt-2">{i.reasons.map((r: string) => <Pill key={r} size="sm" tone="neutral" icon={false}>{r}</Pill>)}</div>
                      {i.images.length > 0 && <div className="flex gap-1.5 mt-3">{i.images.map((id: string) => <Thumb key={id} id={id} className="h-16 w-20" />)}</div>}
                      <div className="text-2xs text-ink-3 mt-3">{i.status === 'resolved' ? `Resolved: ${i.resolution ?? ''}` : i.assignee ? `Assigned to ${i.assignee}` : 'Unassigned'} · {i.status}</div>
                      {can('triage.manage') && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-line">
                          {i.status !== 'resolved' ? <>
                            {i.phone && <a href={`tel:${i.phone}`}><Button size="sm" variant="subtle" icon={<Phone className="h-3.5 w-3.5" />}>Call</Button></a>}
                            <Link to={`/app/messages/${i.patientId}`}><Button size="sm" variant="subtle" icon={<MessageSquare className="h-3.5 w-3.5" />}>Message</Button></Link>
                            {!i.assignee && <Button size="sm" variant="ghost" icon={<UserCheck className="h-3.5 w-3.5" />} onClick={() => act(i.id, 'assign_me')}>Take</Button>}
                            {i.urgency !== 'P1' && <Button size="sm" variant="ghost" icon={<ArrowUpCircle className="h-3.5 w-3.5" />} onClick={() => act(i.id, 'escalate')}>Escalate</Button>}
                            <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => { setResolving(i); setResolution(''); }}>Resolve</Button>
                          </> : <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => act(i.id, 'reopen')}>Reopen</Button>}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!items.length && data && <Card><Empty title="No reports">Nothing needs triage right now.</Empty></Card>}
      <Modal open={!!resolving} onClose={() => setResolving(null)} title={`Resolve: ${resolving?.label ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setResolving(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await act(resolving.id, 'resolve', { resolution }); setResolving(null); toast.success('Report resolved'); }}>Resolve</Button></>}>
        <textarea className="textarea" rows={4} placeholder="What was done? e.g. called patient, replacement aligner ordered, booked repair visit" value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Modal>
    </div>
  );
}
