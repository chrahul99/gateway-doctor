'use client';

import { useState } from 'react';
import { toTimeline, type Diagnosis, type TimelineRow } from '@/lib/diagnose';
import { formatMs, formatTokens, formatUsd } from '@/lib/format';
import { aiSdkSnippet, cliSnippet, curlSnippet } from '@/lib/snippet';
import type { RunResult } from '@/lib/types';

type Props = { result: RunResult | null; diagnosis: Diagnosis | null; loading: boolean; live: boolean };

export function Inspector({ result, diagnosis, loading, live }: Props) {
  if (!result || !diagnosis) {
    return (
      <section className="card" aria-labelledby="insp-title">
        <div className="card-head"><h2 id="insp-title">Inspector</h2></div>
        {loading ? (
          <Loading />
        ) : (
          <div className="empty">
            <h2>Send a request to see what really happened</h2>
            <p>Every response from AI Gateway carries a routing report. This page turns it into answers:</p>
            <ol>
              <li>Which provider served it, and how long it took</li>
              <li>What failed on the way, and what that cost you</li>
              <li>What to change, with the exact code to reproduce it</li>
            </ol>
            {!live ? <p className="hint" style={{ marginTop: 16 }}>No API key found, so requests use demo scenarios.</p> : null}
          </div>
        )}
      </section>
    );
  }

  const timeline = toTimeline(result.gateway);
  const routing = result.gateway?.routing;
  const servedBy = result.ok ? routing?.finalProvider ?? routing?.resolvedProvider : undefined;

  return (
    <section className="stack" aria-labelledby="verdict-title" aria-busy={loading}>
      <div className={`verdict ${diagnosis.severity}`} role="status">
        <VerdictIcon severity={diagnosis.severity} />
        <div>
          <h2 id="verdict-title">{diagnosis.headline}</h2>
          <p>{diagnosis.detail}</p>
        </div>
      </div>

      {result.mode === 'demo' ? (
        <p className="demo-note">
          <span className="dot" aria-hidden="true" />
          Sample data from a demo scenario. No model was called and nothing was billed.
        </p>
      ) : null}

      <dl className="stats">
        <div className="stat"><dt>Latency</dt><dd>{formatMs(result.latencyMs)}</dd></div>
        <div className="stat">
          <dt>Tokens</dt>
          <dd>
            {result.ok ? (
              <>{formatTokens(result.usage.inputTokens)} <small>in</small> · {formatTokens(result.usage.outputTokens)} <small>out</small></>
            ) : '—'}
          </dd>
        </div>
        <div className="stat"><dt>Cost</dt><dd>{formatUsd(result.gateway?.cost)}</dd></div>
        <div className="stat"><dt>Served by</dt><dd title={servedBy}>{servedBy ?? '—'}</dd></div>
      </dl>

      {timeline.length ? (
        <div className="card">
          <div className="card-head">
            <h2>Routing</h2>
            <span className="hint">{timeline.length} attempt{timeline.length > 1 ? 's' : ''}</span>
          </div>
          <div className="card-body"><Timeline rows={timeline} /></div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head"><h2>Diagnosis</h2></div>
        <div className="card-body stack">
          {diagnosis.findings.length ? (
            <div>
              <p className="section-title">What happened</p>
              <ul className="findings">
                {diagnosis.findings.map((f, i) => (
                  <li key={i} className={f.tone}><span>{f.text}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          {diagnosis.fixes.length ? (
            <div>
              <p className="section-title">What to do</p>
              <ol className="fixes">
                {diagnosis.fixes.map((f, i) => <li key={i}>{f}</li>)}
              </ol>
            </div>
          ) : null}
          {diagnosis.docs ? (
            <a className="docs-link" href={diagnosis.docs.href} target="_blank" rel="noreferrer">
              Docs: {diagnosis.docs.label} ↗
            </a>
          ) : null}
        </div>
      </div>

      <Tabs result={result} />
      {loading ? <p className="sr-only" aria-live="polite">Sending request…</p> : null}
    </section>
  );
}

function Timeline({ rows }: { rows: TimelineRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.durationMs ?? 0));
  return (
    <ol className="timeline">
      {rows.map((r, i) => {
        const switched = i > 0 && rows[i - 1].model !== r.model;
        return (
          <li key={i}>
            {switched ? <p className="tl-model-switch">↳ Switched to fallback model</p> : null}
            <div className="tl-row">
              <span className={`tl-mark ${r.success ? 'ok' : 'fail'}`} aria-hidden="true">{r.success ? '✓' : '✕'}</span>
              <div>
                <div className="tl-top">
                  <span className="provider">{r.provider}</span>
                  <span className="model">{r.model}</span>
                  {r.credential ? <span className="chip">{r.credential === 'byok' ? 'your key (BYOK)' : 'system key'}</span> : null}
                  <span className="dur">{formatMs(r.durationMs)}</span>
                  <span className="sr-only">{r.success ? 'succeeded' : 'failed'}</span>
                </div>
                <div className="tl-bar" aria-hidden="true">
                  <span className={r.success ? 'ok' : 'fail'} style={{ width: `${Math.max(2, ((r.durationMs ?? 0) / max) * 100)}%` }} />
                </div>
                {!r.success ? (
                  <p className="tl-err">{r.statusCode ? `${r.statusCode} · ` : ''}{r.error ?? 'Failed'}</p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type TabId = 'output' | 'sdk' | 'curl' | 'cli' | 'raw';

function Tabs({ result }: { result: RunResult }) {
  const tabs: { id: TabId; label: string }[] = [
    ...(result.ok ? [{ id: 'output' as const, label: 'Response' }] : []),
    { id: 'sdk', label: 'AI SDK' },
    { id: 'curl', label: 'cURL' },
    { id: 'cli', label: 'CLI' },
    { id: 'raw', label: 'Raw metadata' },
  ];
  const [active, setActive] = useState<TabId>(result.ok ? 'output' : 'sdk');
  const current = tabs.some((t) => t.id === active) ? active : tabs[0].id;

  const content: Record<TabId, string> = {
    output: result.ok ? result.text : '',
    sdk: aiSdkSnippet(result.request),
    curl: curlSnippet(result.request),
    cli: cliSnippet(result.request),
    raw: JSON.stringify(result.ok ? result.gateway ?? {} : { error: result.error, gateway: result.gateway }, null, 2),
  };

  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setActive(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  }

  return (
    <div className="card">
      <div className="tabs" role="tablist" aria-label="Request details">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            className="tab"
            aria-selected={current === t.id}
            aria-controls="tab-panel"
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel" id="tab-panel" role="tabpanel" aria-labelledby={`tab-${current}`}>
        {current === 'output' ? (
          <div className="output">{content.output}</div>
        ) : (
          <>
            <CopyButton text={content[current]} />
            <pre><code>{content[current]}</code></pre>
          </>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard can be blocked; the text is still selectable */
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Loading() {
  return (
    <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Sending request…</div>
  );
}

function VerdictIcon({ severity }: { severity: Diagnosis['severity'] }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, className: 'icon', 'aria-hidden': true } as const;
  if (severity === 'ok') return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></svg>;
  if (severity === 'recovered') return <svg {...common}><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v5M12 18h.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></svg>;
}
