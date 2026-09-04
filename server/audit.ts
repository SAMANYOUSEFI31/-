/**
 * Safe Structured Audit Logging for Impersonation Operations
 *
 * CRITICAL SECURITY INVARIANT:
 * Never log phone numbers, email addresses, names, tokens, passwords, or private payloads.
 * Structured records contain only:
 * - eventType
 * - impersonatorAdminId
 * - targetUserId
 * - result ('success' | 'failure')
 * - errorCode (or null)
 * - timestamp (ISO 8601)
 */

export type ImpersonationEventType =
  | 'impersonation_started'
  | 'impersonation_denied'
  | 'impersonation_target_not_found'
  | 'impersonation_exited'
  | 'impersonation_exit_failed';

export interface ImpersonationAuditEvent {
  eventType: ImpersonationEventType;
  impersonatorAdminId: string | null;
  targetUserId: string | null;
  result: 'success' | 'failure';
  errorCode: string | null;
  timestamp: string;
}

// In-memory ring buffer for audit queries and assertions in tests
export const impersonationAuditLogs: ImpersonationAuditEvent[] = [];

export function clearImpersonationAuditLogs(): void {
  impersonationAuditLogs.length = 0;
}

export function logImpersonationAudit(event: {
  eventType: ImpersonationEventType;
  impersonatorAdminId: string | null;
  targetUserId: string | null;
  result: 'success' | 'failure';
  errorCode?: string | null;
  timestamp?: string;
}): ImpersonationAuditEvent {
  const safeRecord: ImpersonationAuditEvent = {
    eventType: event.eventType,
    impersonatorAdminId: event.impersonatorAdminId ? String(event.impersonatorAdminId).trim() : null,
    targetUserId: event.targetUserId ? String(event.targetUserId).trim() : null,
    result: event.result,
    errorCode: event.errorCode ? String(event.errorCode).trim() : null,
    timestamp: event.timestamp || new Date().toISOString()
  };

  impersonationAuditLogs.push(safeRecord);
  if (impersonationAuditLogs.length > 500) {
    impersonationAuditLogs.shift();
  }

  // Pure structured logging without PII
  console.log(`[Audit:Impersonation] ${JSON.stringify(safeRecord)}`);
  return safeRecord;
}
