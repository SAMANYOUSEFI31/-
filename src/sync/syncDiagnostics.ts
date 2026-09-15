import type { ReplayFailureClassification } from '../types';
import type { SyncTrigger, SyncRunStatus } from './syncOrchestrator';
import { isDevelopmentEnvironment } from './storageCore';

/**
 * =============================================================================
 * PHASE 4: PRODUCTION-SAFE SYNC OBSERVABILITY AND DIAGNOSTICS
 * =============================================================================
 *
 * Closed, privacy-safe diagnostic event contract for Bushido Discipline OS sync.
 *
 * Principles:
 * 1. Zero Sensitive Data: No tokens, passwords, owner IDs, phone numbers, emails,
 *    mutation payloads, notes, or cycle titles are ever stored or emitted.
 * 2. Closed Typed Vocabulary: Events, statuses, and error categories are strictly enumerated.
 * 3. Runtime Sanitization: Strong validation at diagnostic boundary discards invalid fields/types.
 * 4. Non-Invasive & Isolated: Diagnostic sink errors never throw into sync execution.
 * 5. Bounded In-Memory Retention: Small FIFO ring buffer with no default disk/network persistence.
 * =============================================================================
 */

export type SyncDiagnosticEventType =
  | 'RUN_REQUESTED'
  | 'RUN_STARTED'
  | 'RUN_COALESCED'
  | 'RUN_SKIPPED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_DISCARDED_STALE'
  | 'RUN_ABORTED'
  | 'LOCK_LOST'
  | 'RECONCILIATION_COMPLETED'
  | 'RECONCILIATION_DISCARDED_STALE';

export type SafeSyncErrorCategory =
  | 'NETWORK'
  | 'AUTH'
  | 'HTTP_RETRYABLE'
  | 'HTTP_PERMANENT'
  | 'LOCK_LOSS'
  | 'ACCOUNT_CHANGE'
  | 'OFFLINE'
  | 'UNKNOWN';

export type SafeSyncReason =
  | 'OFFLINE'
  | 'GUEST_OR_ANONYMOUS'
  | 'ACCOUNT_CHANGED'
  | 'LOCK_LOST'
  | 'AUTH_REQUIRED'
  | 'USER_ABORT'
  | 'ERROR'
  | 'SUCCESS'
  | 'COALESCED'
  | 'PENDING_TRAILING';

export interface SyncDiagnosticRecord {
  eventType: SyncDiagnosticEventType;
  timestamp: number;
  runId?: string;
  trigger?: SyncTrigger;
  triggers?: SyncTrigger[];
  force?: boolean;
  syncedCount?: number;
  failedCount?: number;
  remainingQueueCount?: number;
  itemCount?: number;
  outcomeStatus?: SyncRunStatus;
  errorCategory?: SafeSyncErrorCategory;
  safeReason?: SafeSyncReason;
  durationMs?: number;

  // Aggregate-only reconciliation counts
  remoteCyclesCount?: number;
  remoteLogsCount?: number;
  pendingMutationsCount?: number;
  reconciledCyclesCount?: number;
  reconciledLogsCount?: number;
  demoConsumedChanged?: boolean;
}

export interface SyncDiagnosticSink {
  record(event: SyncDiagnosticRecord): void;
}

export const MAX_DIAGNOSTIC_RECORDS = 50;

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<SyncDiagnosticEventType>([
  'RUN_REQUESTED',
  'RUN_STARTED',
  'RUN_COALESCED',
  'RUN_SKIPPED',
  'RUN_COMPLETED',
  'RUN_FAILED',
  'RUN_DISCARDED_STALE',
  'RUN_ABORTED',
  'LOCK_LOST',
  'RECONCILIATION_COMPLETED',
  'RECONCILIATION_DISCARDED_STALE'
]);

const VALID_TRIGGERS: ReadonlySet<string> = new Set<SyncTrigger>([
  'BOOT_AUTH_VERIFIED',
  'NETWORK_ONLINE',
  'AUTH_SUCCESS',
  'QUICK_LOGIN_SUCCESS',
  'IMPERSONATION_START',
  'IMPERSONATION_EXIT',
  'MANUAL_FORCE'
]);

const VALID_OUTCOME_STATUSES: ReadonlySet<string> = new Set<SyncRunStatus>([
  'COMPLETED',
  'SKIPPED_OFFLINE',
  'SKIPPED_GUEST_OR_ANONYMOUS',
  'DISCARDED_STALE',
  'ABORTED',
  'FAILED'
]);

const VALID_ERROR_CATEGORIES: ReadonlySet<string> = new Set<SafeSyncErrorCategory>([
  'NETWORK',
  'AUTH',
  'HTTP_RETRYABLE',
  'HTTP_PERMANENT',
  'LOCK_LOSS',
  'ACCOUNT_CHANGE',
  'OFFLINE',
  'UNKNOWN'
]);

const VALID_SAFE_REASONS: ReadonlySet<string> = new Set<SafeSyncReason>([
  'OFFLINE',
  'GUEST_OR_ANONYMOUS',
  'ACCOUNT_CHANGED',
  'LOCK_LOST',
  'AUTH_REQUIRED',
  'USER_ABORT',
  'ERROR',
  'SUCCESS',
  'COALESCED',
  'PENDING_TRAILING'
]);

const RUN_ID_PATTERN = /^sync_run_\d+_\d+_[a-z0-9]+$/;

function sanitizeCount(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return Math.floor(val);
  }
  return undefined;
}

function sanitizeDuration(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    return val;
  }
  return undefined;
}

let runIdCounter = 0;

/**
 * Generates an opaque correlation identifier for a single replay execution run.
 * Contains only timestamps and randomized nonces — never user, token, or payload data.
 */
export function generateDiagnosticRunId(): string {
  runIdCounter = (runIdCounter + 1) % 1000000;
  const rand = Math.random().toString(36).substring(2, 8);
  return `sync_run_${Date.now()}_${runIdCounter}_${rand}`;
}

/**
 * Maps existing ReplayFailureClassification to closed SafeSyncErrorCategory.
 */
export function classifyReplayFailureToSafeCategory(
  classification?: ReplayFailureClassification
): SafeSyncErrorCategory {
  switch (classification) {
    case 'AUTH_REQUIRED':
    case 'FORBIDDEN':
      return 'AUTH';
    case 'NETWORK_ERROR':
      return 'NETWORK';
    case 'RATE_LIMITED':
    case 'SERVER_RETRYABLE':
      return 'HTTP_RETRYABLE';
    case 'VALIDATION_ERROR':
    case 'CONFLICT_DEFERRED':
    case 'ENTITY_MISSING':
      return 'HTTP_PERMANENT';
    case 'UNKNOWN_MUTATION':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Classifies an unknown error or outcome status into a closed SafeSyncErrorCategory
 * without retaining raw Error objects or stack traces.
 */
export function classifySafeError(
  error?: unknown,
  outcomeStatus?: SyncRunStatus
): SafeSyncErrorCategory {
  if (outcomeStatus === 'SKIPPED_OFFLINE') {
    return 'OFFLINE';
  }
  if (outcomeStatus === 'SKIPPED_GUEST_OR_ANONYMOUS') {
    return 'AUTH';
  }
  if (outcomeStatus === 'DISCARDED_STALE') {
    return 'ACCOUNT_CHANGE';
  }
  if (!error) {
    return 'UNKNOWN';
  }
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, any>;
    const name = typeof errObj.name === 'string' ? errObj.name : '';
    const message = typeof errObj.message === 'string' ? errObj.message : '';
    if (
      name === 'AbortError' ||
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('offline') ||
      message.includes('Failed to fetch')
    ) {
      return 'NETWORK';
    }
  }
  return 'UNKNOWN';
}

/**
 * In-memory bounded FIFO ring buffer diagnostic sink with runtime schema sanitization.
 */
export class InMemoryDiagnosticSink implements SyncDiagnosticSink {
  private buffer: SyncDiagnosticRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = MAX_DIAGNOSTIC_RECORDS) {
    this.maxRecords = typeof maxRecords === 'number' && maxRecords > 0 ? maxRecords : MAX_DIAGNOSTIC_RECORDS;
  }

  public record(event: SyncDiagnosticRecord): void {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      return;
    }

    // Reject/discard if eventType is not in the closed vocabulary
    if (typeof event.eventType !== 'string' || !VALID_EVENT_TYPES.has(event.eventType)) {
      return;
    }

    const eventType = event.eventType as SyncDiagnosticEventType;
    const timestamp =
      typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) && event.timestamp > 0
        ? event.timestamp
        : Date.now();

    const safeRecord: SyncDiagnosticRecord = {
      eventType,
      timestamp
    };

    if (typeof event.runId === 'string' && RUN_ID_PATTERN.test(event.runId)) {
      safeRecord.runId = event.runId;
    }

    if (typeof event.trigger === 'string' && VALID_TRIGGERS.has(event.trigger)) {
      safeRecord.trigger = event.trigger as SyncTrigger;
    }

    if (Array.isArray(event.triggers)) {
      const validTriggers: SyncTrigger[] = [];
      for (const t of event.triggers) {
        if (typeof t === 'string' && VALID_TRIGGERS.has(t)) {
          validTriggers.push(t as SyncTrigger);
        }
      }
      if (validTriggers.length > 0) {
        safeRecord.triggers = validTriggers;
      }
    }

    if (typeof event.force === 'boolean') {
      safeRecord.force = event.force;
    }

    const syncedCount = sanitizeCount(event.syncedCount);
    if (syncedCount !== undefined) safeRecord.syncedCount = syncedCount;

    const failedCount = sanitizeCount(event.failedCount);
    if (failedCount !== undefined) safeRecord.failedCount = failedCount;

    const remainingQueueCount = sanitizeCount(event.remainingQueueCount);
    if (remainingQueueCount !== undefined) safeRecord.remainingQueueCount = remainingQueueCount;

    const itemCount = sanitizeCount(event.itemCount);
    if (itemCount !== undefined) safeRecord.itemCount = itemCount;

    // Terminal outcome consistency enforcement:
    // Guarantees eventType and outcomeStatus never form contradictory terminal pairs.
    if (eventType === 'RUN_COMPLETED') {
      safeRecord.outcomeStatus = 'COMPLETED';
    } else if (eventType === 'RUN_FAILED') {
      safeRecord.outcomeStatus = 'FAILED';
    } else if (eventType === 'RUN_DISCARDED_STALE' || eventType === 'RECONCILIATION_DISCARDED_STALE') {
      safeRecord.outcomeStatus = 'DISCARDED_STALE';
    } else if (eventType === 'RUN_ABORTED') {
      safeRecord.outcomeStatus = 'ABORTED';
    } else if (eventType === 'LOCK_LOST') {
      safeRecord.outcomeStatus =
        typeof event.outcomeStatus === 'string' &&
        VALID_OUTCOME_STATUSES.has(event.outcomeStatus) &&
        event.outcomeStatus !== 'COMPLETED'
          ? (event.outcomeStatus as SyncRunStatus)
          : 'FAILED';
    } else if (eventType === 'RUN_SKIPPED') {
      if (
        event.outcomeStatus === 'SKIPPED_OFFLINE' ||
        event.outcomeStatus === 'SKIPPED_GUEST_OR_ANONYMOUS'
      ) {
        safeRecord.outcomeStatus = event.outcomeStatus;
      } else if (event.safeReason === 'OFFLINE' || event.errorCategory === 'OFFLINE') {
        safeRecord.outcomeStatus = 'SKIPPED_OFFLINE';
      } else {
        safeRecord.outcomeStatus = 'SKIPPED_GUEST_OR_ANONYMOUS';
      }
    } else if (typeof event.outcomeStatus === 'string' && VALID_OUTCOME_STATUSES.has(event.outcomeStatus)) {
      safeRecord.outcomeStatus = event.outcomeStatus as SyncRunStatus;
    }

    if (typeof event.errorCategory === 'string' && VALID_ERROR_CATEGORIES.has(event.errorCategory)) {
      safeRecord.errorCategory = event.errorCategory as SafeSyncErrorCategory;
    }

    if (typeof event.safeReason === 'string' && VALID_SAFE_REASONS.has(event.safeReason)) {
      safeRecord.safeReason = event.safeReason as SafeSyncReason;
    }

    const durationMs = sanitizeDuration(event.durationMs);
    if (durationMs !== undefined) safeRecord.durationMs = durationMs;

    const remoteCyclesCount = sanitizeCount(event.remoteCyclesCount);
    if (remoteCyclesCount !== undefined) safeRecord.remoteCyclesCount = remoteCyclesCount;

    const remoteLogsCount = sanitizeCount(event.remoteLogsCount);
    if (remoteLogsCount !== undefined) safeRecord.remoteLogsCount = remoteLogsCount;

    const pendingMutationsCount = sanitizeCount(event.pendingMutationsCount);
    if (pendingMutationsCount !== undefined) safeRecord.pendingMutationsCount = pendingMutationsCount;

    const reconciledCyclesCount = sanitizeCount(event.reconciledCyclesCount);
    if (reconciledCyclesCount !== undefined) safeRecord.reconciledCyclesCount = reconciledCyclesCount;

    const reconciledLogsCount = sanitizeCount(event.reconciledLogsCount);
    if (reconciledLogsCount !== undefined) safeRecord.reconciledLogsCount = reconciledLogsCount;

    if (typeof event.demoConsumedChanged === 'boolean') {
      safeRecord.demoConsumedChanged = event.demoConsumedChanged;
    }

    this.buffer.push(safeRecord);
    if (this.buffer.length > this.maxRecords) {
      this.buffer.shift();
    }
  }

  public getRecords(): SyncDiagnosticRecord[] {
    return [...this.buffer];
  }

  public clear(): void {
    this.buffer = [];
  }
}

let activeGlobalSink: SyncDiagnosticSink = new InMemoryDiagnosticSink();

/**
 * Sets the active global diagnostic sink (used for testing or custom configuration).
 */
export function setSyncDiagnosticSink(sink: SyncDiagnosticSink): void {
  activeGlobalSink = sink;
}

/**
 * Gets the active global diagnostic sink.
 */
export function getSyncDiagnosticSink(): SyncDiagnosticSink {
  return activeGlobalSink;
}

/**
 * Resets the active global diagnostic sink to a clean in-memory buffer.
 */
export function resetSyncDiagnosticSink(): void {
  activeGlobalSink = new InMemoryDiagnosticSink();
}

/**
 * Retrieves the recent diagnostic records from the global in-memory sink.
 */
export function getRecentDiagnosticRecords(): SyncDiagnosticRecord[] {
  if (activeGlobalSink instanceof InMemoryDiagnosticSink) {
    return activeGlobalSink.getRecords();
  }
  return [];
}

/**
 * Clears the records in the global in-memory sink.
 */
export function clearDiagnosticRecords(): void {
  if (activeGlobalSink instanceof InMemoryDiagnosticSink) {
    activeGlobalSink.clear();
  }
}

/**
 * Safely emits a diagnostic event to the target sink.
 * Traps any sink errors to guarantee diagnostic collection never affects sync correctness.
 */
export function emitSyncDiagnostic(
  event: SyncDiagnosticRecord,
  sink: SyncDiagnosticSink = activeGlobalSink
): void {
  try {
    sink.record(event);
  } catch (err) {
    if (isDevelopmentEnvironment()) {
      console.warn('[SyncDiagnostics] Sink threw error during event emission:', err);
    }
  }
}
