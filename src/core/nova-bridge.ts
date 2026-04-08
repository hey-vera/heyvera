/**
 * nova-bridge.ts — TypeScript bridge to the Rust Nova prover subprocess
 *
 * Spawns a persistent Rust binary (soma-nova-prover), communicates via
 * stdin/stdout JSON IPC. Handles health checks, auto-restart, and
 * graceful degradation when the prover is unavailable.
 *
 * IPC overhead: ~1-3ms round-trip (negligible vs 50ms+ proof generation).
 */

import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface } from 'readline';
import path from 'path';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────

export interface FoldResult {
  ok: boolean;
  agent_did: string;
  new_state: string;
  heartbeat_index: number;
  fold_count: number;
}

export interface CompressResult {
  ok: boolean;
  proof: string;
  proof_size_bytes: number;
  root: string;
  heartbeat_index: number;
  fold_count: number;
}

export interface VerifyResult {
  ok: boolean;
  valid: boolean;
}

export interface ProverState {
  ok: boolean;
  state_hash: string;
  heartbeat_index: number;
  fold_count: number;
  mode: string;
}

// ─── Nova Bridge ──────────────────────────────────────────────────────────

export class NovaBridge {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map();
  private responseQueue: Array<(line: string) => void> = [];
  private _ready = false;
  private _mode = 'unavailable';
  private restartCount = 0;
  private readonly binaryPath: string;

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? path.join(process.cwd(), 'prover', 'target', 'release', 'soma-nova-prover');
  }

  get ready(): boolean { return this._ready; }
  get mode(): string { return this._mode; }

  /**
   * Start the prover subprocess. Returns true if successful.
   */
  async start(): Promise<boolean> {
    try {
      this.process = spawn(this.binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', (err) => {
        logger.warn({ err }, 'Nova prover subprocess error');
        this._ready = false;
      });

      this.process.on('exit', (code) => {
        logger.info({ code }, 'Nova prover subprocess exited');
        this._ready = false;
        this.process = null;
      });

      // Read stderr for logging
      if (this.process.stderr) {
        this.process.stderr.on('data', (data: Buffer) => {
          logger.warn({ prover_stderr: data.toString().trim() }, 'Nova prover stderr');
        });
      }

      // Set up line-by-line stdout reading
      this.readline = createInterface({ input: this.process.stdout! });
      this.readline.on('line', (line) => this.handleLine(line));

      // Wait for ready signal
      // Groth16 trusted setup takes 3-5 min on 4GB VPS (swap-heavy).
      // Subsequent starts will be faster once param caching is added.
      const readyLine = await this.waitForLine(600_000);
      const ready = JSON.parse(readyLine);

      if (ready.ready) {
        this._ready = true;
        this._mode = ready.mode ?? 'unknown';
        logger.info({ version: ready.version, mode: ready.mode }, 'Nova prover started');
        return true;
      }

      return false;
    } catch (err) {
      logger.warn({ err }, 'Failed to start Nova prover — running without ZK proofs');
      this._ready = false;
      return false;
    }
  }

  /**
   * Stop the prover subprocess.
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this._ready = false;
    this.readline?.close();
    this.readline = null;
  }

  /**
   * Fold a new leaf into the running Nova instance.
   */
  async fold(agentDid: string, leafHash: string, heartbeatIndex: number): Promise<FoldResult> {
    return this.send({
      cmd: 'fold',
      agent_did: agentDid,
      leaf_hash: leafHash,
      heartbeat_index: heartbeatIndex,
    });
  }

  /**
   * Compress the accumulated folded instance into a Groth16 proof.
   */
  async compress(agentDid: string): Promise<CompressResult> {
    return this.send({ cmd: 'compress', agent_did: agentDid });
  }

  /**
   * Verify a compressed Groth16 proof.
   */
  async verify(proof: string, foldCount: number): Promise<VerifyResult> {
    return this.send({ cmd: 'verify', proof, fold_count: foldCount });
  }

  /**
   * Get the current prover state for an agent.
   */
  async getState(agentDid: string): Promise<ProverState> {
    return this.send({ cmd: 'state', agent_did: agentDid });
  }

  /**
   * Reset the prover state for an agent.
   */
  async reset(agentDid: string): Promise<{ ok: boolean }> {
    return this.send({ cmd: 'reset', agent_did: agentDid });
  }

  /**
   * Ping the prover to check health.
   */
  async ping(): Promise<{ ok: boolean; version: string; mode: string }> {
    return this.send({ cmd: 'ping' });
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async send<T>(command: object): Promise<T> {
    if (!this._ready || !this.process?.stdin) {
      throw new Error('Nova prover not available');
    }

    const line = JSON.stringify(command);
    this.process.stdin.write(line + '\n');

    const responseLine = await this.waitForLine(30000); // 30s timeout for compression
    const parsed = JSON.parse(responseLine);

    if (!parsed.ok) {
      throw new Error(parsed.error ?? 'Nova prover returned error');
    }

    return parsed as T;
  }

  private waitForLine(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Nova prover timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.responseQueue.push((line: string) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  private handleLine(line: string): void {
    const handler = this.responseQueue.shift();
    if (handler) {
      handler(line);
    } else {
      logger.warn({ line }, 'Unexpected line from Nova prover');
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _bridge: NovaBridge | null = null;

/** Get the global Nova bridge instance. */
export function getNovaBridge(): NovaBridge {
  if (!_bridge) {
    _bridge = new NovaBridge();
  }
  return _bridge;
}

/**
 * Try to start the Nova prover. Non-fatal if it fails.
 * Called during server startup.
 */
export async function initNovaBridge(): Promise<boolean> {
  const bridge = getNovaBridge();
  const ok = await bridge.start();
  if (!ok) {
    logger.info('Nova prover not available — agents will use signed-only mode');
  }
  return ok;
}
