export const VIEWS = ['front', 'left', 'right', 'upper', 'lower'] as const;
export type View = typeof VIEWS[number];
export const VIEW_LABELS: Record<string, string> = { front: 'Front bite', left: 'Left bite', right: 'Right bite', upper: 'Upper arch', lower: 'Lower arch' };

export const GONOGO_META: Record<string, { label: string; tone: Tone; verb: string }> = {
  go: { label: 'Go', tone: 'stable', verb: 'Approve next aligner' },
  no_go: { label: 'No-go', tone: 'attention', verb: 'Hold current aligner' },
  retake: { label: 'Retake', tone: 'info', verb: 'Request new photos' },
  visit: { label: 'Visit', tone: 'urgent', verb: 'Arrange in-person visit' },
  not_yet: { label: 'Not yet', tone: 'neutral', verb: 'Too early to advance' },
};
export type Tone = 'urgent' | 'attention' | 'stable' | 'info' | 'uncertain' | 'neutral' | 'ember';

export const URGENCY_TONE: Record<string, Tone> = { P1: 'urgent', P2: 'urgent', P3: 'attention', P4: 'neutral' };
export const UNCERTAINTY_TONE: Record<string, Tone> = { low: 'stable', medium: 'attention', high: 'uncertain' };
export const QUALITY_TONE: Record<string, Tone> = { usable: 'stable', limited: 'attention', unusable: 'urgent' };

export const CATEGORY_OPTIONS: [string, string][] = [
  ['tracking_gap', 'Possible aligner seating gap'], ['aligner_damage', 'Possible aligner damage'], ['attachment_missing', 'Attachment possibly missing'],
  ['attachment_damaged', 'Attachment possibly damaged'], ['attachment_obscured', 'Attachment cannot be assessed'], ['progress_deviation', 'Possible deviation from plan'],
  ['spacing_change', 'Possible spacing change'], ['bracket_debond', 'Possible bracket debond'], ['wire_issue', 'Possible wire issue'],
  ['elastic_noncompliance', 'Elastics not visible'], ['plaque', 'Possible plaque'], ['gingival_inflammation', 'Possible gingival inflammation'],
  ['soft_tissue_lesion', 'Possible soft-tissue lesion'], ['ipr_followup', 'IPR follow-up'], ['other', 'Other observation'],
];

export const VISIT_KIND_LABELS: Record<string, string> = {
  progress_review: 'Progress review', ipr: 'IPR visit', attachment_replacement: 'Attachment replacement', tracking_assessment: 'Tracking assessment',
  refinement_scan: 'Refinement scan', repair: 'Appliance repair', debond: 'End of treatment', archwire: 'Archwire change',
};
