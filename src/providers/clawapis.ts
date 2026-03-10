import { logger } from '../utils/logger';
import { env } from '../config/index';

let x402Client: { fetch: (input: string, init?: RequestInit) => Promise<Response> } | null = null;

export async function initClawApis(): Promise<boolean> {
  const privateKey = env.SOLANA_PRIVATE_KEY;
  if (!privateKey) return false;

  try {
    const { createX402Client } = await import('x402-solana');
    const { Keypair, VersionedTransaction } = await import('@solana/web3.js');
    const bs58 = await import('bs58');

    const keypair = Keypair.fromSecretKey(bs58.default.decode(privateKey));

    const wallet = {
      publicKey: { toString: () => keypair.publicKey.toBase58() },
      signTransaction: async (tx: InstanceType<typeof VersionedTransaction>) => {
        tx.sign([keypair]);
        return tx;
      },
    };

    x402Client = createX402Client({
      wallet,
      network: 'solana',
    });

    logger.info({ wallet: keypair.publicKey.toBase58() }, 'ClawAPIs x402 initialized');
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize ClawAPIs x402');
    return false;
  }
}

export function isClawApisReady(): boolean {
  return x402Client !== null;
}

/**
 * Make an x402-paid API call to any provider.
 * The x402 client handles payment automatically for any URL that returns 402.
 * @param endpointPath  — URL path (e.g. '/api/price') or full URL
 * @param params        — query string parameters
 * @param baseUrlOverride — provider base URL (overrides clawapis.com for multi-provider routing)
 */
export async function clawApiCall(
  endpointPath: string,
  params: Record<string, unknown> = {},
  baseUrlOverride?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!x402Client) throw new Error('ClawAPIs x402 not initialized');

  // If endpointPath is already a full URL, use it directly
  const isFullUrl = endpointPath.startsWith('http');
  const base = isFullUrl ? '' : (baseUrlOverride ?? env.CLAWAPIS_BASE_URL ?? 'https://clawapis.com');
  const url = new URL(isFullUrl ? endpointPath : endpointPath, base || 'https://clawapis.com');

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await x402Client.fetch(url.toString(), signal ? { signal } : undefined);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`x402 call error ${res.status} from ${url.hostname}: ${text.slice(0, 200)}`);
  }

  return res.json();
}
