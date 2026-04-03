/**
 * eas.ts — Ethereum Attestation Service integration for Soma Receipt Layer
 *
 * Issues EAS off-chain attestations on Base for every paid ClawNet interaction.
 * Off-chain attestations are free (EIP-712 signatures only).
 * On-chain Merkle-root anchoring batches thousands of receipts into one Base tx (~$0.001).
 *
 * Base contract addresses (canonical OP Stack predeploys):
 *   EAS:            0x4200000000000000000000000000000000000021
 *   SchemaRegistry: 0x4200000000000000000000000000000000000020
 *
 * ClawNet ERC-8004 on Base: agent 36119, Soma 37696
 */

import { EAS, SchemaEncoder, Offchain, OffchainAttestationVersion } from '@ethereum-attestation-service/eas-sdk';
import { ethers } from 'ethers';
import { env } from '../config';

// ─── Constants ──────────────────────────────────────────────────────────────

const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const SCHEMA_REGISTRY_CONTRACT = '0x4200000000000000000000000000000000000020';
const BASE_CHAIN_ID = 8453n;
const BASE_RPC_DEFAULT = 'https://mainnet.base.org';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** ClawNet Transaction Receipt schema — gas-optimized fixed-size types */
export const RECEIPT_SCHEMA =
  'bytes32 requestHash, bytes32 responseHash, bytes32 somaDataHash, uint256 agentTokenId, uint32 creditsCost, uint64 timestamp, bytes32 paymentRef, uint8 paymentMethod, bool cached';

/** Payment method enum for schema encoding */
export const PaymentMethod = {
  CREDITS: 0,
  STRIPE: 1,
  SOLANA: 2,
  X402: 3,
} as const;

export type PaymentMethodType = (typeof PaymentMethod)[keyof typeof PaymentMethod];

// ─── Lazy singletons ────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;
let _wallet: ethers.Wallet | null = null;
let _eas: EAS | null = null;
let _offchain: Offchain | null = null;
let _schemaEncoder: SchemaEncoder | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(env.BASE_RPC_URL || BASE_RPC_DEFAULT);
  }
  return _provider;
}

function getWallet(): ethers.Wallet | null {
  if (_wallet) return _wallet;
  if (!env.EVM_PRIVATE_KEY) return null;
  _wallet = new ethers.Wallet(env.EVM_PRIVATE_KEY, getProvider());
  return _wallet;
}

function getEAS(): EAS | null {
  if (_eas) return _eas;
  const wallet = getWallet();
  if (!wallet) return null;
  _eas = new EAS(EAS_CONTRACT);
  _eas.connect(wallet);
  return _eas;
}

async function getOffchain(): Promise<Offchain | null> {
  if (_offchain) return _offchain;
  const eas = getEAS();
  if (!eas) return null;
  _offchain = await eas.getOffchain();
  return _offchain;
}

function getSchemaEncoder(): SchemaEncoder {
  if (!_schemaEncoder) {
    _schemaEncoder = new SchemaEncoder(RECEIPT_SCHEMA);
  }
  return _schemaEncoder;
}

// ─── Receipt data interface ─────────────────────────────────────────────────

export interface EASReceiptData {
  requestHash: string;    // 0x-prefixed bytes32
  responseHash: string;   // 0x-prefixed bytes32
  somaDataHash: string;   // 0x-prefixed bytes32 (birth cert hash, or zero)
  agentTokenId: number;   // ERC-8004 agent token ID (default 36119 for ClawNet)
  creditsCost: number;    // credits charged
  timestamp: number;      // unix seconds
  paymentRef: string;     // 0x-prefixed bytes32 (keccak256 of payment identifier)
  paymentMethod: PaymentMethodType;
  cached: boolean;
}

/**
 * Hash a payment identifier (Stripe session ID, Solana sig, x402 hash) to bytes32.
 */
export function hashPaymentRef(identifier: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(identifier));
}

/**
 * Hash arbitrary data to bytes32 (for request/response hashing in EAS schema).
 */
export function hashToBytes32(data: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(data));
}

// ─── Off-chain attestation (FREE — no gas) ──────────────────────────────────

/**
 * Create a signed off-chain EAS attestation for a ClawNet transaction receipt.
 * Returns the full SignedOffchainAttestation JSON (self-contained, independently verifiable).
 *
 * Returns null if EVM_PRIVATE_KEY is not configured or EAS_SCHEMA_UID is not set.
 */
export async function createOffchainReceipt(
  data: EASReceiptData,
  recipient?: string,
): Promise<{ attestation: any; uid: string } | null> {
  const offchain = await getOffchain();
  const wallet = getWallet();
  if (!offchain || !wallet || !env.EAS_SCHEMA_UID) return null;

  const encoder = getSchemaEncoder();
  const encodedData = encoder.encodeData([
    { name: 'requestHash', value: data.requestHash, type: 'bytes32' },
    { name: 'responseHash', value: data.responseHash, type: 'bytes32' },
    { name: 'somaDataHash', value: data.somaDataHash, type: 'bytes32' },
    { name: 'agentTokenId', value: BigInt(data.agentTokenId), type: 'uint256' },
    { name: 'creditsCost', value: data.creditsCost, type: 'uint32' },
    { name: 'timestamp', value: BigInt(data.timestamp), type: 'uint64' },
    { name: 'paymentRef', value: data.paymentRef, type: 'bytes32' },
    { name: 'paymentMethod', value: data.paymentMethod, type: 'uint8' },
    { name: 'cached', value: data.cached, type: 'bool' },
  ]);

  const attestation = await offchain.signOffchainAttestation(
    {
      recipient: recipient || ZERO_ADDRESS,
      expirationTime: 0n, // no expiration
      time: BigInt(data.timestamp),
      revocable: true,
      schema: env.EAS_SCHEMA_UID,
      refUID: ZERO_BYTES32,
      data: encodedData,
    },
    wallet,
  );

  return {
    attestation,
    uid: attestation.uid,
  };
}

// ─── On-chain Merkle timestamp (batch anchoring) ────────────────────────────

/**
 * Batch-anchor multiple off-chain attestation UIDs on Base via Merkle root.
 * One on-chain transaction timestamps all UIDs regardless of batch size (~$0.001).
 *
 * Returns the transaction hash or null if EAS is not configured.
 */
export async function batchTimestamp(uids: string[]): Promise<string | null> {
  const eas = getEAS();
  if (!eas || uids.length === 0) return null;

  try {
    const tx = await eas.multiTimestamp(uids.map(uid =>
      ethers.encodeBytes32String(uid.length > 31 ? uid.slice(0, 31) : uid)
    ));
    const receipt = await tx.wait();
    return receipt;
  } catch (err) {
    console.error('[EAS] Batch timestamp failed:', err);
    return null;
  }
}

/**
 * Timestamp a single off-chain attestation UID on-chain.
 */
export async function timestampSingle(uid: string): Promise<string | null> {
  const eas = getEAS();
  if (!eas) return null;

  try {
    const tx = await eas.timestamp(ethers.encodeBytes32String(uid.length > 31 ? uid.slice(0, 31) : uid));
    return await tx.wait();
  } catch (err) {
    console.error('[EAS] Timestamp failed:', err);
    return null;
  }
}

// ─── Verification (offline — no chain call) ─────────────────────────────────

/**
 * Verify an off-chain attestation signature. Pure cryptographic check — no RPC needed.
 * Returns true if the attestation was signed by the expected attester.
 */
export async function verifyOffchainReceipt(
  attestation: any,
  expectedAttester?: string,
): Promise<boolean> {
  try {
    const offchain = await getOffchain();
    if (!offchain) return false;

    const attester = expectedAttester || getWallet()?.address;
    if (!attester) return false;

    return offchain.verifyOffchainAttestationSignature(attester, attestation);
  } catch {
    return false;
  }
}

/**
 * Decode an off-chain attestation's data field back to structured receipt data.
 */
export function decodeReceiptData(encodedData: string): EASReceiptData | null {
  try {
    const encoder = getSchemaEncoder();
    const decoded = encoder.decodeData(encodedData);

    return {
      requestHash: decoded[0].value.value as string,
      responseHash: decoded[1].value.value as string,
      somaDataHash: decoded[2].value.value as string,
      agentTokenId: Number(decoded[3].value.value),
      creditsCost: Number(decoded[4].value.value),
      timestamp: Number(decoded[5].value.value),
      paymentRef: decoded[6].value.value as string,
      paymentMethod: Number(decoded[7].value.value) as PaymentMethodType,
      cached: decoded[8].value.value as boolean,
    };
  } catch {
    return null;
  }
}

// ─── Schema registration (one-time) ────────────────────────────────────────

/**
 * Register the ClawNet Transaction Receipt schema on Base.
 * Only needs to be called once — returns the schema UID to store in EAS_SCHEMA_UID env var.
 */
export async function registerSchema(): Promise<string | null> {
  const wallet = getWallet();
  if (!wallet) {
    console.error('[EAS] Cannot register schema: EVM_PRIVATE_KEY not set');
    return null;
  }

  const { SchemaRegistry } = await import('@ethereum-attestation-service/eas-sdk');
  const registry = new SchemaRegistry(SCHEMA_REGISTRY_CONTRACT);
  registry.connect(wallet);

  const tx = await registry.register({
    schema: RECEIPT_SCHEMA,
    resolverAddress: ZERO_ADDRESS,
    revocable: true,
  });

  const uid = await tx.wait();
  console.log(`[EAS] Schema registered on Base. UID: ${uid}`);
  console.log('[EAS] Set EAS_SCHEMA_UID=%s in your .env', uid);
  return uid;
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Check if EAS is configured and ready to issue receipts */
export function isEASReady(): boolean {
  return !!(env.EVM_PRIVATE_KEY && env.EAS_SCHEMA_UID);
}

/** Get the attester address (for verification instructions) */
export function getAttesterAddress(): string | null {
  return getWallet()?.address ?? null;
}

/** Get the easscan.org URL for an off-chain attestation */
export function getEASScanUrl(uid: string): string {
  return `https://base.easscan.org/offchain/attestation/view/${uid}`;
}

/** Destroy cached instances (for testing/shutdown) */
export function destroyEAS(): void {
  _provider = null;
  _wallet = null;
  _eas = null;
  _offchain = null;
  _schemaEncoder = null;
}
