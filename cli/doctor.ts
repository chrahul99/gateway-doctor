#!/usr/bin/env -S npx tsx
/**
 * Gateway Doctor, terminal edition.
 *
 *   npx tsx cli/doctor.ts "Say hi" --model anthropic/claude-sonnet-5
 *   npx tsx cli/doctor.ts "Say hi" --scenario model-fallback
 *   npx tsx cli/doctor.ts "Say hi" --model openai/gpt-6-astra --json | jq
 *
 * Uses the same runner and diagnosis as the web UI, so both surfaces agree.
 * Exit codes: 0 ok, 1 recovered (succeeded after failures), 2 failed.
 */
import { parseArgs } from 'node:util';
import { runRequest } from '../lib/run';
import { diagnose, toTimeline } from '../lib/diagnose';
import { formatMs, formatTokens, formatUsd, splitList } from '../lib/format';
import { FALLBACK_CATALOG, SCENARIOS, SCENARIO_REQUESTS } from '../lib/fixtures';
import type { ScenarioId } from '../lib/types';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string', short: 'm' },
    fallback: { type: 'string', short: 'f' },
    order: { type: 'string', short: 'o' },
    scenario: { type: 'string', short: 's' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && !values.json;
const c = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c(32), yellow = c(33), red = c(31), dim = c(2), bold = c(1);

if (values.help || positionals.length === 0) {
  console.log(`${bold('gateway-doctor')} "<prompt>" [options]

  -m, --model      Model ID (default anthropic/claude-sonnet-5)
  -f, --fallback   Fallback models, comma separated
  -o, --order      Provider order, comma separated
  -s, --scenario   Replay a demo scenario: ${SCENARIOS.map((s) => s.id).join(', ')}
      --json       Print the raw result and diagnosis as JSON

Set AI_GATEWAY_API_KEY for live requests; otherwise demo scenarios are used.`);
  process.exit(positionals.length === 0 && !values.help ? 2 : 0);
}

if (values.scenario && !SCENARIOS.some((s) => s.id === values.scenario)) {
  console.error(red(`Unknown scenario "${values.scenario}".`));
  process.exit(2);
}

// A scenario brings its own preset request; explicit flags still win.
const scenario = values.scenario as ScenarioId | undefined;
const preset = scenario ? SCENARIO_REQUESTS[scenario] : undefined;
const result = await runRequest({
  model: values.model ?? preset?.model ?? 'anthropic/claude-sonnet-5',
  prompt: positionals.join(' '),
  fallbackModels: values.fallback !== undefined ? splitList(values.fallback) : preset?.fallbackModels ?? [],
  providerOrder: values.order !== undefined ? splitList(values.order) : preset?.providerOrder ?? [],
  scenario,
});
const d = diagnose(result, FALLBACK_CATALOG.map((m) => m.id));

if (values.json) {
  console.log(JSON.stringify({ result, diagnosis: d }, null, 2));
} else {
  const tone = d.severity === 'ok' ? green : d.severity === 'recovered' ? yellow : red;
  const icon = d.severity === 'ok' ? '✓' : d.severity === 'recovered' ? '!' : '✕';
  console.log();
  console.log(`${tone(`${icon} ${d.headline}`)}${result.mode === 'demo' ? dim('  (demo)') : ''}`);
  console.log(dim(`  ${d.detail}`));
  console.log();

  const routing = result.gateway?.routing;
  const stats = [
    `latency ${bold(formatMs(result.latencyMs))}`,
    result.ok ? `tokens ${bold(formatTokens(result.usage.inputTokens))} in / ${bold(formatTokens(result.usage.outputTokens))} out` : null,
    `cost ${bold(formatUsd(result.gateway?.cost))}`,
    result.ok ? `served by ${bold(routing?.finalProvider ?? '—')}` : null,
  ].filter(Boolean);
  console.log(`  ${stats.join(dim('  ·  '))}`);

  const rows = toTimeline(result.gateway);
  if (rows.length) {
    console.log();
    console.log(bold('  Routing'));
    const width = Math.max(...rows.map((r) => r.provider.length));
    rows.forEach((r, i) => {
      if (i > 0 && rows[i - 1].model !== r.model) console.log(dim('    ↳ switched to fallback model'));
      const mark = r.success ? green('✓') : red('✕');
      const cred = r.credential === 'byok' ? yellow(' byok') : '';
      const err = r.success ? '' : red(`  ${r.statusCode ?? ''} ${r.error ?? ''}`.trimEnd());
      console.log(`    ${mark} ${r.provider.padEnd(width)}  ${dim(r.model)}${cred}  ${formatMs(r.durationMs)}${err}`);
    });
  }

  const notes = d.findings.filter((f) => f.tone !== 'info' || d.severity === 'ok');
  if (notes.length) {
    console.log();
    console.log(bold('  What happened'));
    notes.forEach((f) => console.log(`    ${f.tone === 'error' ? red('•') : f.tone === 'warn' ? yellow('•') : dim('•')} ${f.text}`));
  }

  if (d.fixes.length) {
    console.log();
    console.log(bold('  What to do'));
    d.fixes.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  }
  if (d.docs) console.log(dim(`\n  Docs: ${d.docs.href}`));
  if (result.ok) console.log(`\n${dim('  Response')}\n  ${result.text.replace(/\n/g, '\n  ')}`);
  console.log();
}

process.exit(d.severity === 'ok' ? 0 : d.severity === 'recovered' ? 1 : 2);
