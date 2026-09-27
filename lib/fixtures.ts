import type { CatalogModel, RunRequest, RunResult, ScenarioId } from './types';

/**
 * Demo scenarios let anyone explore the inspector without an API key, and
 * make the rare-but-important failure paths reproducible for design reviews.
 * Metadata shapes are copied from the AI Gateway docs.
 */

export const SCENARIOS: { id: ScenarioId; label: string; hint: string }[] = [
  { id: 'success', label: 'Clean success', hint: 'One provider, first try' },
  { id: 'provider-fallback', label: 'Provider fallback', hint: 'Bedrock 503, Anthropic serves' },
  { id: 'byok-fallback', label: 'BYOK key rejected', hint: 'Your key fails, system credentials serve' },
  { id: 'model-fallback', label: 'Model fallback', hint: 'Primary model down everywhere' },
  { id: 'auth', label: 'Missing API key', hint: '401 before routing' },
  { id: 'model-typo', label: 'Model ID typo', hint: '404 with a suggestion' },
  { id: 'rate-limit', label: 'Rate limited', hint: '429, no fallbacks' },
  { id: 'budget', label: 'Budget exceeded', hint: 'Spend limit hit' },
];

/** Request presets that match each scenario, so the form tells the same story. */
export const SCENARIO_REQUESTS: Record<ScenarioId, Omit<RunRequest, 'scenario' | 'prompt'>> = {
  success: { model: 'anthropic/claude-sonnet-5', fallbackModels: [], providerOrder: [] },
  'provider-fallback': { model: 'anthropic/claude-sonnet-5', fallbackModels: [], providerOrder: ['bedrock', 'anthropic'] },
  'byok-fallback': { model: 'zai/glm-5', fallbackModels: [], providerOrder: [] },
  'model-fallback': {
    model: 'google/gemini-3.1-pro-preview',
    fallbackModels: ['anthropic/claude-opus-5'],
    providerOrder: [],
  },
  auth: { model: 'openai/gpt-6-astra', fallbackModels: [], providerOrder: [] },
  'model-typo': { model: 'anthropic/claude-sonet-5', fallbackModels: [], providerOrder: [] },
  'rate-limit': { model: 'openai/gpt-6-astra', fallbackModels: [], providerOrder: [] },
  budget: { model: 'anthropic/claude-opus-5', fallbackModels: [], providerOrder: [] },
};

const TEXT =
  'AI Gateway gives your app one endpoint and one key for hundreds of models, and handles routing, fallbacks, spend and logs for you.';

export function demoResult(req: RunRequest): RunResult {
  const s = req.scenario ?? 'success';
  const base = { mode: 'demo' as const, request: req };

  switch (s) {
    case 'success':
      return {
        ...base,
        ok: true,
        text: TEXT,
        latencyMs: 1142,
        usage: { inputTokens: 14, outputTokens: 31 },
        finishReason: 'stop',
        gateway: {
          cost: '0.0005070',
          generationId: 'gen_demo_success',
          routing: {
            originalModelId: req.model,
            resolvedProvider: 'anthropic',
            finalProvider: 'anthropic',
            fallbacksAvailable: ['bedrock', 'vertex'],
            modelAttemptCount: 1,
            totalProviderAttemptCount: 1,
            modelAttempts: [
              {
                modelId: 'anthropic:claude-sonnet-5',
                canonicalSlug: req.model,
                success: true,
                providerAttempts: [
                  { provider: 'anthropic', credentialType: 'system', success: true, statusCode: 200, responseTimeMs: 1138 },
                ],
              },
            ],
          },
        },
      };

    case 'provider-fallback':
      return {
        ...base,
        ok: true,
        text: TEXT,
        latencyMs: 3905,
        usage: { inputTokens: 14, outputTokens: 31 },
        finishReason: 'stop',
        gateway: {
          cost: '0.0005070',
          generationId: 'gen_demo_provider_fallback',
          routing: {
            originalModelId: req.model,
            resolvedProvider: 'bedrock',
            finalProvider: 'anthropic',
            fallbacksAvailable: ['anthropic', 'vertex'],
            modelAttemptCount: 1,
            totalProviderAttemptCount: 2,
            modelAttempts: [
              {
                modelId: 'bedrock:claude-sonnet-5',
                canonicalSlug: req.model,
                success: true,
                providerAttempts: [
                  { provider: 'bedrock', credentialType: 'system', success: false, statusCode: 503, error: 'Service unavailable', responseTimeMs: 2710 },
                  { provider: 'anthropic', credentialType: 'system', success: true, statusCode: 200, responseTimeMs: 1188 },
                ],
              },
            ],
          },
        },
      };

    case 'byok-fallback':
      return {
        ...base,
        ok: true,
        text: TEXT,
        latencyMs: 842,
        usage: { inputTokens: 14, outputTokens: 29 },
        finishReason: 'stop',
        gateway: {
          cost: '0.0000610',
          generationId: 'gen_demo_byok',
          routing: {
            originalModelId: req.model,
            resolvedProvider: 'novita',
            finalProvider: 'novita',
            modelAttemptCount: 1,
            totalProviderAttemptCount: 2,
            modelAttempts: [
              {
                modelId: 'novita:zai-org/glm-5',
                canonicalSlug: req.model,
                success: true,
                providerAttempts: [
                  { provider: 'novita', credentialType: 'byok', success: false, error: 'Unauthorized', statusCode: 401, startTime: 1754639042520, endTime: 1754639042710 },
                  { provider: 'novita', credentialType: 'system', success: true, startTime: 1754639042710, endTime: 1754639043353 },
                ],
              },
            ],
          },
        },
      };

    case 'model-fallback':
      return {
        ...base,
        ok: true,
        text: TEXT,
        latencyMs: 20512,
        usage: { inputTokens: 14, outputTokens: 33 },
        finishReason: 'stop',
        gateway: {
          cost: '0.0009950',
          generationId: 'gen_demo_model_fallback',
          routing: {
            originalModelId: req.model,
            resolvedProvider: 'vertex',
            finalProvider: 'anthropic',
            modelAttemptCount: 2,
            totalProviderAttemptCount: 3,
            modelAttempts: [
              {
                modelId: 'vertex:gemini-3.1-pro-preview',
                canonicalSlug: req.model,
                success: false,
                providerAttempts: [
                  { attemptNumber: 1, provider: 'vertex', credentialType: 'system', success: false, statusCode: 500, error: 'Internal error encountered.', responseTimeMs: 15679.64 },
                  { attemptNumber: 2, provider: 'google', credentialType: 'system', success: false, statusCode: 500, error: 'Internal error encountered.', responseTimeMs: 284.3 },
                ],
              },
              {
                modelId: 'anthropic:claude-opus-5',
                canonicalSlug: req.fallbackModels[0] ?? 'anthropic/claude-opus-5',
                success: true,
                providerAttempts: [
                  { attemptNumber: 1, provider: 'anthropic', credentialType: 'system', success: true, statusCode: 200, responseTimeMs: 4521.78 },
                ],
              },
            ],
          },
        },
      };

    case 'auth':
      return {
        ...base,
        ok: false,
        latencyMs: 96,
        error: {
          name: 'GatewayAuthenticationError',
          type: 'authentication_error',
          statusCode: 401,
          message: 'No authentication provided. Set AI_GATEWAY_API_KEY or use Vercel OIDC.',
        },
      };

    case 'model-typo':
      return {
        ...base,
        ok: false,
        latencyMs: 71,
        error: {
          name: 'GatewayModelNotFoundError',
          type: 'model_not_found',
          statusCode: 404,
          message: `Model '${req.model}' not found`,
        },
      };

    case 'rate-limit':
      return {
        ...base,
        ok: false,
        latencyMs: 188,
        error: {
          name: 'GatewayRateLimitError',
          type: 'rate_limit_exceeded',
          statusCode: 429,
          message: 'Rate limit exceeded. Please retry after a short delay.',
        },
      };

    case 'budget':
      return {
        ...base,
        ok: false,
        latencyMs: 83,
        error: {
          name: 'GatewayResponseError',
          type: 'response_error',
          statusCode: 402,
          message: 'Budget exceeded for this project. New requests using system credentials are rejected until the budget resets or is raised.',
        },
      };
  }
}

/** Used when the public catalog cannot be reached (offline, blocked egress). */
export const FALLBACK_CATALOG: CatalogModel[] = [
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', owned_by: 'anthropic', context_window: 1_000_000, tags: ['reasoning', 'tool-use', 'vision'], pricing: { input: '0.000003', output: '0.000015' } },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', owned_by: 'anthropic', context_window: 1_000_000, tags: ['reasoning', 'tool-use', 'vision'], pricing: { input: '0.000005', output: '0.000025' } },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', owned_by: 'openai', tags: ['reasoning', 'tool-use', 'vision'] },
  { id: 'openai/gpt-5.4-nano', name: 'GPT-5.4 nano', owned_by: 'openai', tags: ['tool-use'] },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', owned_by: 'google', context_window: 1_000_000, tags: ['file-input', 'tool-use', 'reasoning', 'vision'], pricing: { input: '0.000002', output: '0.000012' } },
  { id: 'zai/glm-5', name: 'GLM-5', owned_by: 'zai', tags: ['reasoning', 'tool-use'] },
];
