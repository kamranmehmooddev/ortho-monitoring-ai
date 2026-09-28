import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Check, ImagePlus } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { Button, Field } from '../components/ui';

const Q = [
  { k: 'concern', q: 'What would you most like to change?', o: ['Crowding', 'Gaps', 'Overbite', 'Underbite', 'Crossbite', 'Not sure'] },
  { k: 'age', q: 'Your age range', o: ['Under 18', '18-24', '25-34', '35-44', '45+'] },
  { k: 'previousTreatment', q: 'Have you had orthodontic treatment before?', o: ['No', 'Braces as a teen', 'Aligners before'] },
  { k: 'preference', q: 'Preferred treatment', o: ['Clear aligners', 'Braces', 'No preference'] },
  { k: 'timeline', q: 'When would you like to start?', o: ['As soon as possible', 'Within 3 months', 'Just researching'] },
];

/** Public lead funnel. Deliberately gives no automated clinical opinion; the clinic follows up. */
export function SmileAssessment() {
  const { slug } = useParams();
  const [clinic, setClinic] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [c, setC] = useState({ name: '', email: '', phone: '', consent: false, marketing: false });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch(`/api/v1/public/clinics/${slug}`).then((r) => r.json()).then(setClinic).catch(() => {}); }, [slug]);
  const accent = clinic?.branding?.accent ?? '#E8590C';
  const submit = async () => {
    const fd = new FormData();
    fd.set('name', c.name); if (c.email) fd.set('email', c.email); if (c.phone) fd.set('phone', c.phone);
    fd.set('answers', JSON.stringify(answers)); fd.set('consentContact', String(c.consent)); fd.set('consentMarketing', String(c.marketing));
    files.forEach((f) => fd.append('photos', f));
    const r = await fetch(`/api/v1/public/smile/${slug}`, { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) setErr(j.error?.message ?? 'Something went wrong'); else setDone(j.message);
  };
  return (
    <div className="min-h-screen bg-canvas">
      <header className="max-w-3xl mx-auto px-6 pt-8 flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="h-9 w-9 rounded-lg grid place-items-center text-white font-serif font-bold" style={{ background: accent }}>{clinic?.branding?.logoText}</span><span className="font-semibold">{clinic?.name}</span></div><span className="text-2xs text-ink-4 inline-flex items-center gap-1.5">powered by <Logo size="sm" /></span></header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        {done ? <div className="card p-10 text-center"><div className="mx-auto h-14 w-14 rounded-full grid place-items-center text-white mb-4" style={{ background: accent }}><Check className="h-7 w-7" /></div><h1 className="display text-3xl">Thank you!</h1><p className="text-ink-3 mt-2">{done}</p></div> : <>
          <h1 className="display text-[44px] leading-tight">Free smile assessment</h1>
          <p className="text-ink-3 mt-2 max-w-xl">Answer a few questions and share up to three smile photos. A member of our clinical team will review them and get in touch. This is not a diagnosis.</p>
          <div className="space-y-8 mt-10">
            {Q.map((q) => <div key={q.k}><div className="font-medium mb-3">{q.q}</div><div className="flex flex-wrap gap-2">{q.o.map((o) => <button key={o} onClick={() => setAnswers({ ...answers, [q.k]: o })} className={clsx('h-10 px-4 rounded-full border text-sm transition', answers[q.k] === o ? 'text-white border-transparent' : 'border-line-strong bg-surface hover:border-ink-4')} style={answers[q.k] === o ? { background: accent } : undefined}>{o}</button>)}</div></div>)}
            <div><div className="font-medium mb-3">Smile photos (optional)</div><label className="card flex items-center gap-3 p-5 cursor-pointer border-dashed hover:border-ink-4"><ImagePlus className="h-6 w-6 text-ink-3" /><span className="text-sm text-ink-2">{files.length ? `${files.length} photo(s) selected` : 'Front smile, left and right side'}</span><input type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} /></label></div>
            <div className="grid sm:grid-cols-3 gap-4"><Field label="Name"><input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field><Field label="Email"><input className="input" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field><Field label="Phone"><input className="input" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field></div>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={c.consent} onChange={(e) => setC({ ...c, consent: e.target.checked })} />I agree that {clinic?.name} can store my answers and photos and contact me about my enquiry.</label>
            <label className="flex gap-2 text-sm text-ink-3"><input type="checkbox" checked={c.marketing} onChange={(e) => setC({ ...c, marketing: e.target.checked })} />Send me occasional news and offers (optional).</label>
            {err && <div className="text-sm text-urgent">{err}</div>}
            <Button size="lg" variant="primary" disabled={!c.name || !c.consent || (!c.email && !c.phone)} onClick={submit} style={{ background: accent }}>Send to the clinic</Button>
          </div>
        </>}
      </main>
    </div>
  );
}
