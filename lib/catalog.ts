import { FALLBACK_CATALOG } from './fixtures';
import type { CatalogModel } from './types';

const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';

/** Public catalog, no auth needed. Cached for an hour on the server. */
export async function loadCatalog(): Promise<{ models: CatalogModel[]; source: 'live' | 'fallback' }> {
  try {
    const res = await fetch(MODELS_URL, { next: { revalidate: 3600 } } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: (CatalogModel & { type?: string })[] };
    const models = json.data
      .filter((m) => !m.type || m.type === 'language')
      .map(({ id, name, owned_by, context_window, max_tokens, tags, pricing }) => ({
        id, name, owned_by, context_window, max_tokens, tags,
        pricing: pricing ? { input: pricing.input, output: pricing.output } : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models, source: 'live' };
  } catch {
    return { models: FALLBACK_CATALOG, source: 'fallback' };
  }
}
