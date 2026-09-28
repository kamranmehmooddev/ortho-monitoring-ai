import { addDays } from '../../lib/time.js';

/** Next remote check-in date (checkin-v1) with reasons. */
export function nextCheckin(i: {
  lastCheckin: string; intervalDays: number; nextChangeDate: string | null; lastDecision: 'go' | 'no_go' | 'retake' | 'visit' | 'not_yet' | null;
  holdDays: number; consecutiveCleanGo: number; lowWearStreak: number;
}): { date: string; reasons: string[] } {
  const reasons: string[] = [];
  let date = addDays(i.lastCheckin, i.intervalDays);
  reasons.push(`Protocol interval ${i.intervalDays} days`);
  if (i.lastDecision === 'retake') { date = addDays(i.lastCheckin, 2); reasons.push('Retake requested: re-check in 2 days'); }
  else if (i.lastDecision === 'no_go') { date = addDays(i.lastCheckin, Math.min(5, Math.max(3, i.holdDays || 4))); reasons.push(`Held on current aligner: re-check after ${Math.min(5, Math.max(3, i.holdDays || 4))} days`); }
  else if (i.lowWearStreak >= 2) { const d = addDays(i.lastCheckin, 7); if (d < date) { date = d; reasons.push('Low wear in 2 consecutive check-ins: weekly check-ins'); } }
  else if (i.consecutiveCleanGo >= 3) { date = addDays(i.lastCheckin, Math.round(i.intervalDays * 1.5)); reasons.push('3 consecutive clean check-ins: interval extended 50%'); }
  if (i.nextChangeDate && i.nextChangeDate < date && i.lastDecision !== 'retake') {
    date = addDays(i.nextChangeDate, -1); reasons.push(`Before next planned aligner change (${i.nextChangeDate})`);
  }
  return { date, reasons };
}
