import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Callout, Card, Empty, Field, Modal, PageHeader, Pill, Toggle } from '../../components/ui';
import { usd, pct } from '../../lib/format';

export function AdminAi() {
  const { data, reload } = useApi<any>('/admin/ai-providers');
  const { data: reg } = useApi<any>('/admin/model-registry');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ provider: 'anthropic', label: 'Platform Anthropic', model: 'claude-opus-5', apiKey: '', monthlyBudgetUsd: 500, perCallMaxUsd: 0.5, priority: 1 });
  return (
    <div className="animate-in">
      <PageHeader eyebrow="AI operations" title="Platform AI & model registry" subtitle="Platform keys are the fallback for clinics whose plan includes AI credits. Clinic BYO keys always take priority." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add platform key</Button>} />
      <Card pad={false} className="mb-6">
        <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Platform providers</div>
        {!data?.configs.length ? <Empty title="No platform providers">Clinics on Practice and higher plans have no platform fallback until a key is added.</Empty> :
          <ul className="divide-y divide-line">{data.configs.map((c: any) => <li key={c.id} className="px-5 py-3 flex items-center gap-4 text-sm"><div className="flex-1"><div className="font-medium">{c.label}</div><div className="text-xs text-ink-3">{c.provider} · {c.model} · ••••{c.keyLast4}</div></div><span className="text-xs text-ink-3">{usd(c.spendThisMonth)} / {usd(c.monthlyBudgetUsd)}</span><Toggle checked={c.enabled} onChange={async (v) => { await api(`/admin/ai-providers/${c.id}`, { method: 'PATCH', body: { enabled: v } }); reload(); }} /></li>)}</ul>}
      </Card>
      <Card pad={false} className="mb-6">
        <div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Versioned services</div>
        <table className="w-full text-sm"><tbody className="divide-y divide-line">{(reg?.versions ?? []).map((v: any) => <tr key={v.version}><td className="px-5 py-2.5 font-medium capitalize">{v.service}</td><td className="px-5 py-2.5 font-mono text-xs">{v.version}</td><td className="px-5 py-2.5 text-ink-3">{v.kind}</td><td className="px-5 py-2.5"><Pill size="sm" tone="stable" icon={false}>{v.status}</Pill></td></tr>)}</tbody></table>
      </Card>
      <Callout tone="attention" title="Validation status: not validated">{reg?.disclaimer}</Callout>
      {reg?.stats?.length > 0 && <Card pad={false} className="mt-6"><div className="px-5 pt-4 pb-3 font-semibold border-b border-line">Cross-clinic review outcomes (90 days)</div><table className="w-full text-sm"><tbody className="divide-y divide-line">{reg.stats.map((s: any, i: number) => <tr key={i}><td className="px-5 py-2 text-xs">{s.modelVersion}</td><td className="px-5 py-2">{s.category}</td><td className="px-5 py-2 num">{s.reviewed} reviewed</td><td className="px-5 py-2 num">false alerts {pct(s.falseAlertRate)}</td><td className="px-5 py-2 num">missed {s.missed}</td></tr>)}</tbody></table></Card>}
      <Modal open={open} onClose={() => setOpen(false)} title="Add platform AI provider" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => { try { await api('/admin/ai-providers', { body: f }); setOpen(false); reload(); toast.success('Platform provider added'); } catch (e) { toast.error('Not added', (e as Error).message); } }}>Save encrypted</Button></>}>
        <div className="space-y-4">
          <Field label="Provider"><select className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>{(data?.adapters ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Label"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field><Field label="Model"><input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field></div>
          {f.provider === 'openai_compatible' && <Field label="Endpoint"><input className="input" value={f.endpoint ?? ''} onChange={(e) => setF({ ...f, endpoint: e.target.value })} /></Field>}
          <Field label="API key"><input type="password" className="input font-mono" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Monthly budget $"><input type="number" className="input" value={f.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: Number(e.target.value) })} /></Field><Field label="Max per call $"><input type="number" step="0.05" className="input" value={f.perCallMaxUsd} onChange={(e) => setF({ ...f, perCallMaxUsd: Number(e.target.value) })} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}
