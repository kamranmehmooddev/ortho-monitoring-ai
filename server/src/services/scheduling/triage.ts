/** Urgency triage (triage-v1). Classifies patient issue reports; never books appointments. */
export const TRIAGE_VERSION = 'triage-v1';
export type Urgency = 'P1' | 'P2' | 'P3' | 'P4';

export const ISSUE_CATEGORIES = {
  aligner_cracked: 'Cracked or broken aligner', aligner_lost: 'Lost aligner', attachment_off: 'Attachment came off',
  poor_fit: 'Aligner not fitting', pain: 'Pain or soreness', irritation: 'Sharp edge or irritation',
  bracket_loose: 'Loose bracket', wire_poking: 'Poking or broken wire', elastic_hook: 'Broken elastic hook', other: 'Something else',
} as const;
export type IssueCategory = keyof typeof ISSUE_CATEGORIES;

export const SLA_MINUTES: Record<Urgency, number> = { P1: 15, P2: 240, P3: 60 * 24, P4: 60 * 72 };

export const INTERIM_GUIDANCE: Record<IssueCategory, string> = {
  aligner_cracked: 'If the crack is small and the aligner still fits, keep wearing it and smooth any sharp edge with a nail file. If it is sharp or loose, go back to your previous aligner. Do not move ahead to the next one.',
  aligner_lost: 'Put your previous aligner back in and wear it full time. Do not skip ahead to the next aligner until the clinic tells you to.',
  attachment_off: 'Keep wearing your aligner as usual and keep the attachment piece if you find it. The clinic will decide whether it needs replacing.',
  poor_fit: 'Use your chewies for 5–10 minutes, three times a day, and press the aligner fully onto your back teeth. Do not change to the next aligner yet.',
  pain: 'Some pressure is normal for 2–3 days after a change. For sharp, severe or worsening pain, or swelling, call the clinic.',
  irritation: 'Orthodontic wax on the edge can help. Do not cut the aligner. The clinic will review your photos.',
  bracket_loose: 'If the bracket is still on the wire, leave it. If it is uncomfortable, cover it with wax. Keep any loose pieces.',
  wire_poking: 'Push the wire flat with a clean cotton bud or cover it with wax. Do not cut the wire yourself.',
  elastic_hook: 'Stop wearing the elastics on that side until the clinic advises.',
  other: 'The clinic team will review your report.',
};

const RED_FLAGS: { re: RegExp; reason: string }[] = [
  { re: /swallow|inhal|choke|breath/i, reason: 'Possible swallowed or inhaled component' },
  { re: /swell|swollen/i, reason: 'Swelling reported' },
  { re: /bleed(ing)? (won'?t|does ?n.?t) stop|heavy bleed|lots of blood/i, reason: 'Persistent bleeding reported' },
  { re: /allerg|rash|hives/i, reason: 'Possible allergic reaction' },
  { re: /fever|pus|infect/i, reason: 'Possible infection signs' },
  { re: /cut|lacerat|stabb|piercing (my )?(cheek|gum|lip)/i, reason: 'Soft-tissue injury reported' },
];

export interface TriageInput { category: IssueCategory; painLevel?: number | null; severitySelf?: number | null; details?: string | null; attachmentsOffCount?: number }
export interface TriageResult { version: string; urgency: Urgency; reasons: string[]; slaMinutes: number; guidance: string }

export function triage(input: TriageInput): TriageResult {
  const reasons: string[] = [];
  const pain = input.painLevel ?? 0;
  let u: Urgency = 'P4';
  const raise = (to: Urgency, why: string) => { reasons.push(why); if (to < u) u = to; }; // 'P1' < 'P2' lexically

  for (const f of RED_FLAGS) if (input.details && f.re.test(input.details)) raise('P1', f.reason);
  if (pain >= 8) raise('P1', `Pain ${pain}/10`);
  else if (pain >= 5) raise('P2', `Pain ${pain}/10`);

  switch (input.category) {
    case 'aligner_lost': raise('P2', 'Lost aligner: risk of relapse without guidance'); break;
    case 'aligner_cracked': (input.details && /sharp|cut/i.test(input.details)) || (input.severitySelf ?? 0) >= 4 ? raise('P2', 'Cracked aligner with sharp edge or high severity') : raise('P3', 'Cracked aligner'); break;
    case 'bracket_loose': raise('P2', 'Debonded bracket'); break;
    case 'wire_poking': (input.details && /broke|snap/i.test(input.details)) || pain >= 4 ? raise('P2', 'Broken or poking wire') : raise('P3', 'Poking wire'); break;
    case 'attachment_off': (input.attachmentsOffCount ?? 1) >= 2 ? raise('P2', 'Two or more attachments off') : raise('P3', 'Single attachment off'); break;
    case 'poor_fit': raise('P3', 'Aligner not seating'); break;
    case 'irritation': case 'elastic_hook': raise('P3', ISSUE_CATEGORIES[input.category]); break;
    case 'pain': if (pain < 5) raise('P3', 'Mild pain'); break;
    default: raise('P4', 'General question or concern');
  }
  return { version: TRIAGE_VERSION, urgency: u, reasons, slaMinutes: SLA_MINUTES[u], guidance: INTERIM_GUIDANCE[input.category] ?? INTERIM_GUIDANCE.other };
}
