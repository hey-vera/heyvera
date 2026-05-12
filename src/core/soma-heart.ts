import fs from 'node:fs';
import path from 'node:path';
import { createSomaHeart, loadSomaHeart, type HeartRuntime } from 'soma-heart';
import { createGenome, commitGenome } from 'soma-heart/core';
import { getCryptoProvider } from 'soma-heart/crypto-provider';
import { env } from '../config/index';
import { logger } from '../utils/logger';

const DEFAULT_HEART_PATH = path.resolve(process.cwd(), 'data/clawnet-heart.json');

let _heart: HeartRuntime | null = null;

export function getHeart(): HeartRuntime {
  if (!_heart) throw new Error('Soma heart not initialized — call initSomaHeart() first');
  return _heart;
}

export async function initSomaHeart(): Promise<void> {
  const secret = process.env.CLAWNET_HEART_SECRET;
  if (!secret) {
    logger.warn('CLAWNET_HEART_SECRET not set — Soma heart disabled (identity features unavailable)');
    return;
  }

  const heartPath = process.env.CLAWNET_HEART_PATH ?? DEFAULT_HEART_PATH;

  if (fs.existsSync(heartPath)) {
    const blob = fs.readFileSync(heartPath, 'utf-8');
    _heart = loadSomaHeart(blob, secret);
    logger.info({ did: _heart.did }, 'Soma heart loaded');
    if (_heart.lineage) {
      logger.info(
        { rootDid: _heart.lineage.rootDid, chainLength: _heart.lineage.chain.length },
        'Soma heart carries lineage',
      );
    }
    return;
  }

  // First boot: generate a fresh Ed25519 identity and persist it.
  const provider = getCryptoProvider();
  const signingKeyPair = provider.signing.generateKeyPair();
  const genome = createGenome({
    modelProvider: 'anthropic',
    modelId: env.ANTHROPIC_MODEL,
    modelVersion: '1',
    systemPrompt: 'ClawNet root heart — identity issuer',
    toolManifest: '{}',
    runtimeId: 'clawnet-root',
  });
  const commitment = commitGenome(genome, signingKeyPair, provider);

  _heart = createSomaHeart({
    genome: commitment,
    signingKeyPair,
    modelApiKey: env.ANTHROPIC_API_KEY ?? '',
    modelBaseUrl: 'https://api.anthropic.com/v1',
    modelId: env.ANTHROPIC_MODEL,
  });

  const dir = path.dirname(heartPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // mode 0o600: owner read/write only — this file contains the encrypted signing key
  fs.writeFileSync(heartPath, _heart.serialize(secret), { encoding: 'utf-8', mode: 0o600 });
  logger.info({ did: _heart.did, path: heartPath }, 'Soma heart created and persisted');
}
