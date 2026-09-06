/**
 * Provider-Neutral Payment Gateway Adapter Core
 * Phase 5A: Work Package 7
 *
 * NOTE: The final payment provider has not been selected.
 * This adapter layer establishes a provider-neutral boundary:
 * - Application-owned domain inputs and outputs
 * - No dependency on any single provider's raw payload
 * - Development simulator clearly isolated from production
 * - Production fails closed when no provider is active
 */

import {
  PaymentGatewayAdapter,
  PaymentRequestParams,
  PaymentRequestResult,
  PaymentVerifyParams,
  PaymentVerificationResult,
  NormalizedPaymentError
} from './types.js';
import { isProduction, allowTestShortcuts } from '../security.js';

export class ProviderNeutralSimulatorAdapter implements PaymentGatewayAdapter {
  public readonly name = 'Provider Neutral Dev Simulator';
  public readonly mode = 'provider-simulator-dev';

  async requestPayment(params: PaymentRequestParams): Promise<PaymentRequestResult> {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
    const authority = `A${Date.now()}${randomSuffix}`;
    const paymentUrl = `/mock-gateway?authority=${authority}&amount=${params.amount}`;

    return {
      authority,
      paymentUrl,
      amount: params.amount,
      planId: params.planId,
      mode: this.mode
    };
  }

  buildRedirectUrl(authority: string): string {
    return `/mock-gateway?authority=${encodeURIComponent(authority)}`;
  }

  async verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerificationResult> {
    const randomRef = Math.floor(10000000 + Math.random() * 90000000).toString();
    const randomPan = `6037-99**-****-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      success: true,
      status: 'SUCCESS',
      refId: `REF-${randomRef}`,
      cardPan: randomPan
    };
  }

  normalizeProviderError(error: unknown): NormalizedPaymentError {
    if (error && typeof error === 'object' && 'code' in error && 'messageFa' in error) {
      const err = error as any;
      const retryable = Boolean(err.retryable);
      return {
        code: String(err.code || 'PAYMENT_FAILED'),
        messageFa: String(err.messageFa || 'خطا در ارتباط با درگاه پرداخت.'),
        retryable,
        failureClassification: err.failureClassification || (retryable ? 'RETRYABLE_ERROR' : 'DEFINITIVE_REJECTION')
      };
    }
    const rawMsg = error instanceof Error ? error.message : String(error);
    const isNetworkOrTimeout = /timeout|econnrefused|econnreset|etimedout|socket|network|unreachable|unavailable|temporary/i.test(rawMsg);
    if (isNetworkOrTimeout) {
      return {
        code: 'PAYMENT_TEMPORARY_ERROR',
        messageFa: 'خطای موقت در ارتباط با درگاه پرداخت. لطفاً پس از چند لحظه دوباره تلاش کنید.',
        retryable: true,
        failureClassification: 'RETRYABLE_ERROR'
      };
    }
    return {
      code: 'PAYMENT_FAILED',
      messageFa: 'پرداخت توسط درگاه تایید نشد.',
      retryable: false,
      failureClassification: 'DEFINITIVE_REJECTION'
    };
  }
}

let activeAdapterOverride: PaymentGatewayAdapter | null = null;

/**
 * Set an explicit payment gateway adapter (restricted strictly to non-production testing environments).
 * In production, setting an adapter override is rejected/ignored regardless of ALLOW_TEST_SHORTCUTS.
 * Clearing the override (passing null) is always permitted for test cleanup.
 */
export function setPaymentAdapterOverride(adapter: PaymentGatewayAdapter | null): void {
  if (adapter !== null && isProduction()) {
    // Fail closed: Never allow simulator/mock override in production regardless of shortcuts
    return;
  }
  activeAdapterOverride = adapter;
}

/**
 * Resolves the active payment gateway adapter based on environment.
 * In production, a simulator or test override must NEVER be returned,
 * and production without a configured real provider must return null.
 * ALLOW_TEST_SHORTCUTS=true must NEVER enable simulated payment in production.
 */
export function getPaymentAdapter(): PaymentGatewayAdapter | null {
  // Absolute production isolation: fail closed in production without a configured real provider
  if (isProduction()) {
    return null;
  }

  if (activeAdapterOverride) {
    return activeAdapterOverride;
  }

  // Development / test simulator (never returned in production)
  return new ProviderNeutralSimulatorAdapter();
}
