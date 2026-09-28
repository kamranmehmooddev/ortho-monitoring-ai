const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o);
const parse = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : s.length === 16 ? `${s}:00` : s);

export const fmtDate = (s?: string | null) => (s ? dtf({ day: 'numeric', month: 'short' }).format(parse(s)) : '—');
export const fmtDateLong = (s?: string | null) => (s ? dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(parse(s)) : '—');
export const fmtDay = (s?: string | null) => (s ? dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(parse(s)) : '—');
export const fmtTime = (s?: string | null) => (s ? dtf({ hour: '2-digit', minute: '2-digit' }).format(parse(s)) : '—');
export const fmtDateTime = (s?: string | null) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');

export function ago(s?: string | null) {
  if (!s) return '—';
  const diff = (Date.now() - parse(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return fmtDate(s);
}
export function until(s?: string | null) {
  if (!s) return '—';
  const diff = (parse(s).getTime() - Date.now()) / 60000;
  if (diff < 0) return `${Math.round(-diff / 60) >= 1 ? `${Math.round(-diff / 60)} h` : `${Math.round(-diff)} min`} overdue`;
  if (diff < 60) return `${Math.round(diff)} min left`;
  if (diff < 1440) return `${Math.round(diff / 60)} h left`;
  return `${Math.round(diff / 1440)} d left`;
}
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDaysIso = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const usd = (n?: number | null) => (n == null ? '—' : n < 1 ? `$${n.toFixed(3)}` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const pct = (n?: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name: string) => name.replace(/^Dr\.?\s+/, '').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
