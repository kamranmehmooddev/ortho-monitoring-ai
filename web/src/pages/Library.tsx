import { useState } from 'react';
import { Plus, Trash2, BookOpen, MessageSquareQuote, Workflow } from 'lucide-react';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Card, Field, Modal, PageHeader, Pill, Tabs, Toggle } from '../components/ui';
import { VIEW_LABELS } from '../lib/clinical';

export function Library() {
  const [tab, setTab] = useState<'instructions' | 'education' | 'protocols'>('instructions');
  const { data: instr, reload: ri } = useApi<any[]>('/instructions');
  const { data: edu, reload: re } = useApi<any[]>('/education');
  const { data: protocols } = useApi<any[]>('/protocols');
  const { can } = useAuth();
  const toast = useToast();
  const [modal, setModal] = useState<'instruction' | 'education' | null>(null);
  const [form, setForm] = useState<any>({});
  const save = async () => {
    try {
      if (modal === 'instruction') { await api('/instructions', { body: { title: form.title, body: form.body, category: form.category || 'General', requiresDoctor: form.requiresDoctor ?? true } }); ri(); }
      else { await api('/education', { body: { title: form.title, summary: form.summary, body: form.body, category: form.category || 'General' } }); re(); }
      setModal(null); setForm({}); toast.success('Saved to library');
    } catch (e) { toast.error('Not saved', (e as Error).message); }
  };
  return (
    <div className="animate-in">
      <PageHeader eyebrow="Clinic library" title="Library" subtitle="Reusable instructions for decisions and messages, clinic-approved patient education, and monitoring protocols by case type." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'instructions', label: 'Instructions', count: instr?.length }, { value: 'education', label: 'Patient education', count: edu?.length }, { value: 'protocols', label: 'Protocols', count: protocols?.length }]} />
      {tab === 'instructions' && <>
        {can('library.manage') && <div className="mb-4"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('instruction')}>New instruction</Button></div>}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{(instr ?? []).map((i) => (
          <Card key={i.id}><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><MessageSquareQuote className="h-4 w-4 text-ink-3" /><span className="font-medium">{i.title}</span></div>{can('library.manage') && <button className="text-ink-4 hover:text-urgent" onClick={async () => { await api(`/instructions/${i.id}`, { method: 'DELETE' }); ri(); }}><Trash2 className="h-4 w-4" /></button>}</div>
            <p className="text-sm text-ink-2 mt-2">{i.body}</p><div className="flex gap-1.5 mt-3"><Pill size="sm" icon={false}>{i.category}</Pill>{i.requiresDoctor ? <Pill size="sm" tone="info" icon={false}>Doctor approval</Pill> : <Pill size="sm" tone="stable" icon={false}>Any staff</Pill>}</div></Card>
        ))}</div>
      </>}
      {tab === 'education' && <>
        {can('clinical.decide') && <div className="mb-4"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setModal('education')}>New article</Button></div>}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{(edu ?? []).map((e) => (
          <Card key={e.id}><div className="flex items-center gap-2 text-2xs text-ink-3 uppercase tracking-wide font-semibold"><BookOpen className="h-3.5 w-3.5" />{e.category} · {e.readMinutes} min</div><div className="display text-xl mt-2">{e.title}</div><p className="text-sm text-ink-3 mt-1">{e.summary}</p><p className="text-sm text-ink-2 mt-3 line-clamp-4 whitespace-pre-line">{e.body.replace(/[#*-]/g, '')}</p><div className="text-2xs text-ink-4 mt-3">Approved by {e.approvedBy ?? 'clinic'} · {e.published ? 'Published to app' : 'Draft'}</div></Card>
        ))}</div>
      </>}
      {tab === 'protocols' && (
        <div className="grid md:grid-cols-2 gap-4">{(protocols ?? []).map((p) => (
          <Card key={p.id}><div className="flex items-center gap-2"><Workflow className="h-4 w-4 text-ink-3" /><span className="font-semibold">{p.name}</span><span className="ml-auto text-xs text-ink-3">{p.patients} active</span></div>
            <p className="text-sm text-ink-3 mt-1.5">{p.description}</p>
            <div className="grid grid-cols-3 gap-3 mt-4 text-sm"><div><div className="text-2xs text-ink-3">Check-in every</div><div className="font-semibold num">{p.intervalDays} days</div></div><div><div className="text-2xs text-ink-3">Min wear</div><div className="font-semibold num">{p.criteria.minWearHours} h</div></div><div><div className="text-2xs text-ink-3">Grace</div><div className="font-semibold num">{p.graceHours} h</div></div></div>
            <div className="flex flex-wrap gap-1 mt-3">{p.requiredViews.map((v: any, i: number) => <Pill key={i} size="sm" icon={false}>{VIEW_LABELS[v.view]}{v.with_aligner ? ' · in' : ' · out'}</Pill>)}</div></Card>
        ))}</div>
      )}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'instruction' ? 'New reusable instruction' : 'New education article'} footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Title"><input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Category"><input className="input" value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Tracking, Attachments, Hygiene…" /></Field>
          {modal === 'education' && <Field label="Summary"><input className="input" value={form.summary ?? ''} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>}
          <Field label={modal === 'instruction' ? 'Message to patient' : 'Article (Markdown)'}><textarea className="textarea" rows={6} value={form.body ?? ''} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          {modal === 'instruction' && <Toggle checked={form.requiresDoctor ?? true} onChange={(v) => setForm({ ...form, requiresDoctor: v })} label="Clinical: requires doctor approval" />}
          {modal === 'education' && <p className="text-xs text-ink-3">Publishing records you as the approving clinician.</p>}
        </div>
      </Modal>
    </div>
  );
}
