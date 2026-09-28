import clsx from 'clsx';
import { useId } from 'react';

/** Ortho Monitoring AI brand mark: tooth outline with a monitoring pulse. */
export function LogoMark({ size = 32, className, tooth = 'currentColor' }: { size?: number; className?: string; tooth?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`pulse-${id}`} x1="0" x2="1"><stop offset="0" stopColor="#E8590C" /><stop offset="1" stopColor="#F5B400" /></linearGradient>
      </defs>
      <path d="M22 10c-7.5 0-11 5.2-11 12.6 0 7.4 3.6 12.3 5.3 19.6 1.4 6.2 2.5 12 6.2 12s3.8-7 5.5-12c.8-2.4 2.3-3.6 4-3.6s3.2 1.2 4 3.6c1.7 5 1.8 12 5.5 12s4.8-5.8 6.2-12c1.7-7.3 5.3-12.2 5.3-19.6C53 15.2 49.5 10 42 10c-4.4 0-7 2.8-10 2.8S26.4 10 22 10Z"
        fill="none" stroke={tooth} strokeWidth="3.6" strokeLinejoin="round" />
      <path d="M3 25.5h16.5l3.6-8 5 15.5 3.8-10.5 2.6 3H55" fill="none" stroke={`url(#pulse-${id})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="58.2" cy="25.5" r="3.4" fill="#F5B400" />
    </svg>
  );
}

export function AiBadge({ className }: { className?: string }) {
  return <span className={clsx('inline-flex items-center justify-center rounded-md bg-brand-gradient px-1.5 font-serif font-bold leading-none text-navy', className)}>AI</span>;
}

/** Full lockup. `tone="light"` for dark backgrounds. */
export function Logo({ tone = 'dark', size = 'md', stacked = false }: { tone?: 'dark' | 'light'; size?: 'sm' | 'md' | 'lg'; stacked?: boolean }) {
  const mark = { sm: 26, md: 34, lg: 64 }[size];
  const text = { sm: 'text-[17px]', md: 'text-[21px]', lg: 'text-[40px]' }[size];
  const color = tone === 'light' ? 'text-white' : 'text-navy dark:text-white';
  return (
    <span className={clsx('inline-flex items-center gap-2.5 select-none', color)}>
      <LogoMark size={mark} />
      <span className={clsx('font-serif font-bold leading-[0.95] tracking-tight', text, stacked ? 'flex flex-col' : 'flex items-baseline gap-1.5')}>
        <span>Ortho</span>
        <span className="inline-flex items-center gap-1.5">Monitoring <AiBadge className={size === 'lg' ? 'text-[26px] h-9 px-2' : size === 'sm' ? 'text-[11px] h-[17px]' : 'text-[13px] h-[20px]'} /></span>
      </span>
    </span>
  );
}
