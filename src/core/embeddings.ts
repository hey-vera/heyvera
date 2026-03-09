import { logger } from '../utils/logger';

type Pipeline = (text: string | string[], opts?: Record<string, unknown>) => Promise<{ data: Float32Array }[]>;

let _pipeline: Pipeline | null = null;
let _loading = false;
let _loadPromise: Promise<void> | null = null;

export async function loadEmbeddingModel(): Promise<void> {
  if (_pipeline) return;
  if (_loadPromise) return _loadPromise;

  _loading = true;
  _loadPromise = (async () => {
    try {
      // Dynamic import — ESM-only package, tsx handles interop
      const { pipeline, env } = await import('@huggingface/transformers');
      // Cache model locally in data/models to avoid re-downloading
      env.cacheDir = './data/models';
      _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as Pipeline;
      logger.info('Embedding model loaded: all-MiniLM-L6-v2');
    } catch (err) {
      logger.error({ err }, 'Failed to load embedding model');
      throw err;
    } finally {
      _loading = false;
    }
  })();

  return _loadPromise;
}

export function isEmbeddingModelReady(): boolean {
  return _pipeline !== null;
}

export async function embed(text: string): Promise<Float32Array> {
  if (!_pipeline) await loadEmbeddingModel();
  const output = await _pipeline!(text, { pooling: 'mean', normalize: true });
  return output[0].data;
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (!_pipeline) await loadEmbeddingModel();
  const outputs = await _pipeline!(texts, { pooling: 'mean', normalize: true });
  return outputs.map(o => o.data);
}
