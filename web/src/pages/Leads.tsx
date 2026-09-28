import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Empty, PageHeader, Pill } from '../components/ui';
import { Thumb } from '../components/clinical';
import { ago } from '../lib/format';

const STATUS = ['new', 'contacted', 'consult_booked', 'converted', 'closed'];
export function Leads() {
  const { data, reload } = useApi<any[]>('/leads');
  const { me } = useAuth();
  const url = `${location.origin}/s/${me?.tenant?.slug}`;
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Growth" title="Smile assessment leads" subtitle="Prospective patients who used your public smile assessment. They get no automated clinical opinion; your team follows up."
        actions={<a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm link">Open public page <ExternalLink className="h-3.5 w-3.5" /></a>} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        {(data ?? []).map((l) => (
          <Card key={l.id}>
            <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{l.name}</div><div className="text-xs text-ink-3">{l.email ?? l.phone} · {ago(l.createdAt)}</div></div><Pill size="sm" tone={l.status === 'new' ? 'ember' : l.status === 'converted' ? 'stable' : 'neutral'} icon={false}>{l.status.replace('_', ' ')}</Pill></div>
            <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-sm">{Object.entries(l.answers).map(([k, v]) => <Fragment key={k}><dt className="text-ink-3 capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt><dd className="text-ink-2">{String(v)}</dd></Fragment>)}</dl>
            {l.imageIds.length > 0 && <div className="flex gap-1.5 mt-3">{l.imageIds.map((id: string) => <Thumb key={id} id={id} className="h-16 w-20" />)}</div>}
            <select className="input h-9 mt-4 text-sm" value={l.status} onChange={async (e) => { await api(`/leads/${l.id}`, { method: 'PATCH', body: { status: e.target.value } }); reload(); }}>{STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          </Card>
        ))}
      </div>
      {data && !data.length && <Card><Empty title="No leads yet">Share your smile assessment link on your website.</Empty></Card>}
    </div>
  );
}
