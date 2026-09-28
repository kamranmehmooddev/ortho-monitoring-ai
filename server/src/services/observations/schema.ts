import { z } from 'zod';

export const VIEWS = ['front', 'left', 'right', 'upper', 'lower'] as const;
export type View = typeof VIEWS[number];
export const VIEW_LABELS: Record<View, string> = { front: 'Front bite', left: 'Left bite', right: 'Right bite', upper: 'Upper arch', lower: 'Lower arch' };

export const FINDING_CATEGORIES = [
  'tracking_gap', 'aligner_damage', 'attachment_missing', 'attachment_damaged', 'attachment_obscured', 'progress_deviation',
  'spacing_change', 'bracket_debond', 'wire_issue', 'elastic_noncompliance', 'plaque', 'gingival_inflammation', 'soft_tissue_lesion',
  'ipr_followup', 'other',
] as const;
export type FindingCategory = typeof FINDING_CATEGORIES[number];

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  tracking_gap: 'Possible aligner seating gap', aligner_damage: 'Possible aligner damage', attachment_missing: 'Attachment possibly missing',
  attachment_damaged: 'Attachment possibly damaged', attachment_obscured: 'Attachment cannot be assessed', progress_deviation: 'Possible deviation from planned progress',
  spacing_change: 'Possible spacing change', bracket_debond: 'Possible bracket debond', wire_issue: 'Possible wire issue',
  elastic_noncompliance: 'Elastics not visible', plaque: 'Possible plaque accumulation', gingival_inflammation: 'Possible gingival inflammation',
  soft_tissue_lesion: 'Possible soft-tissue lesion', ipr_followup: 'IPR follow-up (cannot be confirmed from photo)', other: 'Other observation',
};

export const HYGIENE_CATEGORIES: FindingCategory[] = ['plaque', 'gingival_inflammation', 'soft_tissue_lesion'];

// JSON Schema sent to the model (strict-mode compatible: every object closed, every property required).
export const OBSERVATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'view_notes', 'findings', 'attachment_checks'],
  properties: {
    summary: { type: 'string', description: 'One or two neutral sentences describing what is visible. No diagnosis.' },
    view_notes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['view', 'usable_for_assessment', 'limitation'],
        properties: {
          view: { type: 'string', enum: [...VIEWS] },
          usable_for_assessment: { type: 'boolean' },
          limitation: { type: 'string', description: 'What limits assessment (glare, angle, saliva, aligner opacity) or empty string' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['category', 'view', 'teeth_fdi', 'assessment', 'uncertainty', 'confidence', 'evidence', 'compared_with', 'appears', 'bbox', 'needs_better_image'],
        properties: {
          category: { type: 'string', enum: [...FINDING_CATEGORIES] },
          view: { type: 'string', enum: [...VIEWS] },
          teeth_fdi: { type: 'array', items: { type: 'integer' } },
          assessment: { type: 'string', enum: ['possible', 'cannot_assess'] },
          uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
          confidence: { type: 'number', description: '0–1 self-reported; used only for evaluation, never displayed as accuracy' },
          evidence: { type: 'string', description: 'What in the image supports this observation' },
          compared_with: { type: 'string', enum: ['previous', 'baseline', 'both', 'none'] },
          appears: { type: 'string', enum: ['new', 'persistent', 'unclear'] },
          bbox: {
            type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'],
            description: 'Normalised 0–1 region on the CURRENT image of this view; use 0,0,1,1 if not localisable',
            properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
          },
          needs_better_image: { type: 'boolean' },
        },
      },
    },
    attachment_checks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['tooth_fdi', 'view', 'status', 'reason'],
        properties: {
          tooth_fdi: { type: 'integer' },
          view: { type: 'string', enum: [...VIEWS] },
          status: { type: 'string', enum: ['present', 'possibly_missing', 'possibly_damaged', 'cannot_assess'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

// Runtime validation of the model output (defence in depth: providers differ in schema enforcement).
const fdi = z.number().int().refine((n) => (n >= 11 && n <= 48) || (n >= 51 && n <= 85), 'invalid FDI');
export const ObservationOutput = z.object({
  summary: z.string().max(2000),
  view_notes: z.array(z.object({ view: z.enum(VIEWS), usable_for_assessment: z.boolean(), limitation: z.string().max(500) })).max(20),
  findings: z.array(z.object({
    category: z.enum(FINDING_CATEGORIES), view: z.enum(VIEWS), teeth_fdi: z.array(fdi).max(16),
    assessment: z.string(), uncertainty: z.enum(['low', 'medium', 'high']), confidence: z.number().min(0).max(1),
    evidence: z.string().max(1000), compared_with: z.enum(['previous', 'baseline', 'both', 'none']),
    appears: z.enum(['new', 'persistent', 'unclear']),
    bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    needs_better_image: z.boolean(),
  })).max(30),
  attachment_checks: z.array(z.object({ tooth_fdi: fdi, view: z.enum(VIEWS), status: z.enum(['present', 'possibly_missing', 'possibly_damaged', 'cannot_assess']), reason: z.string().max(500) })).max(40),
});
export type ObservationOutputT = z.infer<typeof ObservationOutput>;
