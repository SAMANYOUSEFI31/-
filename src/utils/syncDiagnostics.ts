import { OfflineQueueItem, ReplayFailureClassification } from '../types';
import { SyncTrigger, SyncRunStatus, SyncRunOutcome } from './syncOrchestrator';
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
 * 2. Closed Typed Vocabulary: Events and error categories are strictly enumerated.
 * 3. Non-Invasive & Isolated: Diagnostic sink errors never throw into sync execution.
 * 4. Bounded In-Memory Retention: Small FIFO ring buffer with no default disk/network persistence.
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
  outcomeStatus?: SyncRunStatus | string;
  errorCategory?: SafeSyncErrorCategory;
  safeReason?: SafeSyncReason | string;
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
 * In-memory bounded FIFO ring buffer diagnostic sink.
 */
export class InMemoryDiagnosticSink implements SyncDiagnosticSink {
  private buffer: SyncDiagnosticRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = MAX_DIAGNOSTIC_RECORDS) {
    this.maxRecords = maxRecords;
  }

  public record(event: SyncDiagnosticRecord): void {
    // Construct sanitized record containing only approved metadata
    const safeRecord: SyncDiagnosticRecord = {
      eventType: event.eventType,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      ...(event.runId !== undefined && { runId: String(event.runId) }),
      ...(event.trigger !== undefined && { trigger: event.trigger }),
      ...(event.triggers !== undefined && { triggers: [...event.triggers] }),
      ...(event.force !== undefined && { force: Boolean(event.force) }),
      ...(event.syncedCount !== undefined && { syncedCount: Number(event.syncedCount) }),
      ...(event.failedCount !== undefined && { failedCount: Number(event.failedCount) }),
      ...(event.remainingQueueCount !== undefined && { remainingQueueCount: Number(event.remainingQueueCount) }),
      ...(event.itemCount !== undefined && { itemCount: Number(event.itemCount) }),
      ...(event.outcomeStatus !== undefined && { outcomeStatus: event.outcomeStatus }),
      ...(event.errorCategory !== undefined && { errorCategory: event.errorCategory }),
      ...(event.safeReason !== undefined && { safeReason: event.safeReason }),
      ...(event.durationMs !== undefined && { durationMs: Number(event.durationMs) }),
      ...(event.remoteCyclesCount !== undefined && { remoteCyclesCount: Number(event.remoteCyclesCount) }),
      ...(event.remoteLogsCount !== undefined && { remoteLogsCount: Number(event.remoteLogsCount) }),
      ...(event.pendingMutationsCount !== undefined && { pendingMutationsCount: Number(event.pendingMutationsCount) }),
      ...(event.reconciledCyclesCount !== undefined && { reconciledCyclesCount: Number(event.reconciledCyclesCount) }),
      ...(event.reconciledLogsCount !== undefined && { reconciledLogsCount: Number(event.reconciledLogsCount) }),
      ...(event.demoConsumedChanged !== undefined && { demoConsumedChanged: Boolean(event.demoConsumedChanged) })
    };

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
