export type AiService = 'observations' | 'instruction_parse';
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

export interface VisionImage { label: string; mime: string; data: Buffer }
export interface VisionRequest {
  system: string;
  user: string;
  images: VisionImage[];
  /** JSON Schema (draft-07 subset, additionalProperties:false everywhere) the output must satisfy. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  timeoutMs: number;
}
export interface VisionResponse { json: unknown; raw: string; tokensIn: number; tokensOut: number; model: string }

export interface ProviderConfig { id: string; provider: ProviderId; model: string; endpoint?: string | null; apiKey: string }

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  endpointConfigurable: boolean;
  /** USD per 1M tokens (input, output). Used for budget enforcement before a call. */
  pricing(model: string): { input: number; output: number };
  analyze(cfg: ProviderConfig, req: VisionRequest): Promise<VisionResponse>;
}

export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) { super(message); }
}

/** Rough per-image token estimate (≈1.6k tokens for a ~1.1 MP image across providers). */
export const IMAGE_TOKENS = 1600;

export function estimateCostUsd(adapter: ProviderAdapter, model: string, req: Pick<VisionRequest, 'system' | 'user' | 'images' | 'maxTokens'>) {
  const p = adapter.pricing(model);
  const inTok = Math.ceil((req.system.length + req.user.length) / 3.5) + req.images.length * IMAGE_TOKENS;
  return (inTok * p.input + req.maxTokens * p.output) / 1_000_000;
}

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
  throw new ProviderError('Model did not return JSON', true);
}
