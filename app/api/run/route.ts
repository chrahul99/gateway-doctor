import { runRequest } from '@/lib/run';
import { SCENARIOS } from '@/lib/fixtures';
import type { RunRequest, ScenarioId } from '@/lib/types';

export const maxDuration = 60;

const MAX_PROMPT = 4000;
const MODEL_ID = /^[a-z0-9-]+\/[a-z0-9._:-]+$/i;
const SLUG = /^[a-z0-9-]+$/i;

export async function POST(request: Request) {
  let body: Partial<RunRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: 'Body must be JSON.' }, { status: 400 });
  }

  const model = String(body.model ?? '').trim();
  const prompt = String(body.prompt ?? '').trim();
  const fallbackModels = (body.fallbackModels ?? []).map(String).slice(0, 5);
  const providerOrder = (body.providerOrder ?? []).map(String).slice(0, 8);
  const scenario = SCENARIOS.some((s) => s.id === body.scenario) ? (body.scenario as ScenarioId) : undefined;

  // Validate here so a malformed request never reaches the gateway, and the
  // message says which field to fix.
  if (!MODEL_ID.test(model)) {
    return Response.json({ field: 'model', message: 'Use the creator/model-name format, e.g. anthropic/claude-sonnet-5.' }, { status: 400 });
  }
  if (!prompt) return Response.json({ field: 'prompt', message: 'Write a prompt to send.' }, { status: 400 });
  if (prompt.length > MAX_PROMPT) {
    return Response.json({ field: 'prompt', message: `Keep prompts under ${MAX_PROMPT} characters.` }, { status: 400 });
  }
  const badFallback = fallbackModels.find((m) => !MODEL_ID.test(m));
  if (badFallback) return Response.json({ field: 'fallbackModels', message: `"${badFallback}" is not a model ID.` }, { status: 400 });
  const badSlug = providerOrder.find((p) => !SLUG.test(p));
  if (badSlug) return Response.json({ field: 'providerOrder', message: `"${badSlug}" is not a provider slug.` }, { status: 400 });

  const result = await runRequest({ model, prompt, fallbackModels, providerOrder, scenario });
  return Response.json(result);
}
