import { logger } from '../utils/logger';

let x402Client: { fetch: (input: string, init?: RequestInit) => Promise<Response> } | null = null;

export async function initClawApis(): Promise<boolean> {
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
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

export async function clawApiCall(
  endpointPath: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  if (!x402Client) throw new Error('ClawAPIs not initialized');

  const baseUrl = process.env.X402_X_API_URL ?? 'https://clawapis.com';

  const url = new URL(endpointPath, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await x402Client.fetch(url.toString());

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClawAPIs error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}