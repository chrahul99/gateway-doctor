import type { GatewayMeta, ProviderAttempt, RunResult } from './types';
import { formatMs, formatUsd } from './format';

/**
 * Turns a raw AI Gateway result into something a developer can act on.
 *
 * This file is pure (no I/O) so the web UI, the CLI and the tests all share
 * one source of truth for "what happened and what do I do next".
 */

export type Severity = 'ok' | 'recovered' | 'failed';

export type Finding = {
  tone: 'info' | 'warn' | 'error';
  text: string;
};

export type Diagnosis = {
  severity: Severity;
  headline: string;
  detail: string;
  findings: Finding[];
  fixes: string[];
  docs?: { label: string; href: string };
};

export type TimelineRow = {
  model: string;
  provider: string;
  credential?: string;
  success: boolean;
  durationMs?: number;
  error?: string;
  statusCode?: number;
};

const DOCS = 'https://vercel.com/docs/ai-gateway';

export function attemptDuration(a: ProviderAttempt): number | undefined {
  if (typeof a.responseTimeMs === 'number') return a.responseTimeMs;
  if (typeof a.startTime === 'number' && typeof a.endTime === 'number') {
    return Math.max(0, a.endTime - a.startTime);
  }
  return undefined;
}

/** Flattens model → provider attempts into one ordered list for the timeline. */
export function toTimeline(meta: GatewayMeta | undefined): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const m of meta?.routing?.modelAttempts ?? []) {
    for (const p of m.providerAttempts ?? []) {
      rows.push({
        model: m.canonicalSlug,
        provider: p.provider,
        credential: p.credentialType,
        success: p.success,
        durationMs: attemptDuration(p),
        error: p.error,
        statusCode: p.statusCode,
      });
    }
  }
  return rows;
}

export function diagnose(result: RunResult, catalogIds: string[] = []): Diagnosis {
  return result.ok ? diagnoseSuccess(result) : diagnoseFailure(result, catalogIds);
}

function diagnoseSuccess(result: Extract<RunResult, { ok: true }>): Diagnosis {
  const routing = result.gateway?.routing;
  const timeline = toTimeline(result.gateway);
  const failed = timeline.filter((r) => !r.success);
  const provider = routing?.finalProvider ?? routing?.resolvedProvider ?? 'unknown provider';
  const served = timeline.find((r) => r.success)?.model ?? result.request.model;
  const findings: Finding[] = [];
  const fixes: string[] = [];

  if (failed.length === 0) {
    findings.push({
      tone: 'info',
      text: `One attempt, no fallbacks needed. ${routing?.fallbacksAvailable?.length ? `Standby providers: ${routing.fallbacksAvailable.join(', ')}.` : ''}`.trim(),
    });
    if (!result.request.fallbackModels.length) {
      fixes.push(
        'Optional: add a fallback model so a full outage of this model does not fail your request.',
      );
    }
    return {
      severity: 'ok',
      headline: `Served by ${provider} in ${formatMs(result.latencyMs)}`,
      detail: `${served} answered on the first try${result.gateway?.cost ? ` for ${formatUsd(result.gateway.cost)}` : ''}.`,
      findings,
      fixes,
      docs: { label: 'Reading response metadata', href: `${DOCS}/models-and-providers/provider-filtering-and-ordering` },
    };
  }

  // Something failed, but the gateway recovered. This is the case that is
  // invisible without an inspector: the app "works" while quietly paying a
  // latency tax, using a different model, or billing different credentials.
  const wastedMs = failed.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const modelSwitched = served !== result.request.model;

  for (const f of failed) {
    findings.push({ tone: 'warn', text: explainAttemptFailure(f) });
  }
  if (modelSwitched) {
    findings.push({
      tone: 'warn',
      text: `Your primary model ${result.request.model} failed on every provider. The answer came from fallback model ${served}, so quality, price and context limits may differ.`,
    });
    fixes.push(`Check whether ${served} is an acceptable substitute for this workload, or reorder your fallback list.`);
  }
  if (failed.some((f) => f.credential === 'byok')) {
    fixes.push(
      'Your own provider key (BYOK) was rejected and the gateway fell back to system credentials. Rotate or re-add the BYOK key in AI Gateway settings; until then this traffic is billed to gateway credits and counts toward budgets.',
    );
  }
  if (wastedMs > 0) {
    findings.push({
      tone: 'info',
      text: `Failed attempts added about ${formatMs(wastedMs)} before the successful one.`,
    });
  }
  const failingProviders = unique(failed.filter((f) => f.credential !== 'byok').map((f) => f.provider));
  if (failingProviders.length && !modelSwitched) {
    fixes.push(
      `If ${failingProviders.join(' / ')} keeps failing, move it later in providerOptions.gateway.order, or set sort: 'ttft' so healthier providers go first.`,
    );
  }

  return {
    severity: 'recovered',
    headline: `Recovered after ${failed.length} failed attempt${failed.length > 1 ? 's' : ''}`,
    detail: `The request succeeded via ${provider}${modelSwitched ? ` using fallback model ${served}` : ''}, but not on the first try.`,
    findings,
    fixes,
    docs: modelSwitched
      ? { label: 'Model fallbacks', href: `${DOCS}/models-and-providers/model-fallbacks` }
      : failed.some((f) => f.credential === 'byok')
        ? { label: 'Bring your own key (BYOK)', href: `${DOCS}/authentication-and-byok/byok` }
        : { label: 'Provider ordering', href: `${DOCS}/models-and-providers/provider-filtering-and-ordering` },
  };
}

function explainAttemptFailure(r: TimelineRow): string {
  const where = `${r.provider}${r.credential === 'byok' ? ' (your BYOK key)' : ''}`;
  const code = r.statusCode ? ` (${r.statusCode})` : '';
  const raw = (r.error ?? 'unknown').replace(/\.$/, '');
  const err = raw.toLowerCase();
  if (r.statusCode === 401 || err.includes('unauthorized')) {
    return `${where} rejected the credentials${code}.`;
  }
  if (r.statusCode === 429 || err.includes('rate')) {
    return `${where} was rate limiting${code}.`;
  }
  if ((r.statusCode ?? 0) >= 500 || err.includes('unavailable') || err.includes('internal')) {
    return `${where} had an upstream error${code}: "${raw}".`;
  }
  if (err.includes('timeout')) return `${where} timed out.`;
  return `${where} failed${code}: "${raw}".`;
}

function diagnoseFailure(result: Extract<RunResult, { ok: false }>, catalogIds: string[]): Diagnosis {
  const { error, request } = result;
  const type = error.type ?? '';
  const status = error.statusCode;
  const msg = error.message.toLowerCase();
  const findings: Finding[] = [{ tone: 'error', text: `${error.name}${status ? ` · HTTP ${status}` : ''}: ${error.message}` }];
  for (const r of toTimeline(result.gateway).filter((x) => !x.success)) {
    findings.push({ tone: 'warn', text: explainAttemptFailure(r) });
  }

  if (type === 'authentication_error' || status === 401) {
    return {
      severity: 'failed',
      headline: 'AI Gateway did not accept your credentials',
      detail: 'No provider was called. The request was rejected before routing started.',
      findings,
      fixes: [
        'Create a key in the Vercel dashboard (AI Gateway → API Keys) and add it as AI_GATEWAY_API_KEY in .env.local.',
        'On Vercel, you can skip keys: run `vercel env pull` locally to get a VERCEL_OIDC_TOKEN, and deployments get one automatically.',
        'Restart the dev server after changing env vars, and check that the key has not been revoked.',
      ],
      docs: { label: 'API keys & OIDC', href: `${DOCS}/authentication-and-byok` },
    };
  }

  if (type === 'model_not_found' || (status === 404 && msg.includes('model'))) {
    const suggestion = closest(request.model, catalogIds);
    return {
      severity: 'failed',
      headline: `Model "${request.model}" is not in the catalog`,
      detail: 'Model IDs use the creator/model-name format and must match the catalog exactly.',
      findings,
      fixes: [
        ...(suggestion ? [`Did you mean ${suggestion}?`] : []),
        'Browse valid IDs at vercel.com/ai-gateway/models or GET https://ai-gateway.vercel.sh/v1/models (no auth needed).',
      ],
      docs: { label: 'Model catalog', href: 'https://vercel.com/ai-gateway/models' },
    };
  }

  if (status === 402 || /budget|insufficient|credit/.test(msg)) {
    return {
      severity: 'failed',
      headline: 'Spend limit reached',
      detail: 'A budget or credit balance stopped this request. Nothing is wrong with the model or providers.',
      findings,
      fixes: [
        'Raise the budget that applies to this team, project, or API key in AI Gateway → Budgets.',
        'Top up credits or turn on auto-recharge so production traffic does not stop suddenly.',
        'Or bring your own provider key (BYOK): BYOK spend is metered separately from gateway budgets.',
      ],
      docs: { label: 'Budgets', href: `${DOCS}/observability-and-spend/budgets` },
    };
  }

  if (type === 'rate_limit_exceeded' || status === 429) {
    return {
      severity: 'failed',
      headline: 'Rate limited',
      detail: 'Too many requests in a short window, and no fallback was able to absorb them.',
      findings,
      fixes: [
        'Retry with exponential backoff (the AI SDK does this when maxRetries > 0).',
        request.fallbackModels.length
          ? 'Your fallback models were rate limited too. Add one from a different creator.'
          : 'Add fallback models (providerOptions.gateway.models) so traffic can spill over.',
      ],
      docs: { label: 'Handling 429s', href: `${DOCS}/rate-limits` },
    };
  }

  if (type === 'forbidden' || status === 403) {
    return {
      severity: 'failed',
      headline: 'Blocked by a team policy',
      detail: 'A routing rule or access policy on your team stopped this model or provider.',
      findings,
      fixes: [
        'Check AI Gateway → Routing rules and access policies for a rule that matches this model.',
        'Ask a team owner whether this model is allowed for this project or key.',
      ],
      docs: { label: 'Security & compliance', href: `${DOCS}/security-and-compliance` },
    };
  }

  if (type === 'invalid_request_error' || status === 400) {
    const orderHint = request.providerOrder.length
      ? [`Check that at least one of [${request.providerOrder.join(', ')}] actually serves ${request.model}. Provider slugs are listed on the model's page.`]
      : [];
    return {
      severity: 'failed',
      headline: 'The gateway rejected the request shape',
      detail: 'Something in the request is not valid for this model.',
      findings,
      fixes: [...orderHint, 'Remove optional parameters one at a time to find the one the model does not support.'],
      docs: { label: 'Provider options', href: `${DOCS}/models-and-providers/provider-options` },
    };
  }

  if (type === 'failed_dependency' || status === 424) {
    return {
      severity: 'failed',
      headline: 'Feature not available on this provider or credential',
      detail: 'The request needs something the serving provider or your credentials do not support. Retrying will not help.',
      findings,
      fixes: ['Restrict routing to a provider that supports the feature (providerOptions.gateway.only), or remove the feature.'],
      docs: { label: 'Provider options', href: `${DOCS}/models-and-providers/provider-options` },
    };
  }

  return {
    severity: 'failed',
    headline: 'Every provider failed',
    detail: 'The gateway tried every provider it could and none returned a response.',
    findings,
    fixes: [
      request.fallbackModels.length
        ? 'Your fallback models failed too. Add one from a different creator so one company’s outage cannot take you down.'
        : 'Add fallback models from another creator (providerOptions.gateway.models).',
      'Check the model page for provider uptime, and retry with backoff.',
    ],
    docs: { label: 'Model fallbacks', href: `${DOCS}/models-and-providers/model-fallbacks` },
  };
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Closest catalog ID by edit distance, used for "did you mean" on typos. */
export function closest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(input.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  // Only suggest when it is plausibly a typo, not a different model.
  return best && bestScore <= Math.max(3, Math.floor(input.length * 0.2)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
