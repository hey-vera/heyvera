/**
 * Base chain USDC payout utility (Option C lite — x402 auto-split).
 *
 * When a skill is invoked via x402 and the creator has set a `creator_evm_wallet`,
 * this function fires a 97% USDC split to that address on Base mainnet.
 *
 * Uses viem. Requires EVM_PRIVATE_KEY (hex or 0x-prefixed) in env.
 * USDC on Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */

import { createWalletClient, createPublicClient, http, parseUnits, type Address } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { logger } from './logger';
import { env } from '../config/index';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const USDC_DECIMALS = 6;

// Minimal ERC-20 transfer ABI
const ERC20_ABI = [
  {
    type: 'function' as const,
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  },
] as const;

function getWalletClient() {
  const raw = env.EVM_PRIVATE_KEY;
  if (!raw) throw new Error('EVM_PRIVATE_KEY not set');
  // Accept both 0x-prefixed and plain hex
  const hex = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
  const account = privateKeyToAccount(hex);
  return createWalletClient({
    account,
    chain: base,
    transport: http(env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  });
}

function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(env.BASE_RPC_URL ?? 'https://mainnet.base.org'),
  });
}

/**
 * Transfer `amountUsdc` USDC on Base mainnet from the platform EVM wallet to `toAddress`.
 * Resolves to tx hash on success. Throws on failure.
 */
export async function sendBaseUsdc(toAddress: string, amountUsdc: number): Promise<string> {
  if (amountUsdc <= 0) throw new Error('Amount must be positive');

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();

  const amount = parseUnits(amountUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);

  const hash = await walletClient.writeContract({
    address: USDC_BASE,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [toAddress as Address, amount],
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  logger.info({ hash, toAddress, amountUsdc }, 'Base USDC split sent');
  return hash;
}
