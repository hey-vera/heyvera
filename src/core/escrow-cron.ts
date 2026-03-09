import { getExpiredEscrows, refundEscrow, transitionEscrow, writeAuditLog } from '../db/index';
import { logger } from '../utils/logger';

let timer: ReturnType<typeof setInterval> | null = null;

export function startEscrowCron(): void {
  if (timer) return;
  // Run immediately on startup, then every 10 minutes
  runExpiryCheck();
  timer = setInterval(runExpiryCheck, 10 * 60 * 1000);
  logger.info('Escrow expiry cron started');
}

export function stopEscrowCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function runExpiryCheck(): void {
  try {
    const expired = getExpiredEscrows();
    for (const escrow of expired) {
      if (escrow.state === 'FUNDED') {
        // No work started — full refund to hirer
        const result = refundEscrow(escrow.id);
        if (result.ok) {
          writeAuditLog({
            entityType: 'escrow', entityId: escrow.id,
            action: 'REFUNDED', actorId: null,
            data: { reason: 'deadline_expired', state_was: 'FUNDED' },
          });
          logger.info({ escrowId: escrow.id }, 'Escrow auto-refunded (deadline expired, unfunded)');
        }
      } else if (escrow.state === 'WORK_IN_PROGRESS') {
        // Work was started but not completed — auto-dispute so worker can submit evidence
        const ok = transitionEscrow(escrow.id, 'DISPUTED');
        if (ok) {
          writeAuditLog({
            entityType: 'escrow', entityId: escrow.id,
            action: 'DISPUTED', actorId: null,
            data: { reason: 'deadline_expired', state_was: 'WORK_IN_PROGRESS', auto: true },
          });
          logger.info({ escrowId: escrow.id }, 'Escrow auto-disputed (deadline expired, work in progress)');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Escrow expiry check failed');
  }
}
