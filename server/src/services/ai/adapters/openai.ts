import { ProviderError, extractJson, type ProviderAdapter, type ProviderConfig, type VisionRequest } from '../types.js';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4o': { input: 2.5, output: 10 },
};

/** Chat Completions with json_schema response_format. Shared by the OpenAI-compatible adapter. */
export async function chatCompletions(url: string, headers: Record<string, string>, cfg: ProviderConfig, req: VisionRequest, strictSchema = true) {
  const content: unknown[] = [];
  for (const img of req.images) {
    content.push({ type: 'text', text: img.label });
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}`, detail: 'high' } });
  }
  content.push({ type: 'text', text: req.user });
  const body = {
    model: cfg.model,
    max_completion_tokens: req.maxTokens,
    messages: [{ role: 'system', content: req.system }, { role: 'user', content }],
    response_format: strictSchema
      ? { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.schema } }
      : { type: 'json_object' },
  };
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(req.timeoutMs) });
  } catch (e) { throw new ProviderError(`Network error: ${(e as Error).message}`, true); }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new ProviderError(`Provider HTTP ${res.status}: ${txt.slice(0, 200)}`, res.status >= 500 || res.status === 429, res.status);
  }
  const data = await res.json() as any;
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new ProviderError('Model declined the request', false);
  const text = choice?.message?.content ?? '';
  return { json: extractJson(text), raw: text, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, model: data.model ?? cfg.model };
}

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-5',
  models: Object.keys(PRICING),
  endpointConfigurable: false,
  pricing: (m) => PRICING[m] ?? PRICING['gpt-5'],
  analyze: (cfg, req) => chatCompletions('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${cfg.apiKey}` }, cfg, req),
};
