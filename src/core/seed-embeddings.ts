import { apiRegistry } from '../config/api-registry';
import { embed } from './embeddings';
import { upsertDiscovery, getDiscoveryCacheIds } from '../db/index';
import { logger } from '../utils/logger';

export async function seedEmbeddings(): Promise<void> {
  const existing = new Set(getDiscoveryCacheIds());
  const toSeed = apiRegistry.filter(ep => !existing.has(ep.id));

  if (toSeed.length === 0) {
    logger.info('Embeddings: all endpoints already seeded');
    return;
  }

  logger.info({ count: toSeed.length }, 'Seeding embeddings for endpoints');

  let seeded = 0;
  for (const ep of toSeed) {
    try {
      const text = `${ep.name}: ${ep.description}`;
      const embedding = await embed(text);
      upsertDiscovery({
        id: ep.id,
        skillName: ep.name,
        skillDesc: ep.description,
        provider: ep.provider,
        embedding,
      });
      seeded++;
    } catch (err) {
      logger.warn({ err, id: ep.id }, 'Failed to embed endpoint — skipping');
    }
  }

  logger.info({ seeded }, 'Embedding seeding complete');
}
