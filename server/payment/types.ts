/**
 * Provider-Neutral Payment Architecture Core - Types & Interfaces
 * Phase 5A: Provider-Neutral Payment Integrity Core
 */

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface PaymentRequestParams {
  userId: string;
  planId: string;
  amount: number;
  description?: string;
}

export interface PaymentRequestResult {
  authority: string;
  paymentUrl: string;
  amount: number;
  planId: string;
  mode: string;
}

export interface PaymentVerifyParams {
  authority: string;
  expectedAmount: number;
}

export interface PaymentVerificationResult {
  success: boolean;
  status: 'SUCCESS' | 'FAILED';
  refId?: string;
  cardPan?: string;
  errorCode?: string;
  errorMessageFa?: string;
}

export interface NormalizedPaymentError {
  code: string;
  messageFa: string;
  retryable: boolean;
}

export interface PaymentGatewayAdapter {
  name: string;
  mode: string;
  requestPayment(params: PaymentRequestParams): Promise<PaymentRequestResult>;
  buildRedirectUrl(authority: string): string;
  verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerificationResult>;
  normalizeProviderError(error: unknown): NormalizedPaymentError;
}
