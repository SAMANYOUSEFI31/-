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

import { Cycle, DailyLog } from '../types';
import { normalizeQueueOwner } from './offlineQueueUtils';

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
  activeCycleId?: string
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
      cycleId
    };
    delete payload.expectedRevision;
    return { payload, isExisting: false, isValid: true };
  }

  const rev = existingLog?.revision ?? updatedLog.revision;
  const isValidRev = typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

  if (!isValidRev) {
    return {
      payload: { ...updatedLog, cycleId },
      isExisting: true,
      isValid: false
    };
  }

  const payload: Record<string, any> = {
    ...updatedLog,
    cycleId,
    expectedRevision: rev
  };

  return {
    payload,
    expectedRevision: rev,
    isExisting: true,
    isValid: true
  };
}

/**
 * Prepares direct Cycle update payload with explicit expectedRevision.
 */
export function prepareDirectCyclePayload(
  updatedCycle: Cycle,
  existingCycle: Cycle | null | undefined
): {
  payload: Record<string, any>;
  expectedRevision?: number;
  isValid: boolean;
} {
  const rev = existingCycle?.revision ?? updatedCycle.revision;
  const isValidRev = typeof rev === 'number' && Number.isInteger(rev) && rev > 0;

  if (!isValidRev) {
    return {
      payload: { ...updatedCycle },
      isValid: false
    };
  }

  return {
    payload: {
      ...updatedCycle,
      expectedRevision: rev
    },
    expectedRevision: rev,
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
