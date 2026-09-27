import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closest, diagnose, toTimeline } from './diagnose';
import { demoResult, FALLBACK_CATALOG, SCENARIOS, SCENARIO_REQUESTS } from './fixtures';
import { aiSdkSnippet, curlSnippet } from './snippet';
import type { ScenarioId } from './types';

const ids = FALLBACK_CATALOG.map((m) => m.id);
const run = (id: ScenarioId) =>
  demoResult({ ...SCENARIO_REQUESTS[id], prompt: 'hi', scenario: id });

test('every scenario produces a diagnosis with a headline and a docs link', () => {
  for (const s of SCENARIOS) {
    const d = diagnose(run(s.id), ids);
    assert.ok(d.headline.length > 0, s.id);
    assert.ok(d.docs?.href.startsWith('https://'), s.id);
  }
});

test('clean success is ok', () => {
  assert.equal(diagnose(run('success'), ids).severity, 'ok');
});

test('provider fallback is "recovered", not "ok"', () => {
  const d = diagnose(run('provider-fallback'), ids);
  assert.equal(d.severity, 'recovered');
  assert.match(d.findings.map((f) => f.text).join(' '), /bedrock.*503/);
});

test('BYOK failure tells you traffic is billed to gateway credits', () => {
  const d = diagnose(run('byok-fallback'), ids);
  assert.equal(d.severity, 'recovered');
  assert.ok(d.fixes.some((f) => /BYOK/.test(f) && /credits/.test(f)));
});

test('model fallback flags that a different model answered', () => {
  const d = diagnose(run('model-fallback'), ids);
  assert.ok(d.findings.some((f) => /fallback model anthropic\/claude-opus-5/.test(f.text)));
});

test('failures map to the right cause', () => {
  assert.match(diagnose(run('auth'), ids).headline, /credentials/);
  assert.match(diagnose(run('rate-limit'), ids).headline, /Rate limited/);
  assert.match(diagnose(run('budget'), ids).headline, /Spend limit/);
});

test('model typo suggests the real ID', () => {
  const d = diagnose(run('model-typo'), ids);
  assert.ok(d.fixes[0].includes('anthropic/claude-sonnet-5'));
});

test('closest() does not suggest unrelated models', () => {
  assert.equal(closest('anthropic/claude-sonet-5', ids), 'anthropic/claude-sonnet-5');
  assert.equal(closest('mistral/some-other-thing', ids), undefined);
});

test('timeline durations work with both metadata timing formats', () => {
  const byok = toTimeline(run('byok-fallback').gateway);
  assert.equal(byok[0].durationMs, 190); // startTime/endTime
  const mf = toTimeline(run('model-fallback').gateway);
  assert.equal(Math.round(mf[0].durationMs!), 15680); // responseTimeMs
});

test('snippets include routing options only when set', () => {
  const plain = { model: 'a/b', prompt: 'hi', fallbackModels: [], providerOrder: [] };
  assert.ok(!aiSdkSnippet(plain).includes('providerOptions'));
  const routed = { ...plain, providerOrder: ['bedrock'], fallbackModels: ['c/d'] };
  assert.ok(aiSdkSnippet(routed).includes('"order"'));
  assert.ok(curlSnippet(routed).includes('"models"'));
});
