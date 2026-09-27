import type { RunRequest } from './types';

/**
 * The inspector's "Code" tab: the exact request, reproducible outside the app.
 * Showing the same request in three mediums (SDK, HTTP, CLI) is deliberate:
 * a developer debugging in a terminal should not have to translate from a UI.
 */

function gatewayOptions(req: RunRequest) {
  const g: Record<string, string[]> = {};
  if (req.providerOrder.length) g.order = req.providerOrder;
  if (req.fallbackModels.length) g.models = req.fallbackModels;
  return g;
}

export function aiSdkSnippet(req: RunRequest): string {
  const g = gatewayOptions(req);
  const opts = Object.keys(g).length
    ? `\n  providerOptions: {\n    gateway: ${JSON.stringify(g, null, 2).replace(/\n/g, '\n    ')},\n  },`
    : '';
  return `import { generateText } from 'ai';

const result = await generateText({
  model: '${req.model}',
  prompt: ${JSON.stringify(req.prompt)},${opts}
});

console.log(result.text);
// Who served it, what failed on the way, what it cost:
console.log(result.providerMetadata?.gateway);`;
}

export function curlSnippet(req: RunRequest): string {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: [{ role: 'user', content: req.prompt }],
  };
  const g = gatewayOptions(req);
  if (Object.keys(g).length) body.providerOptions = { gateway: g };
  const json = JSON.stringify(body, null, 2).replace(/'/g, "'\\''");
  return `curl https://ai-gateway.vercel.sh/v1/chat/completions \\
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
}

export function cliSnippet(req: RunRequest): string {
  const parts = ['npx tsx cli/doctor.ts', JSON.stringify(req.prompt), `--model ${req.model}`];
  if (req.fallbackModels.length) parts.push(`--fallback ${req.fallbackModels.join(',')}`);
  if (req.providerOrder.length) parts.push(`--order ${req.providerOrder.join(',')}`);
  if (req.scenario) parts.push(`--scenario ${req.scenario}`);
  return parts.join(' \\\n  ');
}
