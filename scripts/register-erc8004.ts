/**
 * One-time script: Register AID Protocol + ClawNet on ERC-8004 (Base Mainnet).
 *
 * Mints TWO ERC-721 NFTs on the IdentityRegistry:
 *   1. AID Protocol — the open trust protocol
 *   2. ClawNet — the reference implementation / platform
 *
 * Cost: ~$0.02-0.10 total (two mint transactions on Base).
 *
 * Prerequisites:
 *   - EVM_PRIVATE_KEY in .env (Base wallet with ~0.001 ETH)
 *   - Deploy ClawNet first so the registration JSON endpoints are live
 *
 * Run: npx tsx scripts/register-erc8004.ts
 */

import { config } from 'dotenv';
config();

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const REGISTRATIONS = [
  {
    name: 'AID Protocol',
    uri: 'https://api.claw-net.org/.well-known/aid-registration.json',
  },
  {
    name: 'ClawNet',
    uri: 'https://api.claw-net.org/.well-known/erc8004-registration.json',
  },
];

const abi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed agentWallet)',
]);

async function main() {
  const key = process.env.EVM_PRIVATE_KEY;
  if (!key) {
    console.error('Set EVM_PRIVATE_KEY in .env (Base wallet with ~0.001 ETH for gas).');
    process.exit(1);
  }

  const account = privateKeyToAccount(key as `0x${string}`);

  console.log(`\n  ERC-8004 Identity Registry — Base Mainnet`);
  console.log(`  Registry: ${IDENTITY_REGISTRY}`);
  console.log(`  Wallet:   ${account.address}`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  const ethBalance = Number(balance) / 1e18;
  console.log(`  Balance:  ${ethBalance.toFixed(6)} ETH\n`);

  if (ethBalance < 0.0002) {
    console.error('  Need at least 0.0002 ETH on Base for two mint transactions.');
    console.error('  Send ~$0.50 worth of ETH to the address above on Base network.');
    process.exit(1);
  }

  for (const reg of REGISTRATIONS) {
    console.log(`  ── Registering: ${reg.name}`);
    console.log(`     URI: ${reg.uri}`);

    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi,
      functionName: 'register',
      args: [reg.uri],
    });

    console.log(`     Tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      const registeredLog = receipt.logs.find(log =>
        log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.topics.length >= 2
      );
      const agentId = registeredLog ? BigInt(registeredLog.topics[1]!) : 'unknown';
      console.log(`     Agent ID: ${agentId}`);
      console.log(`     BaseScan: https://basescan.org/tx/${hash}`);
      console.log(`     Done.\n`);
    } else {
      console.error(`     FAILED — check https://basescan.org/tx/${hash}`);
      process.exit(1);
    }
  }

  console.log(`  Both registrations complete. ClawNet + AID Protocol on-chain.`);
  console.log(`  Update the registration JSON files with the agentId values above.\n`);
}

main().catch((err) => {
  console.error('Registration failed:', err.message || err);
  process.exit(1);
});
