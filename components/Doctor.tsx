'use client';

import { useMemo, useRef, useState } from 'react';
import { Inspector } from './Inspector';
import { closest, diagnose } from '@/lib/diagnose';
import { SCENARIOS, SCENARIO_REQUESTS } from '@/lib/fixtures';
import { estimateTokens, formatTokens, formatUsd, perMillion, splitList } from '@/lib/format';
import type { CatalogModel, RunRequest, RunResult, ScenarioId } from '@/lib/types';

type Props = { catalog: CatalogModel[]; catalogSource: 'live' | 'fallback'; live: boolean };
type FieldErrors = Partial<Record<'model' | 'prompt' | 'fallbackModels' | 'providerOrder', string>>;

const DEFAULT_PROMPT = 'Explain what an AI gateway does in one sentence.';

export function Doctor({ catalog, catalogSource, live }: Props) {
  const [model, setModel] = useState('anthropic/claude-sonnet-5');
  const [fallbacks, setFallbacks] = useState('');
  const [order, setOrder] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [scenario, setScenario] = useState<ScenarioId | undefined>(live ? undefined : 'success');
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [networkError, setNetworkError] = useState<string | null>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const ids = useMemo(() => catalog.map((m) => m.id), [catalog]);
  const selected = catalog.find((m) => m.id === model.trim());
  const suggestion = !selected && model.includes('/') ? closest(model.trim(), ids) : undefined;
  const estInput = estimateTokens(prompt);
  const estCost = selected?.pricing?.input ? Number(selected.pricing.input) * estInput : undefined;
  const diagnosis = useMemo(() => (result ? diagnose(result, ids) : null), [result, ids]);

  function currentRequest(overrides?: Partial<RunRequest>): RunRequest {
    return {
      model: model.trim(),
      prompt: prompt.trim(),
      fallbackModels: splitList(fallbacks),
      providerOrder: splitList(order),
      scenario,
      ...overrides,
    };
  }

  async function run(req: RunRequest) {
    setLoading(true);
    setErrors({});
    setNetworkError(null);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const json = await res.json();
      if (!res.ok) {
        // Validation errors belong next to the field that caused them.
        if (json.field) setErrors({ [json.field]: json.message });
        else setNetworkError(json.message ?? `Request failed (${res.status}).`);
        return;
      }
      setResult(json as RunResult);
      // On narrow screens the inspector is below the form; bring it into view.
      if (window.matchMedia('(max-width: 880px)').matches) {
        inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch {
      setNetworkError('Could not reach the app server. Is `npm run dev` still running?');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(currentRequest());
  }

  function pickScenario(id: ScenarioId) {
    const preset = SCENARIO_REQUESTS[id];
    setScenario(id);
    setModel(preset.model);
    setFallbacks(preset.fallbackModels.join(', '));
    setOrder(preset.providerOrder.join(', '));
    run({ ...preset, prompt: prompt.trim() || DEFAULT_PROMPT, scenario: id });
  }

  // Editing the request by hand in live mode means "run this for real".
  function editing<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      if (live) setScenario(undefined);
    };
  }

  return (
    <>
      <a className="skip" href="#inspector">Skip to results</a>
      <header className="header">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2 22 20H2L12 2Z" fill="currentColor" />
          </svg>
          Gateway Doctor <small>for Vercel AI Gateway</small>
        </div>
        <div className="header-right">
          {live ? (
            <span className="badge live"><span className="dot" />Live</span>
          ) : (
            <span className="badge demo" title="Add AI_GATEWAY_API_KEY to .env.local to send real requests">
              <span className="dot" />Demo mode
            </span>
          )}
        </div>
      </header>

      <main className="main">
        <section className="card request" aria-labelledby="req-title">
          <div className="card-head">
            <h2 id="req-title">Request</h2>
            <span className="hint">
              {catalog.length} models{catalogSource === 'fallback' ? ' (offline list)' : ''}
            </span>
          </div>
          <form className="card-body stack" onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                type="text"
                className="mono"
                list="model-list"
                value={model}
                onChange={(e) => editing(setModel)(e.target.value)}
                aria-invalid={Boolean(errors.model) || undefined}
                aria-describedby="model-meta"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="model-list">
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </datalist>
              <div id="model-meta" aria-live="polite">
                {errors.model ? (
                  <p className="field-error">{errors.model}</p>
                ) : selected ? (
                  <div className="model-meta">
                    {selected.context_window ? <span className="chip"><b>{formatTokens(selected.context_window)}</b> context</span> : null}
                    {selected.pricing?.input ? <span className="chip"><b>{perMillion(selected.pricing.input)}</b>/M in</span> : null}
                    {selected.pricing?.output ? <span className="chip"><b>{perMillion(selected.pricing.output)}</b>/M out</span> : null}
                    {(selected.tags ?? []).slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}
                  </div>
                ) : suggestion ? (
                  // Catch the most common first-request mistake before it costs a round trip.
                  <p className="field-error">
                    Not in the catalog. Did you mean{' '}
                    <button type="button" className="btn btn-sm" onClick={() => editing(setModel)(suggestion)}>
                      {suggestion}
                    </button>
                    ?
                  </p>
                ) : model.trim() ? (
                  <p className="hint">Not in the catalog. Model IDs look like creator/model-name.</p>
                ) : null}
              </div>
            </div>

            <div className="field">
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    run(currentRequest());
                  }
                }}
                aria-invalid={Boolean(errors.prompt) || undefined}
                aria-describedby="prompt-hint"
              />
              {errors.prompt ? (
                <p className="field-error" id="prompt-hint">{errors.prompt}</p>
              ) : (
                <p className="hint" id="prompt-hint">
                  ~{estInput} input tokens{estCost !== undefined ? ` · about ${formatUsd(estCost)} before output` : ''}
                </p>
              )}
            </div>

            <details className="advanced" open={Boolean(fallbacks || order)}>
              <summary>Routing (optional)</summary>
              <div className="stack">
                <div className="field">
                  <label htmlFor="fallbacks">Fallback models</label>
                  <input
                    id="fallbacks"
                    type="text"
                    className="mono"
                    placeholder="anthropic/claude-opus-5, openai/gpt-6-astra"
                    value={fallbacks}
                    onChange={(e) => editing(setFallbacks)(e.target.value)}
                    aria-invalid={Boolean(errors.fallbackModels) || undefined}
                    aria-describedby="fallbacks-hint"
                    spellCheck={false}
                  />
                  <p className={errors.fallbackModels ? 'field-error' : 'hint'} id="fallbacks-hint">
                    {errors.fallbackModels ?? 'Tried in order if the primary model fails on every provider.'}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="order">Provider order</label>
                  <input
                    id="order"
                    type="text"
                    className="mono"
                    placeholder="bedrock, anthropic"
                    value={order}
                    onChange={(e) => editing(setOrder)(e.target.value)}
                    aria-invalid={Boolean(errors.providerOrder) || undefined}
                    aria-describedby="order-hint"
                    spellCheck={false}
                  />
                  <p className={errors.providerOrder ? 'field-error' : 'hint'} id="order-hint">
                    {errors.providerOrder ?? 'Providers to try first. Others remain available after these.'}
                  </p>
                </div>
              </div>
            </details>

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Sending…' : live && !scenario ? 'Send request' : 'Run demo'} <kbd>⌘↵</kbd>
            </button>
            {networkError ? <p className="field-error" role="alert">{networkError}</p> : null}

            <div className="field">
              <span className="section-title" id="scn-title">
                {live ? 'Or replay a known scenario' : 'Try a scenario'}
              </span>
              <div className="scenarios" role="group" aria-labelledby="scn-title">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="scenario"
                    aria-pressed={scenario === s.id}
                    onClick={() => pickScenario(s.id)}
                  >
                    <strong>{s.label}</strong>
                    <span>{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </form>
        </section>

        <div id="inspector" ref={inspectorRef} tabIndex={-1}>
          <Inspector result={result} diagnosis={diagnosis} loading={loading} live={live} />
        </div>
      </main>
    </>
  );
}
