// Shapes mirror `providerMetadata.gateway` as documented at
// https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering
// Every field is optional: the gateway adds fields over time and older
// responses omit some, so the UI must never assume one is present.

export type ProviderAttempt = {
  provider: string;
  providerApiModelId?: string;
  modelId?: string;
  credentialType?: 'system' | 'byok' | (string & {});
  success: boolean;
  error?: string;
  statusCode?: number;
  startTime?: number;
  endTime?: number;
  responseTimeMs?: number;
  attemptNumber?: number;
};

export type ModelAttempt = {
  modelId: string;
  canonicalSlug: string;
  success: boolean;
  providerAttemptCount?: number;
  providerAttempts: ProviderAttempt[];
};

export type GatewayRouting = {
  originalModelId?: string;
  resolvedProvider?: string;
  finalProvider?: string;
  fallbacksAvailable?: string[];
  planningReasoning?: string;
  modelAttemptCount?: number;
  modelAttempts?: ModelAttempt[];
  totalProviderAttemptCount?: number;
};

export type GatewayMeta = {
  routing?: GatewayRouting;
  cost?: string;
  marketCost?: string;
  generationId?: string;
};

export type ScenarioId =
  | 'success'
  | 'provider-fallback'
  | 'byok-fallback'
  | 'model-fallback'
  | 'auth'
  | 'model-typo'
  | 'rate-limit'
  | 'budget';

export type RunRequest = {
  model: string;
  prompt: string;
  fallbackModels: string[];
  providerOrder: string[];
  /** Forces a canned demo scenario instead of a live call. */
  scenario?: ScenarioId;
};

export type RunError = {
  name: string;
  type?: string;
  statusCode?: number;
  message: string;
  generationId?: string;
};

export type RunResult =
  | {
      ok: true;
      mode: 'live' | 'demo';
      request: RunRequest;
      text: string;
      latencyMs: number;
      usage: { inputTokens?: number; outputTokens?: number };
      finishReason?: string;
      gateway?: GatewayMeta;
    }
  | {
      ok: false;
      mode: 'live' | 'demo';
      request: RunRequest;
      latencyMs: number;
      error: RunError;
      gateway?: GatewayMeta;
    };

export type CatalogModel = {
  id: string;
  name: string;
  owned_by: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  pricing?: { input?: string; output?: string };
};
