import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Gauge, Building, BrainCircuit, ServerCog, LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { Logo } from '../brand/Logo';

export function AdminShell() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const items = [{ to: '/admin', label: 'Overview', icon: Gauge }, { to: '/admin/tenants', label: 'Clinics & plans', icon: Building }, { to: '/admin/ai', label: 'Platform AI & models', icon: BrainCircuit }, { to: '/admin/system', label: 'System & audit', icon: ServerCog }];
  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center gap-8">
          <Logo tone="light" size="sm" />
          <span className="text-2xs uppercase tracking-[0.14em] font-semibold rounded-full bg-brand-gradient text-navy px-2.5 py-1">Super admin</span>
          <nav className="flex gap-1 overflow-x-auto">
            {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className={({ isActive }) => clsx('h-9 px-3 rounded-lg text-sm inline-flex items-center gap-2 whitespace-nowrap', isActive ? 'bg-white/12 text-white bg-white/10' : 'text-white/65 hover:text-white')}><i.icon className="h-4 w-4" />{i.label}</NavLink>)}
          </nav>
          <div className="flex-1" />
          <span className="text-sm text-white/70 hidden md:block">{me?.name}</span>
          <button onClick={() => { logout(); nav('/login'); }} className="text-white/60 hover:text-white" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-8"><Outlet /></main>
    </div>
  );
}
