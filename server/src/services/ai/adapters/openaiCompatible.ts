import { ProviderError, type ProviderAdapter } from '../types.js';
import { chatCompletions } from './openai.js';

/**
 * Any OpenAI-compatible Chat Completions endpoint: Azure OpenAI deployments, OpenRouter,
 * self-hosted vLLM / TGI serving a vision model. Pricing is unknown, so a conservative default is used
 * and the per-call ceiling still applies.
 */
export const openaiCompatibleAdapter: ProviderAdapter = {
  id: 'openai_compatible',
  label: 'OpenAI-compatible endpoint',
  defaultModel: 'custom-vision-model',
  models: [],
  endpointConfigurable: true,
  pricing: () => ({ input: 3, output: 15 }),
  analyze(cfg, req) {
    if (!cfg.endpoint) throw new ProviderError('Endpoint URL is required for OpenAI-compatible providers', false);
    const url = cfg.endpoint.replace(/\/$/, '');
    const isAzure = /\.openai\.azure\.com/.test(url);
    const full = url.endsWith('/chat/completions') || url.includes('/chat/completions?') ? url : `${url}/chat/completions`;
    const headers: Record<string, string> = isAzure ? { 'api-key': cfg.apiKey } : { authorization: `Bearer ${cfg.apiKey}` };
    return chatCompletions(full, headers, cfg, req, !isAzure);
  },
};
