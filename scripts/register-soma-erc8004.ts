/**
 * One-time script: Register Soma protocol on ERC-8004 (Base Mainnet).
 *
 * Mints ONE ERC-721 NFT on the IdentityRegistry:
 *   - Soma — the identity-as-execution verification protocol
 *
 * Existing registrations (already on-chain):
 *   - AID Protocol — agentId 36118 (LEGACY, abandoned)
 *   - ClawNet — agentId 36119
 *
 * Cost: ~$0.01-0.05 (one mint transaction on Base).
 *
 * Prerequisites:
 *   - EVM_PRIVATE_KEY in .env (Base wallet with ~0.0001 ETH)
 *   - Deploy ClawNet first so /.well-known/soma-registration.json is live
 *
 * Run: npx tsx scripts/register-soma-erc8004.ts
 *
 * After registration, update the soma-registration.json endpoint in
 * src/routes/well-known.ts with the returned agentId.
 */

import { config } from 'dotenv';
config();

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const SOMA_URI = 'https://api.claw-net.org/.well-known/soma-registration.json';

const abi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed agentWallet)',
]);

async function main() {
  const key = process.env.EVM_PRIVATE_KEY;
  if (!key) {
    console.error('Set EVM_PRIVATE_KEY in .env (Base wallet with ~0.0001 ETH for gas).');
    process.exit(1);
  }

  const account = privateKeyToAccount(key as `0x${string}`);

  console.log(`\n  ERC-8004 Identity Registry — Base Mainnet`);
  console.log(`  Registry: ${IDENTITY_REGISTRY}`);
  console.log(`  Wallet:   ${account.address}\n`);

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

  if (ethBalance < 0.0001) {
    console.error('  Need at least 0.0001 ETH on Base for one mint transaction.');
    console.error('  Send ~$0.25 worth of ETH to the address above on Base network.');
    process.exit(1);
  }

  console.log(`  ── Registering: Soma Protocol`);
  console.log(`     URI: ${SOMA_URI}`);

  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: 'register',
    args: [SOMA_URI],
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
    console.log(`\n  Soma registered on-chain.`);
    console.log(`  Three ERC-8004 identities now active:`);
    console.log(`    36118 — AID Protocol (legacy)`);
    console.log(`    36119 — ClawNet`);
    console.log(`    ${agentId} — Soma\n`);
    console.log(`  Next: update soma-registration.json registrations[] with agentId ${agentId}`);
    console.log(`         in src/routes/well-known.ts\n`);
  } else {
    console.error(`     FAILED — check https://basescan.org/tx/${hash}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Registration failed:', err.message || err);
  process.exit(1);
});
