import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { LayoutDashboard, ClipboardCheck, Siren, Users, CalendarDays, MessageSquare, Sparkles, BookOpen, FlaskConical, Settings, LogOut, Moon, Sun, Search, Menu, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { toggleTheme } from '../../lib/theme';
import { Logo } from '../brand/Logo';
import { Avatar, Kbd } from '../ui';

interface Counts { awaitingReview: number; triageOpen: number; urgentOpen: number }

export function AppShell() {
  const { me, logout, can } = useAuth();
  const nav = useNavigate();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = () => api('/dashboard').then((d) => setCounts(d.kpis)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const items: { to: string; label: string; icon: typeof Users; badge?: ReactNode; show?: boolean }[] = [
    { to: '/app', label: 'Today', icon: LayoutDashboard },
    { to: '/app/review', label: 'Review queue', icon: ClipboardCheck, badge: counts?.awaitingReview ? <Badge n={counts.awaitingReview} /> : null },
    { to: '/app/triage', label: 'Triage', icon: Siren, badge: counts?.triageOpen ? <Badge n={counts.triageOpen} urgent={!!counts.urgentOpen} /> : null },
    { to: '/app/patients', label: 'Patients', icon: Users },
    { to: '/app/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/app/messages', label: 'Messages', icon: MessageSquare },
    { to: '/app/leads', label: 'Leads', icon: Sparkles, show: can('leads.manage') },
    { to: '/app/library', label: 'Library', icon: BookOpen },
    { to: '/app/evaluation', label: 'AI evaluation', icon: FlaskConical, show: can('evaluation.view') },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ];

  const sidebar = (
    <aside className="flex h-full w-[248px] flex-col bg-navy text-white/80">
      <div className="px-5 pt-5 pb-6 flex items-center justify-between">
        <Logo tone="light" size="sm" />
        <button className="lg:hidden text-white/60" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      <div className="px-3 mb-4">
        <div className="rounded-lg bg-white/[0.06] border border-white/10 px-3 py-2.5">
          <div className="text-2xs uppercase tracking-[0.1em] text-white/45 font-semibold">Clinic</div>
          <div className="text-sm font-medium text-white truncate mt-0.5">{me?.tenant?.name}</div>
        </div>
      </div>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto scroll-thin">
        {items.filter((i) => i.show !== false).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/app'} onClick={() => setOpen(false)}
            className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 h-9 text-sm transition relative',
              isActive ? 'bg-white/[0.09] text-white font-medium before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-brand-gradient' : 'hover:bg-white/[0.05] hover:text-white')}>
            <i.icon className="h-[18px] w-[18px] opacity-90" strokeWidth={1.8} />
            <span className="flex-1">{i.label}</span>{i.badge}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={me?.name ?? '?'} hue={24} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-white font-medium truncate">{me?.name}</div>
            <div className="text-2xs text-white/50 truncate">{me?.roleLabel}</div>
          </div>
          <button onClick={() => setDark(toggleTheme() === 'dark')} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10" aria-label="Toggle theme">{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
          <button onClick={() => { logout(); nav('/login'); }} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen lg:pl-[248px]">
      <div className="hidden lg:block fixed inset-y-0 left-0 z-30">{sidebar}</div>
      {open && <div className="lg:hidden fixed inset-0 z-40 flex"><div className="animate-in">{sidebar}</div><div className="flex-1 bg-navy-900/50" onClick={() => setOpen(false)} /></div>}
      <header className="sticky top-0 z-20 h-14 bg-canvas/85 backdrop-blur border-b border-line flex items-center gap-3 px-4 lg:px-10">
        <button className="lg:hidden p-1.5 -ml-1 text-ink-2" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <form className="relative flex-1 max-w-md" onSubmit={(e) => { e.preventDefault(); nav(`/app/patients?q=${encodeURIComponent(search)}`); }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-4" />
          <input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patients, references…" className="input h-9 pl-9 pr-12 bg-surface/80" />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </form>
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-2 text-xs text-ink-3"><span className="h-1.5 w-1.5 rounded-full bg-stable" /> Encrypted session · {me?.tenant?.slug}</div>
      </header>
      <main className="px-4 lg:px-10 py-8 max-w-[1480px] mx-auto"><Outlet /></main>
    </div>
  );
}

function Badge({ n, urgent }: { n: number; urgent?: boolean }) {
  return <span className={clsx('num min-w-5 h-5 px-1.5 rounded-full text-2xs font-semibold flex items-center justify-center', urgent ? 'bg-brand-gradient text-navy' : 'bg-white/15 text-white')}>{n}</span>;
}
