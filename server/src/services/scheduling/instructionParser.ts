/**
 * Deterministic parser for doctor free-text instructions (instr-parse-v1).
 * Produces structured tags the appointment engine uses; the doctor sees and can edit every tag.
 * Accepts FDI (11–48) and Palmer-style (UR3, LL6) tooth notation.
 */
export const INSTR_PARSER_VERSION = 'instr-parse-v1';

export type InstructionTag =
  | { type: 'ipr'; teeth: number[]; amountMm: number | null; stage: number | null; source: string }
  | { type: 'rescan'; condition: string | null; stage: number | null; source: string }
  | { type: 'refinement'; source: string }
  | { type: 'check_attachments'; teeth: number[]; source: string }
  | { type: 'see_at_stage'; stage: number; source: string }
  | { type: 'visit_every'; stages: number; source: string }
  | { type: 'elastics'; hoursPerDay: number | null; source: string }
  | { type: 'chewies'; source: string }
  | { type: 'extra_time'; minutes: number; source: string };

const PALMER: Record<string, number> = { UR: 1, UL: 2, LL: 3, LR: 4 };

export function parseTeeth(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b(UR|UL|LL|LR)\s?([1-8])\b/gi)) out.add(PALMER[m[1].toUpperCase()] * 10 + Number(m[2]));
  for (const m of text.matchAll(/\b([1-4][1-8])(?=\b|\/|-)/g)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

export function parseInstructions(text: string | null | undefined): InstructionTag[] {
  if (!text) return [];
  const tags: InstructionTag[] = [];
  const sentences = text.split(/(?:[.;](?=\s|$)|\n)\s*/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const stage = s.match(/\b(?:stage|aligner|tray)\s*#?\s*(\d{1,2})\b/i);
    const stageNo = stage ? Number(stage[1]) : null;
    if (/\bIPR\b|interproximal|strip(ping)?\b/i.test(s)) {
      const amt = s.match(/(\d(?:\.\d+)?)\s*mm/i);
      tags.push({ type: 'ipr', teeth: parseTeeth(s), amountMm: amt ? Number(amt[1]) : null, stage: stageNo, source: s });
    }
    if (/\b(re-?scan|new scan|itero|intraoral scan)\b/i.test(s)) {
      const cond = s.match(/\bif\s+([^.;]+)/i);
      tags.push({ type: 'rescan', condition: cond ? cond[1].trim() : null, stage: stageNo, source: s });
    }
    if (/\brefinement|additional aligners\b/i.test(s)) tags.push({ type: 'refinement', source: s });
    if (/\battachment/i.test(s) && /\b(check|verify|replace|re-?bond|monitor)\b/i.test(s)) tags.push({ type: 'check_attachments', teeth: parseTeeth(s), source: s });
    const see = s.match(/\b(?:see|review|appointment|visit)\b[^.;]*?\bstage\s*(\d{1,2})/i);
    if (see) tags.push({ type: 'see_at_stage', stage: Number(see[1]), source: s });
    const every = s.match(/\bevery\s+(\d{1,2})\s+(?:stages|aligners|trays)\b/i);
    if (every) tags.push({ type: 'visit_every', stages: Number(every[1]), source: s });
    if (/\belastics?\b|rubber bands?/i.test(s)) {
      const hrs = s.match(/(\d{1,2})\s*h(?:ours|rs)?\b/i);
      tags.push({ type: 'elastics', hoursPerDay: hrs ? Number(hrs[1]) : null, source: s });
    }
    if (/\bchewies?\b|aligner seaters?/i.test(s)) tags.push({ type: 'chewies', source: s });
    const extra = s.match(/\b(?:extra|additional|allow)\s+(\d{1,2})\s*min/i);
    if (extra) tags.push({ type: 'extra_time', minutes: Number(extra[1]), source: s });
  }
  return tags;
}
