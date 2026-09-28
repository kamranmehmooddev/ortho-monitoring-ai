export const DAY_MS = 86_400_000;

export const nowIso = () => new Date().toISOString();
export const toDate = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => toDate(new Date());

export function addDays(date: string | Date, days: number): string {
  const d = typeof date === 'string' ? new Date(date.length === 10 ? `${date}T00:00:00Z` : date) : new Date(date);
  return toDate(new Date(d.getTime() + days * DAY_MS));
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a.length === 10 ? `${a}T00:00:00Z` : a).getTime();
  const db = new Date(b.length === 10 ? `${b}T00:00:00Z` : b).getTime();
  return Math.round((db - da) / DAY_MS);
}

export function hoursSince(iso: string, now = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
