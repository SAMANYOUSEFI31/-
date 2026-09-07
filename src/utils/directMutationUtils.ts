/**
 * Direct Mutation Contract Utilities for Bushido Discipline OS (Phase 4A)
 *
 * Implements pure helpers for:
 * 1. Capturing confirmed entity snapshots prior to optimistic updates
 * 2. Marking optimistic updates as unsynced (isSynced: false)
 * 3. Rolling back to confirmed snapshots upon HTTP 409 (Conflict) / 428 (Precondition Required)
 * 4. Explicit expectedRevision validation & payload preparation
 * 5. Asynchronous post-fetch account switch protection
 */

import { Cycle, DailyLog, OfflineQueueItem } from '../types';
import { 
  normalizeQueueOwner, 
  isValidLogResponse, 
  isValidCycleResponse,
  enqueueOfflineMutation,
  enqueueDurableDailyLogWriteAhead,
  enqueueDurableCycleWriteAhead,
  getOfflineQueue,
  saveOfflineQueue,
  removeReplayedQueueItems,
  recordQueueItemFailure,
  markQueueItemInFlight,
  isQueueItemInFlight,
  recordClientConflict,
  parseSafeConflictDetails,
  calculateReplayBackoffMs,
  classifyReplayResponse,
  shouldQueueOfflineMutation,
  quarantineQueueItems
} from './offlineQueueUtils';

export interface OptimisticUpdateResult<T> {
  nextState: T[];
  previousConfirmedSnapshot: T | null;
}

/**
 * Optimistically updates a DailyLog in local UI state, capturing the previous
 * confirmed entity snapshot and marking the optimistic entity unsynced (isSynced: false).
 */
export function applyOptimisticLogUpdate(
  currentLogs: DailyLog[],
  updatedLog: DailyLog
): { nextLogs: DailyLog[]; previousConfirmedSnapshot: DailyLog | null } {
  const existingIdx = currentLogs.findIndex(l => l.date === updatedLog.date);
  let previousConfirmedSnapshot: DailyLog | null = null;

  const optimisticLog: DailyLog = {
    ...updatedLog,
    isSynced: false
  };
  if (optimisticLog.id && optimisticLog.id.startsWith('virtual-')) {
    optimisticLog.id = `log-${optimisticLog.date}`;
  }
  delete (optimisticLog as any).isVirtual;

  let nextLogs: DailyLog[];
  if (existingIdx >= 0) {
    previousConfirmedSnapshot = { ...currentLogs[existingIdx] };
    nextLogs = [...currentLogs];
    nextLogs[existingIdx] = optimisticLog;
  } else {
    nextLogs = [...currentLogs, optimisticLog];
  }

  return { nextLogs, previousConfirmedSnapshot };
}

/**
 * Restores the previous confirmed DailyLog snapshot upon HTTP 409 / 428 rejection.
 * Never leaves the rejected optimistic entity marked as confirmed or synced.
 */
export function rollbackOptimisticLogUpdate(
  currentLogs: DailyLog[],
  targetDate: string,
  confirmedSnapshot: DailyLog | null
): DailyLog[] {
  if (confirmedSnapshot) {
    const existingIdx = currentLogs.findIndex(l => l.date === targetDate);
    const restored = { ...confirmedSnapshot, isSynced: true };
    if (existingIdx >= 0) {
      const next = [...currentLogs];
      next[existingIdx] = restored;
      return next;
    }
    return [...currentLogs, restored];
  }

  // If no previous snapshot existed (e.g. optimistic insert of new log), remove the rejected log
  return currentLogs.filter(l => l.date !== targetDate);
}

/**
 * Optimistically updates a Cycle in local UI state, capturing the previous
 * confirmed entity snapshot and marking the optimistic entity unsynced (isSynced: false).
 */
export function applyOptimisticCycleUpdate(
  currentCycles: Cycle[],
  updatedCycle: Cycle
): { nextCycles: Cycle[]; previousConfirmedSnapshot: Cycle | null } {
  const existingIdx = currentCycles.findIndex(c => c.id === updatedCycle.id);
  let previousConfirmedSnapshot: Cycle | null = null;

  const optimisticCycle: Cycle = {
    ...updatedCycle,
    isSynced: false
  };

  let nextCycles: Cycle[];
  if (existingIdx >= 0) {
    previousConfirmedSnapshot = { ...currentCycles[existingIdx] };
    nextCycles = [...currentCycles];
    nextCycles[existingIdx] = optimisticCycle;
  } else {
    nextCycles = [...currentCycles, optimisticCycle];
  }

  return { nextCycles, previousConfirmedSnapshot };
}

/**
 * Restores the previous confirmed Cycle snapshot upon HTTP 409 / 428 rejection.
 */
export function rollbackOptimisticCycleUpdate(
  currentCycles: Cycle[],
  cycleId: string,
  confirmedSnapshot: Cycle | null
): Cycle[] {
  if (confirmedSnapshot) {
    const existingIdx = currentCycles.findIndex(c => c.id === cycleId);
    const restored = { ...confirmedSnapshot, isSynced: true };
    if (existingIdx >= 0) {
      const next = [...currentCycles];
      next[existingIdx] = restored;
      return next;
    }
    return [...currentCycles, restored];
  }

  return currentCycles.filter(c => c.id !== cycleId);
}

/**
 * Restores a deleted Cycle and its associated DailyLogs upon HTTP 409 / 428 rejection.
 */
export function rollbackOptimisticCycleDelete(
  currentCycles: Cycle[],
  currentLogs: DailyLog[],
  cycleId: string,
  targetCycleBackup: Cycle | null,
  targetLogsBackup: DailyLog[]
): { nextCycles: Cycle[]; nextLogs: DailyLog[] } {
  let nextCycles = currentCycles;
  if (targetCycleBackup && !currentCycles.some(c => c.id === cycleId)) {
    nextCycles = [...currentCycles, { ...targetCycleBackup, isSynced: true }];
  }

  let nextLogs = currentLogs;
  if (targetLogsBackup.length > 0) {
    const existingDates = new Set(currentLogs.map(l => l.date));
    const missingLogs = targetLogsBackup
      .filter(tl => !existingDates.has(tl.date))
      .map(tl => ({ ...tl, isSynced: true }));
    if (missingLogs.length > 0) {
      nextLogs = [...currentLogs, ...missingLogs];
    }
  }

  return { nextCycles, nextLogs };
}

export function rollbackOptimisticCycleCreate(
  currentCycles: Cycle[],
  currentLogs: DailyLog[],
  newCycleId: string,
  previousCyclesSnapshot: Cycle[],
  previousLogsSnapshot: DailyLog[]
): { nextCycles: Cycle[]; nextLogs: DailyLog[] } {
  const nextCycles = currentCycles.filter(c => c.id !== newCycleId);
  
  for (const snapshotCycle of previousCyclesSnapshot) {
    if (!nextCycles.some(c => c.id === snapshotCycle.id)) {
      nextCycles.push({ ...snapshotCycle });
    }
  }

  const nextLogs = [...currentLogs];
  for (const snapshotLog of previousLogsSnapshot) {
    if (!nextLogs.some(l => l.date === snapshotLog.date && l.cycleId === snapshotLog.cycleId)) {
      nextLogs.push({ ...snapshotLog });
    }
  }

  return { nextCycles, nextLogs };
}

/**
 * Validates and prepares the explicit expectedRevision for an entity mutation.
 * Rejects missing or non-positive integer revisions for existing entities.
 */
export function prepareExistingEntityRevision(
  entity: { revision?: number } | null | undefined
): { isExisting: boolean; expectedRevision?: number; isValidForMutation: boolean } {
  if (!entity) {
    return { isExisting: false, isValidForMutation: true };
  }

  const rawRev = entity.revision;
  if (typeof rawRev === 'number' && Number.isInteger(rawRev) && rawRev > 0) {
    return {
      isExisting: true,
      expectedRevision: rawRev,
      isValidForMutation: true
    };
  }

  return {
    isExisting: true,
    expectedRevision: undefined,
    isValidForMutation: false
  };
}

/**
 * Prepares direct DailyLog update payload with explicit expectedRevision.
 */
export function prepareDirectLogPayload(
  updatedLog: DailyLog,
  existingLog: DailyLog | null | undefined,
  activeCycleId?: string,
  clientOperationId?: string
): {
  payload: Record<string, any>;
  expectedRevision?: number;
  isExisting: boolean;
  isValid: boolean;
} {
  const cycleId = updatedLog.cycleId || activeCycleId;
  const isExisting = Boolean(existingLog || (updatedLog.revision && updatedLog.revision > 0));

  if (!isExisting) {
    // True first create: do not send expectedRevision
    const payload: Record<string, any> = {
      ...updatedLog,
      cycleId,
      ...(clientOperationId ? { clientOperationId } : {})
    };
    if (payload.id && typeof payload.id === 'string' && payload.id.startsWith('virtual-')) {
      payload.id = `log-${payload.date}`;
    }
    delete payload.isVirtual;
    delete payload.expectedRevision;
    return { payload, isExisting: false, isValid: true };
  }

  const rev = existingLog?.revision ?? updatedLog.revision;
  const isValidRev = typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

  if (!isValidRev) {
    const payload = { ...updatedLog, cycleId, ...(clientOperationId ? { clientOperationId } : {}) };
    if (payload.id && typeof payload.id === 'string' && payload.id.startsWith('virtual-')) {
      payload.id = `log-${payload.date}`;
    }
    delete (payload as any).isVirtual;
    return {
      payload,
      isExisting: true,
      isValid: false
    };
  }

  const payload: Record<string, any> = {
    ...updatedLog,
    cycleId,
    expectedRevision: rev,
    ...(clientOperationId ? { clientOperationId } : {})
  };
  if (payload.id && typeof payload.id === 'string' && payload.id.startsWith('virtual-')) {
    payload.id = `log-${payload.date}`;
  }
  delete payload.isVirtual;

  return {
    payload,
    expectedRevision: rev,
    isExisting: true,
    isValid: true
  };
}

/**
 * Prepares direct CREATE_CYCLE payload without expectedRevision.
 */
export function prepareDirectCreateCyclePayload(
  newCycle: Cycle,
  clientOperationId?: string
): {
  payload: Record<string, any>;
  isValid: boolean;
} {
  const isValid = Boolean(newCycle && newCycle.id && newCycle.title && newCycle.startDate && newCycle.endDate);
  const payload: Record<string, any> = {
    ...newCycle,
    ...(clientOperationId ? { clientOperationId } : {})
  };
  delete payload.expectedRevision;
  delete payload.revision;
  return {
    payload,
    isValid
  };
}

/**
 * Prepares direct Cycle update payload with explicit expectedRevision.
 */
export function prepareDirectCyclePayload(
  updatedCycle: Cycle,
  existingCycle: Cycle | null | undefined,
  clientOperationId?: string
): {
  payload: Record<string, any>;
  expectedRevision?: number;
  isValid: boolean;
} {
  const rev = existingCycle?.revision ?? updatedCycle.revision;
  const isValidRev = typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

  if (!isValidRev) {
    return {
      payload: { ...updatedCycle, ...(clientOperationId ? { clientOperationId } : {}) },
      isValid: false
    };
  }

  return {
    payload: {
      ...updatedCycle,
      expectedRevision: rev,
      ...(clientOperationId ? { clientOperationId } : {})
    },
    expectedRevision: rev,
    isValid: true
  };
}

/**
 * Prepares direct DELETE_CYCLE payload with explicit expectedRevision if existing cycle provided.
 */
export function prepareDirectDeleteCyclePayload(
  cycleId: string,
  existingCycle?: Cycle | null,
  clientOperationId?: string
): {
  payload: Record<string, any>;
  expectedRevision?: number;
  isValid: boolean;
} {
  if (!cycleId) {
    return {
      payload: { id: cycleId },
      isValid: false
    };
  }

  const rev = existingCycle?.revision;
  const hasRev = rev !== undefined && rev !== null;
  const isValidRev = typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

  if (hasRev && !isValidRev) {
    return {
      payload: { id: cycleId, ...(clientOperationId ? { clientOperationId } : {}) },
      isValid: false
    };
  }

  const payload: Record<string, any> = {
    id: cycleId,
    ...(isValidRev ? { expectedRevision: rev } : {}),
    ...(clientOperationId ? { clientOperationId } : {})
  };

  return {
    payload,
    expectedRevision: isValidRev ? rev : undefined,
    isValid: true
  };
}

/**
 * Verifies that the active account has remained stable across asynchronous boundaries.
 */
export function verifyActiveAccount(
  initialOwnerId: string | null | undefined,
  currentOwnerId: string | null | undefined
): boolean {
  const normInitial = normalizeQueueOwner(initialOwnerId);
  const normCurrent = normalizeQueueOwner(currentOwnerId);

  if (!normInitial || normInitial === 'guest') return false;
  return normInitial === normCurrent;
}

/**
 * Propagates authoritative server replay results and revisions into active React state.
 * Supports:
 * - UPDATE_LOG: updates matching date log with server fields, revision, and isSynced: true
 * - UPDATE_CYCLE & CREATE_CYCLE: updates or inserts matching cycle with server fields, revision, and isSynced: true
 * - DELETE_CYCLE: removes matching cycle and all associated logs from active state
 */
export function applyReplayItemToActiveState(
  currentState: { cycles: Cycle[]; logs: DailyLog[] },
  item: { type: string; payload?: any; id?: string; ownerId?: string; dedupKey?: string },
  serverResult?: any
): { cycles: Cycle[]; logs: DailyLog[] } {
  const { cycles, logs } = currentState;

  if (item.type === 'UPDATE_LOG') {
    const serverLog = serverResult?.log || serverResult;
    const targetDate = item.payload?.date;
    if (!isValidLogResponse(serverLog, targetDate)) {
      return currentState;
    }
    const ownerId = normalizeQueueOwner(item.ownerId);
    const currentQueue = getOfflineQueue(ownerId);
    const dedupKey = item.dedupKey || (item.payload?.cycleId ? `log:${item.payload.cycleId}:${targetDate}` : null);
    const hasNewerInQueue = currentQueue.some(
      q => q.type === 'UPDATE_LOG' && (dedupKey ? q.dedupKey === dedupKey : q.payload?.date === targetDate) && q.id !== item.id
    );

    const nextLogs = logs.map(l => {
      if (l.date === targetDate) {
        if (hasNewerInQueue) {
          // A newer local edit is still pending in the queue, preserve local habit flags and update revision
          return {
            ...l,
            revision: serverLog.revision,
            isSynced: false
          };
        }
        return {
          ...l,
          ...serverLog,
          isSynced: true
        };
      }
      return l;
    });
    return { cycles, logs: nextLogs };
  }

  if (item.type === 'UPDATE_CYCLE' || item.type === 'CREATE_CYCLE') {
    const serverCycle = serverResult?.cycle || serverResult;
    const targetId = item.payload?.id || item.id;
    if (!isValidCycleResponse(serverCycle, targetId)) {
      return currentState;
    }
    const exists = cycles.some(c => c.id === targetId);

    let nextCycles: Cycle[];
    if (exists) {
      nextCycles = cycles.map(c => {
        if (c.id === targetId) {
          return {
            ...c,
            ...serverCycle,
            isSynced: true
          };
        }
        return c;
      });
    } else {
      nextCycles = [...cycles, { ...serverCycle, isSynced: true }];
    }
    return { cycles: nextCycles, logs };
  }

  if (item.type === 'DELETE_CYCLE') {
    const cycleId = typeof item.payload === 'string' ? item.payload : item.payload?.id;
    if (cycleId) {
      return {
        cycles: cycles.filter(c => c.id !== cycleId),
        logs: logs.filter(l => l.cycleId !== cycleId)
      };
    }
  }

  return currentState;
}

export interface ExecuteDirectDailyLogMutationParams {
  updatedLog: DailyLog;
  existingLog: DailyLog | null | undefined;
  ownerId: string | null | undefined;
  authToken: string | null | undefined;
  activeCycleId?: string;
  fetchFn?: typeof fetch;
  activeAccountRef?: { current: string | null };
}

export type DirectDailyLogMutationResult =
  | { status: 'IGNORED_NO_AUTH_NO_QUEUE' }
  | { status: 'INVALID_PRECONDITION'; messageFa: string; clientPayload: any }
  | { status: 'QUEUED_OFFLINE'; queueItem: OfflineQueueItem }
  | { status: 'ACCOUNT_SWITCHED'; queueItemId: string }
  | { status: 'SUCCESS'; serverLog: any; queueItemId: string; hasNewerIntent: boolean }
  | { status: 'INVALID_SUCCESS_RESPONSE'; queueItemId: string; errorMsg: string }
  | { status: 'AUTH_REQUIRED'; statusCode: 401; queueItemId: string }
  | { status: 'FORBIDDEN'; statusCode: 403; queueItemId: string }
  | { status: 'VALIDATION_ERROR'; statusCode: number; queueItemId: string }
  | { status: 'ENTITY_MISSING'; statusCode: 404; queueItemId: string }
  | { status: 'CONFLICT'; statusCode: 409 | 428; conflictDetails: any; queueItemId: string }
  | { status: 'RATE_LIMITED'; statusCode: 429; queueItemId: string; retryCount: number; nextRetryAt?: number }
  | { status: 'SERVER_RETRYABLE'; statusCode: number; queueItemId: string; retryCount: number; nextRetryAt?: number }
  | { status: 'NETWORK_ERROR'; error: any; queueItemId: string }
  | { status: 'STORAGE_WRITE_FAILED'; reason: string; errorMsg: string; messageFa: string; queueItemId?: string };

/**
 * Phase 6.1A: Durable DailyLog Write-Ahead Mutation Executor
 *
 * Enforces the Write-Ahead Durability contract:
 * 1. Validates preconditions and expectedRevision.
 * 2. Durably persists and verifies the mutation in the owner's Offline Queue BEFORE any network attempt.
 * 3. Shares identical operation identity (queueItem.id / clientOperationId) between direct execution and replay.
 * 4. Marks the queue item in-flight during dispatch to protect it from compaction/overwrites.
 * 5. On verified 2xx response (checked with isValidLogResponse), removes ONLY the exact confirmed queue item.
 * 6. On conflict (409/428), removes the rejected queue item to avoid replay loops and records safe conflict metadata.
 * 7. On network error or retryable server error (5xx/429), leaves the item safely in the queue with exponential backoff.
 */
export async function executeDirectDailyLogMutation(
  params: ExecuteDirectDailyLogMutationParams
): Promise<DirectDailyLogMutationResult> {
  const { updatedLog, existingLog, activeCycleId, authToken, fetchFn, activeAccountRef } = params;
  const ownerId = normalizeQueueOwner(params.ownerId);

  const guard = shouldQueueOfflineMutation({ ownerId, authToken });
  if (!guard.canSendToServer && !guard.shouldQueue) {
    return { status: 'IGNORED_NO_AUTH_NO_QUEUE' };
  }

  const { payload: logPayload, expectedRevision, isExisting, isValid } = prepareDirectLogPayload(
    updatedLog,
    existingLog,
    activeCycleId
  );

  if (isExisting && !isValid) {
    recordClientConflict(ownerId, {
      mutationType: 'UPDATE_LOG',
      entityType: 'DAILY_LOG',
      entityId: updatedLog.date,
      conflictType: 'PRECONDITION_REQUIRED',
      statusCode: 428,
      expectedRevision: undefined,
      currentRevision: undefined,
      messageFa: 'نسخه تأیید شده این گزارش در حافظه محلی معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: logPayload
    });
    return {
      status: 'INVALID_PRECONDITION',
      messageFa: 'نسخه تأیید شده این گزارش در حافظه محلی معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: logPayload
    };
  }

  // 1. Durable Write-Ahead Enqueue with Authoritative Storage Read-back Verification
  const durableResult = enqueueDurableDailyLogWriteAhead(ownerId, {
    type: 'UPDATE_LOG',
    payload: logPayload,
    expectedRevision
  });

  if (durableResult.success === false) {
    return {
      status: 'STORAGE_WRITE_FAILED',
      reason: durableResult.reason,
      errorMsg: durableResult.errorMsg,
      messageFa: 'خطا در ذخیره‌سازی محلی. تغییرات در صف آفلاین ثبت نشد و به سرور ارسال نمی‌شود.',
      queueItemId: durableResult.candidateItem?.id
    };
  }

  const queueItem = durableResult.queueItem;

  // 2. Offline Guard or In-Flight Concurrency Guard
  const currentQueue = getOfflineQueue(ownerId);
  const isEarlierMutationInFlight = currentQueue.some(
    item => item.type === 'UPDATE_LOG' &&
      item.dedupKey === queueItem.dedupKey &&
      item.id !== queueItem.id &&
      (isQueueItemInFlight(ownerId, item.id) || item.inFlight)
  );

  if (guard.shouldQueue || isEarlierMutationInFlight) {
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  // 3. Mark the queue item in-flight during direct online execution
  markQueueItemInFlight(ownerId, queueItem.id, true);

  // 4. Construct request with stable clientOperationId matching queueItem.id
  const requestBody = {
    ...logPayload,
    clientOperationId: queueItem.id,
    ...(typeof expectedRevision === 'number' && Number.isInteger(expectedRevision) && expectedRevision > 0
      ? { expectedRevision }
      : {})
  };

  const activeFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!activeFetch) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  try {
    const res = await activeFetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(requestBody)
    });

    // Post-fetch Account Switch Verification
    if (activeAccountRef && !verifyActiveAccount(activeAccountRef.current, ownerId)) {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      return { status: 'ACCOUNT_SWITCHED', queueItemId: queueItem.id };
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const serverLog = data?.log;

      if (isValidLogResponse(serverLog, updatedLog.date)) {
        // Check if a newer local edit was enqueued while this request was in flight
        const currentQueue = getOfflineQueue(ownerId);
        const hasNewerIntent = currentQueue.some(
          item => item.type === 'UPDATE_LOG' && item.dedupKey === queueItem.dedupKey && item.id !== queueItem.id
        );

        if (hasNewerIntent) {
          // Update newer queue item's expectedRevision to serverLog.revision
          const updatedQueue = currentQueue.map(item => {
            if (item.type === 'UPDATE_LOG' && item.dedupKey === queueItem.dedupKey && item.id !== queueItem.id) {
              return {
                ...item,
                expectedRevision: serverLog.revision,
                payload: {
                  ...item.payload,
                  expectedRevision: serverLog.revision
                }
              };
            }
            return item;
          });
          saveOfflineQueue(ownerId, updatedQueue);
        }

        // Exact confirmed operation identity removal: remove ONLY queueItem.id
        removeReplayedQueueItems(ownerId, [queueItem.id]);

        return {
          status: 'SUCCESS',
          serverLog,
          queueItemId: queueItem.id,
          hasNewerIntent
        };
      } else {
        // Malformed or mismatched success response: do NOT mark synced, do NOT remove from queue
        markQueueItemInFlight(ownerId, queueItem.id, false);
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const errorMsg = 'Malformed or mismatched success response from server';
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          errorMsg,
          backoffMs,
          'INVALID_SUCCESS_RESPONSE'
        );
        return {
          status: 'INVALID_SUCCESS_RESPONSE',
          queueItemId: queueItem.id,
          errorMsg
        };
      }
    } else {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      const classification = classifyReplayResponse(res.status, 'UPDATE_LOG');

      if (classification === 'AUTH_REQUIRED') {
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 401 Unauthorized', 0, 'AUTH_REQUIRED');
        return {
          status: 'AUTH_REQUIRED',
          statusCode: 401,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'FORBIDDEN') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'FORBIDDEN' }],
          'HTTP 403 Forbidden - permission denied',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'FORBIDDEN',
          statusCode: 403,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'ENTITY_MISSING') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'ENTITY_MISSING' }],
          'HTTP 404 Entity Missing for UPDATE_LOG',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'ENTITY_MISSING',
          statusCode: 404,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'VALIDATION_ERROR') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
          `HTTP ${res.status} Validation Error`,
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'VALIDATION_ERROR',
          statusCode: res.status,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'CONFLICT_DEFERRED' || classification === 'PRECONDITION_REQUIRED') {
        removeReplayedQueueItems(ownerId, [queueItem.id]);

        const conflictJson = await res.json().catch(() => null);
        const parsedConflict = parseSafeConflictDetails(res.status, conflictJson, 'DAILY_LOG', updatedLog.date);
        recordClientConflict(ownerId, {
          mutationType: 'UPDATE_LOG',
          entityType: parsedConflict.entityType,
          entityId: parsedConflict.entityId,
          conflictType: parsedConflict.conflictType,
          statusCode: parsedConflict.statusCode,
          expectedRevision: parsedConflict.expectedRevision ?? expectedRevision,
          currentRevision: parsedConflict.currentRevision,
          messageFa: parsedConflict.messageFa,
          clientPayload: logPayload,
          operationId: queueItem.id
        });

        return {
          status: 'CONFLICT',
          statusCode: res.status as 409 | 428,
          conflictDetails: parsedConflict,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'RATE_LIMITED') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 429 Rate Limited', backoffMs, 'RATE_LIMITED');
        return {
          status: 'RATE_LIMITED',
          statusCode: 429,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      if (classification === 'SERVER_RETRYABLE') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          `Server returned HTTP ${res.status} (SERVER_RETRYABLE)`,
          backoffMs,
          'SERVER_RETRYABLE'
        );
        return {
          status: 'SERVER_RETRYABLE',
          statusCode: res.status,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      quarantineQueueItems(
        [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
        `Server returned unhandled HTTP ${res.status}`,
        ownerId
      );
      removeReplayedQueueItems(ownerId, [queueItem.id]);
      return {
        status: 'VALIDATION_ERROR',
        statusCode: res.status,
        queueItemId: queueItem.id
      };
    }
  } catch (err: any) {
    // Network interruption or timeout: preserve queue item, do NOT enqueue a duplicate
    markQueueItemInFlight(ownerId, queueItem.id, false);
    const nextRetryCount = (queueItem.retryCount || 0) + 1;
    const backoffMs = calculateReplayBackoffMs(nextRetryCount);
    recordQueueItemFailure(
      ownerId,
      queueItem.id,
      err?.message || 'Network request failed',
      backoffMs,
      'NETWORK_ERROR'
    );
    return {
      status: 'NETWORK_ERROR',
      error: err,
      queueItemId: queueItem.id
    };
  }
}

export interface ExecuteDirectCreateCycleMutationParams {
  newCycle: Cycle;
  ownerId: string | null | undefined;
  authToken: string | null | undefined;
  fetchFn?: typeof fetch;
  activeAccountRef?: { current: string | null };
}

export interface ExecuteDirectUpdateCycleMutationParams {
  updatedCycle: Cycle;
  existingCycle: Cycle | null | undefined;
  ownerId: string | null | undefined;
  authToken: string | null | undefined;
  fetchFn?: typeof fetch;
  activeAccountRef?: { current: string | null };
}

export interface ExecuteDirectDeleteCycleMutationParams {
  cycleId: string;
  existingCycle?: Cycle | null | undefined;
  ownerId: string | null | undefined;
  authToken: string | null | undefined;
  fetchFn?: typeof fetch;
  activeAccountRef?: { current: string | null };
}

export type DirectCycleMutationResult =
  | { status: 'IGNORED_NO_AUTH_NO_QUEUE' }
  | { status: 'INVALID_PRECONDITION'; messageFa: string; clientPayload: any }
  | { status: 'QUEUED_OFFLINE'; queueItem: OfflineQueueItem }
  | { status: 'ACCOUNT_SWITCHED'; queueItemId: string }
  | { status: 'SUCCESS'; serverCycle?: any; cycleId?: string; queueItemId: string; hasNewerIntent?: boolean; is404Deleted?: boolean }
  | { status: 'INVALID_SUCCESS_RESPONSE'; queueItemId: string; errorMsg: string }
  | { status: 'AUTH_REQUIRED'; statusCode: 401; queueItemId: string }
  | { status: 'FORBIDDEN'; statusCode: 403; queueItemId: string }
  | { status: 'VALIDATION_ERROR'; statusCode: number; queueItemId: string }
  | { status: 'ENTITY_MISSING'; statusCode: 404; queueItemId: string }
  | { status: 'CONFLICT'; statusCode: 409 | 428; conflictDetails: any; queueItemId: string }
  | { status: 'RATE_LIMITED'; statusCode: 429; queueItemId: string; retryCount: number; nextRetryAt?: number }
  | { status: 'SERVER_RETRYABLE'; statusCode: number; queueItemId: string; retryCount: number; nextRetryAt?: number }
  | { status: 'NETWORK_ERROR'; error: any; queueItemId: string }
  | { status: 'STORAGE_WRITE_FAILED'; reason: string; errorMsg: string; messageFa: string; queueItemId?: string };

/**
 * Phase 6.1B: Durable CREATE_CYCLE Write-Ahead Mutation Executor
 */
export async function executeDirectCreateCycleMutation(
  params: ExecuteDirectCreateCycleMutationParams
): Promise<DirectCycleMutationResult> {
  const { newCycle, authToken, fetchFn, activeAccountRef } = params;
  const ownerId = normalizeQueueOwner(params.ownerId);

  const guard = shouldQueueOfflineMutation({ ownerId, authToken });
  if (!guard.canSendToServer && !guard.shouldQueue) {
    return { status: 'IGNORED_NO_AUTH_NO_QUEUE' };
  }

  const { payload: cyclePayload, isValid } = prepareDirectCreateCyclePayload(newCycle);
  if (!isValid) {
    return {
      status: 'INVALID_PRECONDITION',
      messageFa: 'اطلاعات چرخه جدید نامعتبر است.',
      clientPayload: cyclePayload
    };
  }

  // 1. Durable Write-Ahead Enqueue with Authoritative Storage Read-back Verification
  const durableResult = enqueueDurableCycleWriteAhead(ownerId, {
    type: 'CREATE_CYCLE',
    payload: cyclePayload
  });

  if (durableResult.success === false) {
    return {
      status: 'STORAGE_WRITE_FAILED',
      reason: durableResult.reason,
      errorMsg: durableResult.errorMsg,
      messageFa: 'خطا در ذخیره‌سازی محلی. تغییرات در صف آفلاین ثبت نشد و به سرور ارسال نمی‌شود.',
      queueItemId: durableResult.candidateItem?.id
    };
  }

  const queueItem = durableResult.queueItem;

  const currentQueue = getOfflineQueue(ownerId);
  const isEarlierCreateInFlight = currentQueue.some(
    item => item.type === 'CREATE_CYCLE' &&
      item.payload?.id === newCycle.id &&
      item.id !== queueItem.id &&
      (isQueueItemInFlight(ownerId, item.id) || item.inFlight)
  );

  // 2. Offline Guard: stop here if offline or if earlier CREATE_CYCLE is in-flight
  if (guard.shouldQueue || isEarlierCreateInFlight) {
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  // 3. Mark the queue item in-flight during direct online execution
  markQueueItemInFlight(ownerId, queueItem.id, true);

  // 4. Construct request with stable clientOperationId matching queueItem.id
  const requestBody = {
    ...cyclePayload,
    id: cyclePayload.id || queueItem.id,
    clientOperationId: queueItem.id
  };

  const activeFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!activeFetch) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  try {
    const res = await activeFetch('/api/cycles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(requestBody)
    });

    // Post-fetch Account Switch Verification
    if (activeAccountRef && !verifyActiveAccount(activeAccountRef.current, ownerId)) {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      return { status: 'ACCOUNT_SWITCHED', queueItemId: queueItem.id };
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const serverCycle = data?.cycle;

      if (isValidCycleResponse(serverCycle, newCycle.id)) {
        // Check if a newer local edit was enqueued while this request was in flight
        const currentQueue = getOfflineQueue(ownerId);
        const hasNewerIntent = currentQueue.some(
          item => (item.type === 'UPDATE_CYCLE' || item.type === 'DELETE_CYCLE' || item.type === 'CREATE_CYCLE') &&
            ((typeof item.payload === 'object' && item.payload?.id === newCycle.id) || item.payload === newCycle.id) &&
            item.id !== queueItem.id
        );

        if (hasNewerIntent) {
          const updatedQueue = currentQueue.flatMap(item => {
            if (
              (item.type === 'UPDATE_CYCLE' || item.type === 'DELETE_CYCLE' || item.type === 'CREATE_CYCLE') &&
              ((typeof item.payload === 'object' && item.payload?.id === newCycle.id) || item.payload === newCycle.id) &&
              item.id !== queueItem.id
            ) {
              if (item.type === 'CREATE_CYCLE') {
                const isIdentical = (
                  item.payload.title === serverCycle.title &&
                  item.payload.startDate === serverCycle.startDate &&
                  item.payload.endDate === serverCycle.endDate &&
                  item.payload.targetTheme === serverCycle.targetTheme
                );
                if (isIdentical) return [];
                
                return [{
                  ...item,
                  type: 'UPDATE_CYCLE' as 'UPDATE_CYCLE',
                  expectedRevision: serverCycle.revision,
                  payload: {
                    ...item.payload,
                    expectedRevision: serverCycle.revision
                  }
                }];
              }

              return [{
                ...item,
                expectedRevision: serverCycle.revision,
                payload: typeof item.payload === 'object' && item.payload !== null
                  ? {
                      ...item.payload,
                      expectedRevision: serverCycle.revision
                    }
                  : item.payload
              }];
            }
            return [item];
          });
          saveOfflineQueue(ownerId, updatedQueue);
        }

        removeReplayedQueueItems(ownerId, [queueItem.id]);

        return {
          status: 'SUCCESS',
          serverCycle,
          cycleId: newCycle.id,
          queueItemId: queueItem.id,
          hasNewerIntent
        };
      } else {
        markQueueItemInFlight(ownerId, queueItem.id, false);
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const errorMsg = 'Malformed or mismatched success response from server';
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          errorMsg,
          backoffMs,
          'INVALID_SUCCESS_RESPONSE'
        );
        return {
          status: 'INVALID_SUCCESS_RESPONSE',
          queueItemId: queueItem.id,
          errorMsg
        };
      }
    } else {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      const classification = classifyReplayResponse(res.status, 'CREATE_CYCLE');

      if (classification === 'AUTH_REQUIRED') {
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 401 Unauthorized', 0, 'AUTH_REQUIRED');
        return {
          status: 'AUTH_REQUIRED',
          statusCode: 401,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'FORBIDDEN') {
        const currentQueueForCleanup = getOfflineQueue(ownerId);
        const dependentDeletes = currentQueueForCleanup.filter(item =>
          item.type === 'DELETE_CYCLE' && item.parentOperationId === queueItem.id
        ).map(item => item.id);

        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'FORBIDDEN' }],
          'HTTP 403 Forbidden - permission denied',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id, ...dependentDeletes]);
        return {
          status: 'FORBIDDEN',
          statusCode: 403,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'VALIDATION_ERROR') {
        const currentQueueForCleanup = getOfflineQueue(ownerId);
        const dependentDeletes = currentQueueForCleanup.filter(item =>
          item.type === 'DELETE_CYCLE' && item.parentOperationId === queueItem.id
        ).map(item => item.id);

        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
          `HTTP ${res.status} Validation Error`,
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id, ...dependentDeletes]);
        return {
          status: 'VALIDATION_ERROR',
          statusCode: res.status,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'CONFLICT_DEFERRED' || classification === 'PRECONDITION_REQUIRED') {
        removeReplayedQueueItems(ownerId, [queueItem.id]);

        const conflictJson = await res.json().catch(() => null);
        const parsedConflict = parseSafeConflictDetails(res.status, conflictJson, 'CYCLE', newCycle.id);
        recordClientConflict(ownerId, {
          mutationType: 'CREATE_CYCLE',
          entityType: parsedConflict.entityType,
          entityId: parsedConflict.entityId,
          conflictType: parsedConflict.conflictType,
          statusCode: parsedConflict.statusCode,
          expectedRevision: parsedConflict.expectedRevision,
          currentRevision: parsedConflict.currentRevision,
          messageFa: parsedConflict.messageFa,
          clientPayload: cyclePayload,
          operationId: queueItem.id
        });

        return {
          status: 'CONFLICT',
          statusCode: res.status as 409 | 428,
          conflictDetails: parsedConflict,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'RATE_LIMITED') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 429 Rate Limited', backoffMs, 'RATE_LIMITED');
        return {
          status: 'RATE_LIMITED',
          statusCode: 429,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      if (classification === 'SERVER_RETRYABLE') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          `Server returned HTTP ${res.status} (SERVER_RETRYABLE)`,
          backoffMs,
          'SERVER_RETRYABLE'
        );
        return {
          status: 'SERVER_RETRYABLE',
          statusCode: res.status,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      quarantineQueueItems(
        [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
        `Server returned unhandled HTTP ${res.status}`,
        ownerId
      );
      removeReplayedQueueItems(ownerId, [queueItem.id]);
      return {
        status: 'VALIDATION_ERROR',
        statusCode: res.status,
        queueItemId: queueItem.id
      };
    }
  } catch (err: any) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    const nextRetryCount = (queueItem.retryCount || 0) + 1;
    const backoffMs = calculateReplayBackoffMs(nextRetryCount);
    recordQueueItemFailure(
      ownerId,
      queueItem.id,
      err?.message || 'Network request failed',
      backoffMs,
      'NETWORK_ERROR'
    );
    return {
      status: 'NETWORK_ERROR',
      error: err,
      queueItemId: queueItem.id
    };
  }
}

/**
 * Phase 6.1B: Durable UPDATE_CYCLE Write-Ahead Mutation Executor
 */
export async function executeDirectUpdateCycleMutation(
  params: ExecuteDirectUpdateCycleMutationParams
): Promise<DirectCycleMutationResult> {
  const { updatedCycle, existingCycle, authToken, fetchFn, activeAccountRef } = params;
  const ownerId = normalizeQueueOwner(params.ownerId);

  const guard = shouldQueueOfflineMutation({ ownerId, authToken });
  if (!guard.canSendToServer && !guard.shouldQueue) {
    return { status: 'IGNORED_NO_AUTH_NO_QUEUE' };
  }

  const { payload: cyclePayload, expectedRevision, isValid } = prepareDirectCyclePayload(
    updatedCycle,
    existingCycle
  );

  if (existingCycle && !isValid) {
    recordClientConflict(ownerId, {
      mutationType: 'UPDATE_CYCLE',
      entityType: 'CYCLE',
      entityId: updatedCycle.id,
      conflictType: 'PRECONDITION_REQUIRED',
      statusCode: 428,
      expectedRevision: undefined,
      currentRevision: undefined,
      messageFa: 'نسخه تأیید شده این چرخه در حافظه محلی معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: cyclePayload
    });
    return {
      status: 'INVALID_PRECONDITION',
      messageFa: 'نسخه تأیید شده این چرخه در حافظه محلی معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: cyclePayload
    };
  }

  // 1. Durable Write-Ahead Enqueue
  const durableResult = enqueueDurableCycleWriteAhead(ownerId, {
    type: 'UPDATE_CYCLE',
    payload: cyclePayload,
    expectedRevision
  });

  if (durableResult.success === false) {
    return {
      status: 'STORAGE_WRITE_FAILED',
      reason: durableResult.reason,
      errorMsg: durableResult.errorMsg,
      messageFa: 'خطا در ذخیره‌سازی محلی. تغییرات در صف آفلاین ثبت نشد و به سرور ارسال نمی‌شود.',
      queueItemId: durableResult.candidateItem?.id
    };
  }

  const queueItem = durableResult.queueItem;

  // 2. Offline Guard or In-Flight Concurrency Guard
  const currentQueue = getOfflineQueue(ownerId);
  const isEarlierMutationInFlight = currentQueue.some(
    item => (item.type === 'UPDATE_CYCLE' || item.type === 'CREATE_CYCLE') &&
      item.payload?.id === updatedCycle.id &&
      item.id !== queueItem.id &&
      (isQueueItemInFlight(ownerId, item.id) || item.inFlight)
  );

  if (guard.shouldQueue || isEarlierMutationInFlight) {
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  // 3. Mark in-flight
  markQueueItemInFlight(ownerId, queueItem.id, true);

  // 4. Request body with stable clientOperationId matching queueItem.id
  const requestBody = {
    ...cyclePayload,
    clientOperationId: queueItem.id,
    ...(typeof expectedRevision === 'number' && Number.isInteger(expectedRevision) && expectedRevision > 0
      ? { expectedRevision }
      : {})
  };

  const activeFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!activeFetch) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  try {
    const res = await activeFetch(`/api/cycles/${updatedCycle.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(requestBody)
    });

    // Post-fetch Account Switch Verification
    if (activeAccountRef && !verifyActiveAccount(activeAccountRef.current, ownerId)) {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      return { status: 'ACCOUNT_SWITCHED', queueItemId: queueItem.id };
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const serverCycle = data?.cycle;

      if (isValidCycleResponse(serverCycle, updatedCycle.id)) {
        const currentQueue = getOfflineQueue(ownerId);
        const hasNewerIntent = currentQueue.some(
          item => (item.type === 'UPDATE_CYCLE' || item.type === 'DELETE_CYCLE') &&
            ((typeof item.payload === 'object' && item.payload?.id === updatedCycle.id) || item.payload === updatedCycle.id) &&
            item.id !== queueItem.id
        );

        if (hasNewerIntent) {
          const updatedQueue = currentQueue.map(item => {
            if (
              (item.type === 'UPDATE_CYCLE' || item.type === 'DELETE_CYCLE') &&
              ((typeof item.payload === 'object' && item.payload?.id === updatedCycle.id) || item.payload === updatedCycle.id) &&
              item.id !== queueItem.id
            ) {
              return {
                ...item,
                expectedRevision: serverCycle.revision,
                payload: typeof item.payload === 'object' && item.payload !== null
                  ? {
                      ...item.payload,
                      expectedRevision: serverCycle.revision
                    }
                  : item.payload
              };
            }
            return item;
          });
          saveOfflineQueue(ownerId, updatedQueue);
        }

        removeReplayedQueueItems(ownerId, [queueItem.id]);

        return {
          status: 'SUCCESS',
          serverCycle,
          cycleId: updatedCycle.id,
          queueItemId: queueItem.id,
          hasNewerIntent
        };
      } else {
        markQueueItemInFlight(ownerId, queueItem.id, false);
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const errorMsg = 'Malformed or mismatched success response from server';
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          errorMsg,
          backoffMs,
          'INVALID_SUCCESS_RESPONSE'
        );
        return {
          status: 'INVALID_SUCCESS_RESPONSE',
          queueItemId: queueItem.id,
          errorMsg
        };
      }
    } else {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      const classification = classifyReplayResponse(res.status, 'UPDATE_CYCLE');

      if (classification === 'AUTH_REQUIRED') {
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 401 Unauthorized', 0, 'AUTH_REQUIRED');
        return {
          status: 'AUTH_REQUIRED',
          statusCode: 401,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'FORBIDDEN') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'FORBIDDEN' }],
          'HTTP 403 Forbidden - permission denied',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'FORBIDDEN',
          statusCode: 403,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'ENTITY_MISSING') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'ENTITY_MISSING' }],
          'HTTP 404 Entity Missing for UPDATE_CYCLE',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'ENTITY_MISSING',
          statusCode: 404,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'VALIDATION_ERROR') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
          `HTTP ${res.status} Validation Error`,
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'VALIDATION_ERROR',
          statusCode: res.status,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'CONFLICT_DEFERRED' || classification === 'PRECONDITION_REQUIRED') {
        removeReplayedQueueItems(ownerId, [queueItem.id]);

        const conflictJson = await res.json().catch(() => null);
        const parsedConflict = parseSafeConflictDetails(res.status, conflictJson, 'CYCLE', updatedCycle.id);
        recordClientConflict(ownerId, {
          mutationType: 'UPDATE_CYCLE',
          entityType: parsedConflict.entityType,
          entityId: parsedConflict.entityId,
          conflictType: parsedConflict.conflictType,
          statusCode: parsedConflict.statusCode,
          expectedRevision: parsedConflict.expectedRevision ?? expectedRevision,
          currentRevision: parsedConflict.currentRevision,
          messageFa: parsedConflict.messageFa,
          clientPayload: cyclePayload,
          operationId: queueItem.id
        });

        return {
          status: 'CONFLICT',
          statusCode: res.status as 409 | 428,
          conflictDetails: parsedConflict,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'RATE_LIMITED') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 429 Rate Limited', backoffMs, 'RATE_LIMITED');
        return {
          status: 'RATE_LIMITED',
          statusCode: 429,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      if (classification === 'SERVER_RETRYABLE') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          `Server returned HTTP ${res.status} (SERVER_RETRYABLE)`,
          backoffMs,
          'SERVER_RETRYABLE'
        );
        return {
          status: 'SERVER_RETRYABLE',
          statusCode: res.status,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      quarantineQueueItems(
        [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
        `Server returned unhandled HTTP ${res.status}`,
        ownerId
      );
      removeReplayedQueueItems(ownerId, [queueItem.id]);
      return {
        status: 'VALIDATION_ERROR',
        statusCode: res.status,
        queueItemId: queueItem.id
      };
    }
  } catch (err: any) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    const nextRetryCount = (queueItem.retryCount || 0) + 1;
    const backoffMs = calculateReplayBackoffMs(nextRetryCount);
    recordQueueItemFailure(
      ownerId,
      queueItem.id,
      err?.message || 'Network request failed',
      backoffMs,
      'NETWORK_ERROR'
    );
    return {
      status: 'NETWORK_ERROR',
      error: err,
      queueItemId: queueItem.id
    };
  }
}

/**
 * Phase 6.1B: Durable DELETE_CYCLE Write-Ahead Mutation Executor
 */
export async function executeDirectDeleteCycleMutation(
  params: ExecuteDirectDeleteCycleMutationParams
): Promise<DirectCycleMutationResult> {
  const { cycleId, existingCycle, authToken, fetchFn, activeAccountRef } = params;
  const ownerId = normalizeQueueOwner(params.ownerId);

  const guard = shouldQueueOfflineMutation({ ownerId, authToken });
  if (!guard.canSendToServer && !guard.shouldQueue) {
    return { status: 'IGNORED_NO_AUTH_NO_QUEUE' };
  }

  const { payload: deletePayload, expectedRevision, isValid } = prepareDirectDeleteCyclePayload(
    cycleId,
    existingCycle
  );

  if (existingCycle && !isValid) {
    recordClientConflict(ownerId, {
      mutationType: 'DELETE_CYCLE',
      entityType: 'CYCLE',
      entityId: cycleId,
      conflictType: 'PRECONDITION_REQUIRED',
      statusCode: 428,
      expectedRevision: undefined,
      currentRevision: undefined,
      messageFa: 'نسخه تأیید شده این چرخه برای حذف معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: deletePayload
    });
    return {
      status: 'INVALID_PRECONDITION',
      messageFa: 'نسخه تأیید شده این چرخه برای حذف معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: deletePayload
    };
  }

  // 1. Durable Write-Ahead Enqueue
  const durableResult = enqueueDurableCycleWriteAhead(ownerId, {
    type: 'DELETE_CYCLE',
    payload: deletePayload,
    expectedRevision
  });

  if (durableResult.success === false) {
    return {
      status: 'STORAGE_WRITE_FAILED',
      reason: durableResult.reason,
      errorMsg: durableResult.errorMsg,
      messageFa: 'خطا در ذخیره‌سازی محلی. تغییرات در صف آفلاین ثبت نشد و به سرور ارسال نمی‌شود.',
      queueItemId: durableResult.candidateItem?.id
    };
  }

  const queueItem = durableResult.queueItem;

  // If the cycle was only created offline and deleted offline, queue was pruned and no network call is needed
  const currentQueue = getOfflineQueue(ownerId);
  const isPrunedOffline = !currentQueue.some(item => item.id === queueItem.id);
  if (isPrunedOffline) {
    return {
      status: 'SUCCESS',
      cycleId,
      queueItemId: queueItem.id
    };
  }

  // 2. Offline Guard
  if (guard.shouldQueue) {
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  // If a CREATE_CYCLE for this cycle is currently in-flight, the DELETE_CYCLE must wait in the queue for the Create outcome
  const isCreateInFlight = currentQueue.some(
    item => item.type === 'CREATE_CYCLE' &&
      item.payload?.id === cycleId &&
      (isQueueItemInFlight(ownerId, item.id) || item.inFlight)
  );
  if (isCreateInFlight) {
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  // 3. Mark in-flight
  markQueueItemInFlight(ownerId, queueItem.id, true);

  const activeFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!activeFetch) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    return { status: 'QUEUED_OFFLINE', queueItem };
  }

  try {
    const url = `/api/cycles/${cycleId}${expectedRevision ? `?expectedRevision=${expectedRevision}` : ''}`;
    const res = await activeFetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    // Post-fetch Account Switch Verification
    if (activeAccountRef && !verifyActiveAccount(activeAccountRef.current, ownerId)) {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      return { status: 'ACCOUNT_SWITCHED', queueItemId: queueItem.id };
    }

    // Treat 2xx and 404 (already deleted / not found on server) as SUCCESS
    if (res.ok || res.status === 404) {
      removeReplayedQueueItems(ownerId, [queueItem.id]);
      return {
        status: 'SUCCESS',
        cycleId,
        is404Deleted: res.status === 404,
        queueItemId: queueItem.id
      };
    } else {
      markQueueItemInFlight(ownerId, queueItem.id, false);
      const classification = classifyReplayResponse(res.status, 'DELETE_CYCLE');

      if (classification === 'AUTH_REQUIRED') {
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 401 Unauthorized', 0, 'AUTH_REQUIRED');
        return {
          status: 'AUTH_REQUIRED',
          statusCode: 401,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'FORBIDDEN') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'FORBIDDEN' }],
          'HTTP 403 Forbidden - permission denied',
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'FORBIDDEN',
          statusCode: 403,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'VALIDATION_ERROR') {
        quarantineQueueItems(
          [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
          `HTTP ${res.status} Validation Error`,
          ownerId
        );
        removeReplayedQueueItems(ownerId, [queueItem.id]);
        return {
          status: 'VALIDATION_ERROR',
          statusCode: res.status,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'CONFLICT_DEFERRED' || classification === 'PRECONDITION_REQUIRED') {
        removeReplayedQueueItems(ownerId, [queueItem.id]);

        const conflictJson = await res.json().catch(() => null);
        const parsedConflict = parseSafeConflictDetails(res.status, conflictJson, 'CYCLE', cycleId);
        recordClientConflict(ownerId, {
          mutationType: 'DELETE_CYCLE',
          entityType: parsedConflict.entityType,
          entityId: parsedConflict.entityId,
          conflictType: parsedConflict.conflictType,
          statusCode: parsedConflict.statusCode,
          expectedRevision: parsedConflict.expectedRevision ?? expectedRevision,
          currentRevision: parsedConflict.currentRevision,
          messageFa: parsedConflict.messageFa,
          clientPayload: deletePayload,
          operationId: queueItem.id
        });

        return {
          status: 'CONFLICT',
          statusCode: res.status as 409 | 428,
          conflictDetails: parsedConflict,
          queueItemId: queueItem.id
        };
      }

      if (classification === 'RATE_LIMITED') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(ownerId, queueItem.id, 'HTTP 429 Rate Limited', backoffMs, 'RATE_LIMITED');
        return {
          status: 'RATE_LIMITED',
          statusCode: 429,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      if (classification === 'SERVER_RETRYABLE') {
        const nextRetryCount = (queueItem.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        const nextRetryAt = Date.now() + backoffMs;
        recordQueueItemFailure(
          ownerId,
          queueItem.id,
          `Server returned HTTP ${res.status} (SERVER_RETRYABLE)`,
          backoffMs,
          'SERVER_RETRYABLE'
        );
        return {
          status: 'SERVER_RETRYABLE',
          statusCode: res.status,
          queueItemId: queueItem.id,
          retryCount: nextRetryCount,
          nextRetryAt
        };
      }

      quarantineQueueItems(
        [{ ...queueItem, inFlight: false, classification: 'VALIDATION_ERROR' }],
        `Server returned unhandled HTTP ${res.status}`,
        ownerId
      );
      removeReplayedQueueItems(ownerId, [queueItem.id]);
      return {
        status: 'VALIDATION_ERROR',
        statusCode: res.status,
        queueItemId: queueItem.id
      };
    }
  } catch (err: any) {
    markQueueItemInFlight(ownerId, queueItem.id, false);
    const nextRetryCount = (queueItem.retryCount || 0) + 1;
    const backoffMs = calculateReplayBackoffMs(nextRetryCount);
    recordQueueItemFailure(
      ownerId,
      queueItem.id,
      err?.message || 'Network request failed',
      backoffMs,
      'NETWORK_ERROR'
    );
    return {
      status: 'NETWORK_ERROR',
      error: err,
      queueItemId: queueItem.id
    };
  }
}

export type ExecuteDirectCycleMutationParams =
  | ({ type: 'CREATE_CYCLE' } & ExecuteDirectCreateCycleMutationParams)
  | ({ type: 'UPDATE_CYCLE' } & ExecuteDirectUpdateCycleMutationParams)
  | ({ type: 'DELETE_CYCLE' } & ExecuteDirectDeleteCycleMutationParams);

export async function executeDirectCycleMutation(
  params: ExecuteDirectCycleMutationParams
): Promise<DirectCycleMutationResult> {
  if (params.type === 'CREATE_CYCLE') {
    return executeDirectCreateCycleMutation(params);
  } else if (params.type === 'UPDATE_CYCLE') {
    return executeDirectUpdateCycleMutation(params);
  } else if (params.type === 'DELETE_CYCLE') {
    return executeDirectDeleteCycleMutation(params);
  }
  return { status: 'IGNORED_NO_AUTH_NO_QUEUE' };
}


