import { Doctor } from '@/components/Doctor';
import { loadCatalog } from '@/lib/catalog';
import { hasCredentials } from '@/lib/run';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const { models, source } = await loadCatalog();
  return <Doctor catalog={models} catalogSource={source} live={hasCredentials()} />;
}
