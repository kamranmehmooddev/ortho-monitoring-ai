import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Send, Bot, Lock } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Avatar, Button, Card, Empty, PageHeader } from '../components/ui';
import { Thumb } from '../components/clinical';
import { ago, fmtDateTime } from '../lib/format';

export function Messages() {
  const { patientId } = useParams();
  const { data } = useApi<any[]>('/messages');
  const nav = useNavigate();
  const list = data ?? [];
  const active = patientId ?? list[0]?.patientId;
  const activeRow = list.find((l) => l.patientId === active);
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Secure messaging" title="Messages" subtitle="End-to-end audited conversations. Automated messages cover reminders, retakes and confirmations only. Clinical advice always comes from your team." />
      <Card pad={false} className="grid md:grid-cols-[320px_1fr] h-[calc(100vh-240px)] min-h-[520px] overflow-hidden">
        <ul className="border-r border-line overflow-y-auto scroll-thin">
          {list.map((c) => (
            <li key={c.patientId}>
              <button onClick={() => nav(`/app/messages/${c.patientId}`)} className={clsx('w-full text-left px-4 py-3 flex gap-3 border-b border-line transition', active === c.patientId ? 'bg-ember-soft/50' : 'hover:bg-raised')}>
                <Avatar name={c.patientName} hue={c.avatarHue} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium text-sm truncate">{c.patientName}</span><span className="text-2xs text-ink-3 shrink-0">{ago(c.lastAt)}</span></span>
                  <span className="flex items-center gap-2"><span className={clsx('text-xs truncate flex-1', c.unread ? 'text-ink font-medium' : 'text-ink-3')}>{c.lastSender === 'patient' ? '' : c.lastSender === 'system' ? 'Auto: ' : 'You: '}{c.lastMessage}</span>{c.unread > 0 && <span className="num h-5 min-w-5 px-1.5 rounded-full bg-ember text-white text-2xs grid place-items-center">{c.unread}</span>}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col min-h-0">{active ? <Thread key={active} patientId={active} title={activeRow?.patientName} /> : <Empty title="No conversations yet" />}</div>
      </Card>
    </div>
  );
}

export function Thread({ patientId, title, consent = true }: { patientId: string; title?: string; consent?: boolean }) {
  const { data, reload } = useApi<any[]>(`/patients/${patientId}/messages`, [patientId]);
  const { data: instructions } = useApi<any[]>('/instructions');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const { can } = useAuth();
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data]);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await api(`/patients/${patientId}/messages`, { body: { body } }); setBody(''); reload(); } catch (e) { toast.error('Not sent', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {title && <div className="px-5 py-3.5 border-b border-line flex items-center justify-between"><div className="font-semibold">{title}</div><span className="text-2xs text-ink-3 inline-flex items-center gap-1"><Lock className="h-3 w-3" />Encrypted · audited</span></div>}
      <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-3 bg-raised">
        {(data ?? []).map((m) => (
          <div key={m.id} className={clsx('flex', m.senderType === 'patient' ? 'justify-start' : 'justify-end')}>
            <div className={clsx('max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-card', m.senderType === 'patient' ? 'bg-surface border border-line rounded-bl-md' : m.senderType === 'system' ? 'bg-sunken text-ink-2 rounded-br-md border border-dashed border-line-strong' : 'bg-navy text-white rounded-br-md')}>
              <div className={clsx('text-2xs mb-1 flex items-center gap-1', m.senderType === 'staff' ? 'text-white/55' : 'text-ink-3')}>
                {m.senderType === 'system' && <Bot className="h-3 w-3" />}{m.senderType === 'patient' ? 'Patient' : m.senderType === 'system' ? `Automated · ${m.automatedRule?.replace(/_/g, ' ')}` : m.senderName} · {fmtDateTime(m.createdAt)}
              </div>
              <div className="whitespace-pre-line leading-relaxed">{m.body}</div>
              {m.imageIds.length > 0 && <div className="flex gap-1.5 mt-2">{m.imageIds.map((id: string) => <Thumb key={id} id={id} className="h-20 w-24" />)}</div>}
            </div>
          </div>
        ))}
        {data && !data.length && <Empty title="No messages yet" />}
        <div ref={end} />
      </div>
      {can('messages.send') && (consent ? (
        <div className="border-t border-line p-3 bg-surface">
          <div className="flex gap-2 mb-2 overflow-x-auto scroll-thin">{(instructions ?? []).slice(0, 6).map((i) => <button key={i.id} onClick={() => setBody(i.body)} className="shrink-0 text-2xs rounded-full border border-line px-2.5 py-1 text-ink-2 hover:border-ember/60">{i.title}</button>)}</div>
          <div className="flex gap-2 items-end">
            <textarea className="textarea text-sm" rows={2} placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
            <Button variant="primary" loading={busy} onClick={send} icon={<Send className="h-4 w-4" />}>Send</Button>
          </div>
        </div>
      ) : <div className="border-t border-line p-4 text-sm text-ink-3">The patient has not consented to secure messaging.</div>)}
    </>
  );
}
