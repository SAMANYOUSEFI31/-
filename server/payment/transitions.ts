/**
 * Provider-Neutral Payment State Transitions
 * Closed state machine: PENDING -> SUCCESS, PENDING -> FAILED
 * Phase 5A: Work Package 3
 */

import { PaymentStatus } from './types.js';

export class PaymentStateTransitionError extends Error {
  public readonly code = 'PAYMENT_STATE_CONFLICT';
  public readonly currentStatus: string;
  public readonly targetStatus: string;

  constructor(currentStatus: string, targetStatus: string, message?: string) {
    super(
      message ||
        `انتقال نامعتبر وضعیت تراکنش از «${currentStatus}» به «${targetStatus}». وضعیت‌های نهایی برگشت‌ناپذیرند.`
    );
    this.name = 'PaymentStateTransitionError';
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
  }
}

/**
 * Validates state transition according to Phase 5A closed transition contract:
 * - New payment begins as PENDING.
 * - PENDING may transition to SUCCESS.
 * - PENDING may transition to FAILED.
 * - SUCCESS is terminal.
 * - FAILED is terminal.
 * - SUCCESS cannot become FAILED.
 * - FAILED cannot become SUCCESS.
 * - Repeating an already completed transition is an idempotent no-op.
 * - Unsupported transitions fail closed.
 */
export function validateStateTransition(
  rawCurrent: string | null | undefined,
  rawTarget: string
): { isNoop: boolean; valid: boolean } {
  const current = (rawCurrent || 'PENDING').toUpperCase() as PaymentStatus;
  const target = rawTarget.toUpperCase() as PaymentStatus;

  // Idempotent duplicate check
  if (current === target) {
    return { isNoop: true, valid: true };
  }

  // Legal transitions from PENDING
  if (current === 'PENDING') {
    if (target === 'SUCCESS' || target === 'FAILED') {
      return { isNoop: false, valid: true };
    }
    throw new PaymentStateTransitionError(current, target);
  }

  // Terminal states cannot transition to another state
  if (current === 'SUCCESS' && target === 'FAILED') {
    throw new PaymentStateTransitionError(current, target, 'تراکنش تایید شده (SUCCESS) قابل تغییر به ناموفق نیست.');
  }

  if (current === 'FAILED' && target === 'SUCCESS') {
    throw new PaymentStateTransitionError(current, target, 'تراکنش رد شده (FAILED) قابل تغییر به تایید شده نیست.');
  }

  throw new PaymentStateTransitionError(current, target);
}
