import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api } from '../../lib/api';
import { Button, Card, PageHeader, Pill } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export function AdminSystem() {
  const { data: health } = useApi<any>('/admin/health');
  const { data: audit } = useApi<any[]>('/admin/audit');
  const [v, setV] = useState<any>(null);
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Operations" title="System & audit" />
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card className="!p-4"><div className="label">API</div><div className="mt-2"><Pill tone="stable">{health?.status}</Pill></div><div className="text-xs text-ink-3 mt-2">Node {health?.node}</div></Card>
        <Card className="!p-4"><div className="label">Stored images</div><div className="display text-3xl num mt-2">{health?.db.images}</div><div className="text-xs text-ink-3">encrypted at rest</div></Card>
        <Card className="!p-4"><div className="label">Webhooks pending</div><div className="display text-3xl num mt-2">{health?.webhooksPending}</div></Card>
        <Card className="!p-4"><div className="label">AI calls (24 h)</div><div className="text-sm mt-2 space-y-0.5">{(health?.aiLast24h ?? []).map((r: any, i: number) => <div key={i}>{r.provider}: {r.status} × {r.n}</div>)}{!health?.aiLast24h?.length && <span className="text-ink-3">none</span>}</div></Card>
      </div>
      <div className="flex items-center gap-3 mb-3"><div className="font-semibold">Platform audit log</div><Button size="sm" variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={async () => setV(await api('/admin/audit/verify'))}>Verify chain</Button>{v && <Pill tone={v.ok ? 'stable' : 'urgent'}>{v.ok ? `Intact · ${v.checked}` : `Broken at ${v.brokenAt}`}</Pill>}</div>
      <Card pad={false}><table className="w-full text-sm"><tbody className="divide-y divide-line">{(audit ?? []).map((a) => <tr key={a.id}><td className="px-5 py-2 text-xs text-ink-3 whitespace-nowrap">{fmtDateTime(a.createdAt)}</td><td className="px-5 py-2">{a.actorName ?? a.actorType}</td><td className="px-5 py-2 font-mono text-xs">{a.action}</td><td className="px-5 py-2 text-xs text-ink-3">{a.meta ? JSON.stringify(a.meta) : ''}</td></tr>)}</tbody></table></Card>
    </div>
  );
}
