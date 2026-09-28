/** Review-queue priority score (priority-v1), with human-readable reasons. */
export interface PriorityInput {
  urgentIssue: 'P1' | 'P2' | null; trackingGap: boolean; attachmentMissing: boolean; alignerDamage: boolean;
  retakeLoops: number; overdueDays: number; lowWear: boolean; ageHours: number; painLevel: number;
}
export function priorityScore(p: PriorityInput): { score: number; reasons: string[] } {
  let s = 0; const r: string[] = [];
  if (p.urgentIssue === 'P1') { s += 100; r.push('P1 patient report'); }
  if (p.urgentIssue === 'P2') { s += 60; r.push('P2 patient report'); }
  if (p.trackingGap) { s += 30; r.push('Possible seating gap'); }
  if (p.attachmentMissing) { s += 25; r.push('Attachment possibly missing'); }
  if (p.alignerDamage) { s += 25; r.push('Possible aligner damage'); }
  if (p.painLevel >= 5) { s += 15; r.push(`Pain ${p.painLevel}/10`); }
  if (p.retakeLoops >= 2) { s += 20; r.push(`${p.retakeLoops} retake requests`); }
  if (p.overdueDays > 0) { s += 15 * Math.min(3, p.overdueDays); r.push(`Check-in ${p.overdueDays} d overdue`); }
  if (p.lowWear) { s += 10; r.push('Low reported wear'); }
  s += Math.min(5, p.ageHours / 12) * 5;
  if (p.ageHours >= 24) r.push(`Waiting ${Math.round(p.ageHours)} h`);
  return { score: Math.round(s), reasons: r };
}
