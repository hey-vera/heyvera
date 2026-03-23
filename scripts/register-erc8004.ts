/**
 * One-time script: Register ClawNet on ERC-8004 Identity Registry (Base Mainnet).
 *
 * Mints an ERC-721 NFT on the ERC-8004 IdentityRegistry contract.
 * Cost: ~$0.01-0.05 gas on Base. No protocol fee.
 *
 * Prerequisites:
 *   - EVM_PRIVATE_KEY in .env (Base wallet with ~0.001 ETH for gas)
 *   - Or pass as: EVM_PRIVATE_KEY=0x... npx tsx scripts/register-erc8004.ts
 *
 * The agentURI points to: https://api.claw-net.org/.well-known/erc8004-registration.json
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const AGENT_URI = 'https://api.claw-net.org/.well-known/erc8004-registration.json';
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const abi = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed agentWallet)',
]);

async function main() {
  const key = process.env.EVM_PRIVATE_KEY;
  if (!key) {
    console.error('Set EVM_PRIVATE_KEY in .env or pass as environment variable.');
    console.error('This wallet needs ~0.001 ETH on Base for gas.');
    process.exit(1);
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  console.log(`\n  Registering ClawNet on ERC-8004 Identity Registry`);
  console.log(`  Chain: Base (8453)`);
  console.log(`  Registry: ${IDENTITY_REGISTRY}`);
  console.log(`  Wallet: ${account.address}`);
  console.log(`  Agent URI: ${AGENT_URI}\n`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  const ethBalance = Number(balance) / 1e18;
  console.log(`  Balance: ${ethBalance.toFixed(6)} ETH`);
  if (ethBalance < 0.0001) {
    console.error('  Insufficient ETH for gas. Need at least 0.0001 ETH on Base.');
    process.exit(1);
  }

  // Register
  console.log('  Sending registration transaction...');
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: 'register',
    args: [AGENT_URI],
  });

  console.log(`  Tx hash: ${hash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    // Parse the Registered event to get the agentId
    const registeredLog = receipt.logs.find(log =>
      log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.topics.length >= 2
    );
    const agentId = registeredLog ? BigInt(registeredLog.topics[1]!) : 'unknown';

    console.log(`\n  Registration successful!`);
    console.log(`  Agent ID: ${agentId}`);
    console.log(`  NFT: eip155:8453:${IDENTITY_REGISTRY}:${agentId}`);
    console.log(`  View: https://basescan.org/tx/${hash}`);
    console.log(`\n  Update your AID spec and registration JSON with agentId: ${agentId}`);
  } else {
    console.error(`\n  Transaction reverted. Check: https://basescan.org/tx/${hash}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Registration failed:', err.message || err);
  process.exit(1);
});
