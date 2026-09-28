import { ProviderError, extractJson, type ProviderAdapter } from '../types.js';

const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
};

/** Gemini's responseSchema is an OpenAPI subset: strip keywords it rejects. */
function toGeminiSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.5-pro',
  models: Object.keys(PRICING),
  endpointConfigurable: false,
  pricing: (m) => PRICING[m] ?? PRICING['gemini-2.5-pro'],
  async analyze(cfg, req) {
    const parts: unknown[] = [];
    for (const img of req.images) {
      parts.push({ text: img.label });
      parts.push({ inline_data: { mime_type: img.mime, data: img.data.toString('base64') } });
    }
    parts.push({ text: req.user });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { maxOutputTokens: req.maxTokens, responseMimeType: 'application/json', responseSchema: toGeminiSchema(req.schema) },
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) { throw new ProviderError(`Network error: ${(e as Error).message}`, true); }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new ProviderError(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`, res.status >= 500 || res.status === 429, res.status);
    }
    const data = await res.json() as any;
    const cand = data.candidates?.[0];
    if (!cand || cand.finishReason === 'SAFETY') throw new ProviderError('Gemini returned no candidate', false);
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    return { json: extractJson(text), raw: text, tokensIn: data.usageMetadata?.promptTokenCount ?? 0, tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0, model: data.modelVersion ?? cfg.model };
  },
};
