import { loadCatalog } from '@/lib/catalog';
import { hasCredentials } from '@/lib/run';

export async function GET() {
  const catalog = await loadCatalog();
  return Response.json({ ...catalog, live: hasCredentials() });
}
