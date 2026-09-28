import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Stethoscope, CalendarClock, Camera } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo, LogoMark } from '../components/brand/Logo';
import { Button, Field } from '../components/ui';

const DEMO = [
  { email: 'amara.okafor@lumen-ortho.demo', who: 'Dr. Amara Okafor', role: 'Orthodontist · Clinic admin' },
  { email: 'leo.martins@lumen-ortho.demo', who: 'Leo Martins', role: 'Treatment coordinator' },
  { email: 'daniel.reyes@lumen-ortho.demo', who: 'Dr. Daniel Reyes', role: 'Orthodontist · Northgate only' },
  { email: 'admin@orthomonitoring.ai', who: 'Riya Kapoor', role: 'Super admin console' },
];

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent, override?: { email: string; password: string }) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await login(override?.email ?? email, override?.password ?? password);
      nav(me.role === 'platform_admin' ? '/admin' : loc.state?.from ?? '/app', { replace: true });
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-canvas">
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-navy text-white p-12">
        <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(232,89,12,0.28),transparent_65%)]" />
        <div className="absolute -left-24 bottom-[-180px] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(245,180,0,0.14),transparent_65%)]" />
        <Logo tone="light" size="md" />
        <div className="relative max-w-xl">
          <LogoMark size={56} className="text-white mb-8 opacity-90" />
          <h1 className="font-serif text-[52px] leading-[1.02] font-semibold tracking-tight">
            Guided check-ins that end in a <span className="bg-brand-gradient bg-clip-text text-transparent">clear decision</span>.
          </h1>
          <p className="mt-5 text-white/65 text-md max-w-lg leading-relaxed">
            Patients capture five guided photos in minutes. Your team sees quality-checked images, AI observations marked with their uncertainty, and an explained go/no-go for every aligner change. The decision stays with the doctor.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4 max-w-lg">
            {[
              { i: Camera, t: 'Guided capture', d: 'Framing, light and blur checks on device' },
              { i: Stethoscope, t: 'Explained go/no-go', d: 'Every check shown, every decision yours' },
              { i: CalendarClock, t: 'Smart visits', d: 'When to see them and how long to book' },
              { i: ShieldCheck, t: 'Private by design', d: 'Encrypted images, consent, full audit trail' },
            ].map((f) => (
              <div key={f.t} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <f.i className="h-5 w-5 text-amber-brand" strokeWidth={1.8} />
                <div className="mt-3 text-sm font-semibold text-white">{f.t}</div>
                <div className="text-xs text-white/55 mt-1">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-2xs text-white/40 max-w-md">AI observations are decision support for clinician review. They are not a diagnosis and have not been validated as a diagnostic device.</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden mb-10"><Logo size="md" /></div>
          <h2 className="display text-[30px]">Sign in</h2>
          <p className="text-ink-3 mt-1 mb-8">Clinic workspace and platform console</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Work email"><input className="input h-11" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.com" required /></Field>
            <Field label="Password"><input className="input h-11" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {error && <div className="text-sm text-urgent bg-urgent-soft rounded-lg px-3 py-2">{error}</div>}
            <Button variant="primary" size="lg" className="w-full" loading={busy} type="submit">Sign in <ArrowRight className="h-4 w-4" /></Button>
          </form>

          <div className="mt-10">
            <div className="label mb-3">Demo accounts · password Demo!2026</div>
            <div className="space-y-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => submit(undefined, { email: d.email, password: 'Demo!2026' })}
                  className="w-full card px-4 py-3 flex items-center justify-between text-left hover:border-ember/50 hover:shadow-pop transition group">
                  <span><span className="block text-sm font-medium">{d.who}</span><span className="block text-xs text-ink-3">{d.role}</span></span>
                  <ArrowRight className="h-4 w-4 text-ink-4 group-hover:text-ember transition" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
