/**
 * One-time script: Register the ClawNet Transaction Receipt schema on Base via EAS.
 *
 * This registers a schema on the EAS SchemaRegistry that defines the format
 * for all ClawNet Soma Receipts. Once registered, the schema UID goes in
 * EAS_SCHEMA_UID in your .env file.
 *
 * Cost: ~$0.003 (one Base transaction)
 *
 * Prerequisites:
 *   - EVM_PRIVATE_KEY in .env (Base wallet with a tiny amount of ETH for gas)
 *   - BASE_RPC_URL in .env (or defaults to public RPC)
 *
 * Run: npx tsx scripts/register-eas-schema.ts
 */

import { config } from 'dotenv';
config();

import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';
import { ethers } from 'ethers';

const SCHEMA_REGISTRY_CONTRACT = '0x4200000000000000000000000000000000000020';

const RECEIPT_SCHEMA =
  'bytes32 requestHash, bytes32 responseHash, bytes32 somaDataHash, uint256 agentTokenId, uint32 creditsCost, uint64 timestamp, bytes32 paymentRef, uint8 paymentMethod, bool cached';

async function main() {
  const evmKey = process.env.EVM_PRIVATE_KEY;
  if (!evmKey) {
    console.error('❌ EVM_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  console.log(`🔗 Using RPC: ${rpcUrl}`);
  console.log(`📋 Schema: ${RECEIPT_SCHEMA}\n`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(evmKey, provider);

  console.log(`🔑 Wallet: ${wallet.address}`);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('❌ Wallet has no ETH for gas. Send a tiny amount of ETH on Base first.');
    process.exit(1);
  }

  // Register schema
  const registry = new SchemaRegistry(SCHEMA_REGISTRY_CONTRACT);
  registry.connect(wallet);

  console.log('\n⏳ Registering schema on Base...');

  const tx = await registry.register({
    schema: RECEIPT_SCHEMA,
    resolverAddress: '0x0000000000000000000000000000000000000000',
    revocable: true,
  });

  const uid = await tx.wait();

  console.log('\n✅ Schema registered successfully!');
  console.log(`📌 Schema UID: ${uid}`);
  console.log(`🔍 View on EASScan: https://base.easscan.org/schema/view/${uid}`);
  console.log(`\n👉 Add this to your .env:`);
  console.log(`   EAS_SCHEMA_UID=${uid}`);
}

main().catch((err) => {
  console.error('❌ Registration failed:', err.message || err);
  process.exit(1);
});
