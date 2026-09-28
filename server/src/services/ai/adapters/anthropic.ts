import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type ProviderAdapter } from '../types.js';

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  defaultModel: 'claude-opus-5',
  models: Object.keys(PRICING),
  endpointConfigurable: false,
  pricing: (m) => PRICING[m] ?? PRICING['claude-opus-5'],
  async analyze(cfg, req) {
    const client = new Anthropic({ apiKey: cfg.apiKey, timeout: req.timeoutMs, maxRetries: 1 });
    const content: Anthropic.ContentBlockParam[] = [];
    for (const img of req.images) {
      content.push({ type: 'text', text: img.label });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mime as 'image/jpeg' | 'image/png', data: img.data.toString('base64') } });
    }
    content.push({ type: 'text', text: req.user });
    try {
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: req.maxTokens,
        system: req.system,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
        messages: [{ role: 'user', content }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (res.stop_reason === 'refusal') throw new ProviderError('Model declined the request', false);
      if (res.stop_reason === 'max_tokens') throw new ProviderError('Output truncated (max_tokens)', true);
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      return { json: JSON.parse(text), raw: text, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, model: res.model };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('Invalid Anthropic API key', false, 401);
      if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`Anthropic rejected request: ${e.message}`, false, 400);
      if (e instanceof Anthropic.RateLimitError) throw new ProviderError('Anthropic rate limit', true, 429);
      if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic API error ${e.status ?? ''}`, true, e.status);
      if (e instanceof SyntaxError) throw new ProviderError('Invalid JSON from model', true);
      throw new ProviderError(`Anthropic call failed: ${(e as Error).message}`, true);
    }
  },
};
