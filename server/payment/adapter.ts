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
      return {
        code: String(err.code || 'PAYMENT_FAILED'),
        messageFa: String(err.messageFa || 'خطا در ارتباط با درگاه پرداخت.'),
        retryable: Boolean(err.retryable)
      };
    }
    return {
      code: 'PAYMENT_FAILED',
      messageFa: 'پرداخت توسط درگاه تایید نشد.',
      retryable: false
    };
  }
}

let activeAdapterOverride: PaymentGatewayAdapter | null = null;

/**
 * Set an explicit payment gateway adapter (useful for automated testing)
 */
export function setPaymentAdapterOverride(adapter: PaymentGatewayAdapter | null): void {
  activeAdapterOverride = adapter;
}

/**
 * Resolves the active payment gateway adapter based on environment.
 * In production without test shortcuts, returns null (or fails closed)
 * until a production provider is officially integrated and configured.
 */
export function getPaymentAdapter(): PaymentGatewayAdapter | null {
  if (activeAdapterOverride) {
    return activeAdapterOverride;
  }

  // In production without test shortcuts, no mock payment is allowed
  if (isProduction() && !allowTestShortcuts()) {
    return null;
  }

  // Development / test simulator
  return new ProviderNeutralSimulatorAdapter();
}
