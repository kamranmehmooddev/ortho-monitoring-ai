import clsx from 'clsx';
import { forwardRef, useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X, Info, AlertTriangle, CheckCircle2, HelpCircle, Circle } from 'lucide-react';
import type { Tone } from '../../lib/clinical';
import { initials } from '../../lib/format';

// ── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ember' | 'subtle';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button ref={ref} disabled={disabled || loading}
      className={clsx('inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all whitespace-nowrap select-none disabled:opacity-50 disabled:pointer-events-none active:translate-y-px',
        { sm: 'h-8 px-3 text-sm', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-5 text-md' }[size],
        {
          primary: 'bg-navy text-white hover:bg-navy-3 shadow-sm dark:bg-white dark:text-navy dark:hover:bg-white/90',
          ember: 'bg-ember text-white hover:brightness-105 shadow-sm',
          secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
          ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
          subtle: 'bg-sunken text-ink-2 hover:text-ink hover:bg-line/60',
          danger: 'bg-urgent text-white hover:brightness-110',
        }[variant], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ));

// ── Status pill ──────────────────────────────────────────────────────────────
const toneCls: Record<Tone, string> = {
  urgent: 'bg-urgent-soft text-urgent', attention: 'bg-attention-soft text-attention', stable: 'bg-stable-soft text-stable',
  info: 'bg-info-soft text-info', uncertain: 'bg-uncertain-soft text-uncertain', neutral: 'bg-sunken text-ink-2', ember: 'bg-ember-soft text-ember-ink',
};
const toneIcon: Record<Tone, typeof Info> = { urgent: AlertTriangle, attention: AlertTriangle, stable: CheckCircle2, info: Info, uncertain: HelpCircle, neutral: Circle, ember: Circle };
export function Pill({ tone = 'neutral', children, icon = true, className, size = 'md' }: { tone?: Tone; children: ReactNode; icon?: boolean; className?: string; size?: 'sm' | 'md' }) {
  const I = toneIcon[tone];
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap', size === 'sm' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs', toneCls[tone], className)}>
      {icon && <I className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} strokeWidth={2.2} />}{children}
    </span>
  );
}
export function Dot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  const c = { urgent: 'bg-urgent', attention: 'bg-attention', stable: 'bg-stable', info: 'bg-info', uncertain: 'bg-uncertain', neutral: 'bg-ink-4', ember: 'bg-ember' }[tone];
  return <span className={clsx('inline-block h-2 w-2 rounded-full', c, pulse && 'animate-pulseDot')} />;
}

// ── Card / sections ──────────────────────────────────────────────────────────
export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={clsx('card', pad && 'p-5', className)}>{children}</div>;
}
export function SectionTitle({ title, hint, action, count }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <h3 className="text-md font-semibold text-ink flex items-center gap-2">{title}{count != null && <span className="num text-xs font-medium text-ink-3 bg-sunken rounded-full px-2 py-0.5">{count}</span>}</h3>
        {hint && <p className="text-sm text-ink-3 mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageHeader({ title, eyebrow, subtitle, actions }: { title: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="display text-[34px] leading-[1.05]">{title}</h1>
        {subtitle && <p className="text-ink-3 mt-1.5 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ name, hue = 220, size = 32 }: { name: string; hue?: number; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 45% 30%)` }}>
      {initials(name)}
    </span>
  );
}

// ── Stat ─────────────────────────────────────────────────────────────────────
export function Stat({ label, value, hint, tone, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={clsx('card text-left p-4 transition group', onClick && 'hover:border-line-strong hover:shadow-pop/0 cursor-pointer')}>
      <div className="label flex items-center gap-1.5">{tone && <Dot tone={tone} />}{label}</div>
      <div className="display num text-[34px] leading-none mt-2.5">{value}</div>
      {hint && <div className="text-xs text-ink-3 mt-1.5">{hint}</div>}
    </button>
  );
}

// ── Tabs / segmented ─────────────────────────────────────────────────────────
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-sunken p-0.5 border border-line">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={clsx('rounded-md font-medium transition inline-flex items-center gap-1.5', size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}>
          {o.label}{o.count != null && <span className={clsx('num text-2xs rounded-full px-1.5', value === o.value ? 'bg-sunken' : 'bg-line/70')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="flex gap-6 border-b border-line mb-6 overflow-x-auto scroll-thin">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={clsx('pb-3 -mb-px text-sm font-medium border-b-2 transition whitespace-nowrap flex items-center gap-1.5', value === t.value ? 'border-ember text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
          {t.label}{t.count != null && <span className="num text-2xs bg-sunken rounded-full px-1.5">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Form ─────────────────────────────────────────────────────────────────────
export function Field({ label, hint, children, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-2 mb-1.5">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-urgent mt-1">{error}</span>}
    </label>
  );
}
export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-ember' : 'bg-line-strong')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || description) && <span><span className="block text-sm font-medium text-ink">{label}</span>{description && <span className="block text-xs text-ink-3 mt-0.5">{description}</span>}</span>}
    </label>
  );
}

// ── Overlay: modal & drawer ──────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-navy-900/40 backdrop-blur-[2px] animate-in" onMouseDown={onClose}>
      <div className={clsx('card w-full shadow-pop animate-in', width)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <h2 className="font-semibold text-md">{title}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink p-1 rounded-md hover:bg-sunken" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 max-h-[65vh] overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-raised rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────────
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      {icon && <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-sunken flex items-center justify-center text-ink-3">{icon}</div>}
      <div className="font-medium text-ink">{title}</div>
      {children && <div className="text-sm text-ink-3 mt-1 max-w-sm mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) { return <div className={clsx('animate-pulse rounded-md bg-sunken', className)} />; }
export function Kbd({ children }: { children: ReactNode }) { return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 text-2xs font-medium text-ink-3 shadow-[0_1px_0_rgb(var(--line-strong))]">{children}</kbd>; }
export function Divider({ className }: { className?: string }) { return <div className={clsx('h-px bg-line', className)} />; }
export function Callout({ tone = 'info', title, children, icon }: { tone?: Tone; title?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  const I = toneIcon[tone];
  return (
    <div className={clsx('rounded-lg px-3.5 py-3 text-sm flex gap-2.5', toneCls[tone])}>
      <span className="mt-0.5 shrink-0">{icon ?? <I className="h-4 w-4" />}</span>
      <div className="min-w-0">{title && <div className="font-semibold mb-0.5">{title}</div>}<div className="opacity-90 text-ink-2 [&_strong]:text-ink">{children}</div></div>
    </div>
  );
}
