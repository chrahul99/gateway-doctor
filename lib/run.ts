import { generateText } from 'ai';
import { GatewayError } from '@ai-sdk/gateway';
import { demoResult } from './fixtures';
import type { GatewayMeta, RunError, RunRequest, RunResult } from './types';

/** True when a live call can authenticate (API key, or OIDC on Vercel). */
export function hasCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

/**
 * Runs one request through AI Gateway and normalizes the outcome.
 * Shared by the API route and the CLI so both surfaces report the same facts.
 */
export async function runRequest(req: RunRequest): Promise<RunResult> {
  if (req.scenario || !hasCredentials()) {
    return demoResult({ ...req, scenario: req.scenario ?? 'success' });
  }

  const gateway: Record<string, string[]> = {};
  if (req.providerOrder.length) gateway.order = req.providerOrder;
  if (req.fallbackModels.length) gateway.models = req.fallbackModels;

  const started = performance.now();
  try {
    const result = await generateText({
      model: req.model,
      prompt: req.prompt,
      // Retries hide the real first failure. The gateway already fails over
      // between providers and models, so we want its raw report.
      maxRetries: 0,
      ...(Object.keys(gateway).length ? { providerOptions: { gateway } } : {}),
    });
    return {
      ok: true,
      mode: 'live',
      request: req,
      text: result.text,
      latencyMs: Math.round(performance.now() - started),
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      finishReason: String(result.finishReason),
      gateway: result.providerMetadata?.gateway as GatewayMeta | undefined,
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'live',
      request: req,
      latencyMs: Math.round(performance.now() - started),
      error: toRunError(err),
    };
  }
}

export function toRunError(err: unknown): RunError {
  // The SDK can wrap the gateway error (for example in a RetryError), so walk
  // the cause chain to find the most specific one.
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (GatewayError.isInstance(cur)) {
      return {
        name: cur.name,
        type: cur.type,
        statusCode: cur.statusCode,
        message: cur.message,
        generationId: cur.generationId,
      };
    }
    cur = (cur as { cause?: unknown }).cause ?? (cur as { lastError?: unknown }).lastError;
  }
  const e = err as { name?: string; message?: string; statusCode?: number };
  return {
    name: e?.name ?? 'Error',
    statusCode: e?.statusCode,
    message: e?.message ?? String(err),
  };
}
