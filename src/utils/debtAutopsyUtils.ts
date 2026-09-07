import { Cycle, DailyLog } from '../types.js';
import { addDaysToDate } from './dateUtils.js';
import { computeDailyProperties } from '../engine/bushidoCalculations.js';

export interface DebtCandidateDateRange {
  startDate: string;
  endDateExclusive: string;
}

/**
 * Computes the candidate date range for unresolved debts in a cycle.
 *
 * Range:
 * - start: currentCycle.startDate
 * - end-exclusive: the earlier of logicalToday and the day after currentCycle.endDate
 *
 * Guaranteed boundaries:
 * - never includes today
 * - never includes dates after Cycle endDate
 * - handles missing or invalid endDate using the product fallback (startDate + 89 days)
 */
export function getCycleDebtCandidateDateRange(
  cycle: Cycle | null | undefined,
  logicalToday: string
): DebtCandidateDateRange | null {
  if (!cycle || !cycle.startDate) {
    return null;
  }

  const startDate = cycle.startDate;
  // Product fallback contract: 90 days (startDate + 89) if endDate is missing or invalid
  const cycleEndDate = cycle.endDate && cycle.endDate >= startDate 
    ? cycle.endDate 
    : addDaysToDate(startDate, 89);

  const dayAfterEnd = addDaysToDate(cycleEndDate, 1);
  const endDateExclusive = logicalToday < dayAfterEnd ? logicalToday : dayAfterEnd;

  if (startDate >= endDateExclusive) {
    return null;
  }

  return { startDate, endDateExclusive };
}

/**
 * Creates a pure presentation-only virtual placeholder for an unresolved debt day.
 * Must NOT synthesize historical createdAt metadata.
 */
export function createVirtualDebtPlaceholder(cycleId: string, date: string): DailyLog {
  return {
    id: `virtual-${date}`,
    cycleId,
    date,
    wakeUp: false,
    workout: false,
    study: false,
    journal: false,
    hardTask: false,
    specialMission: false,
    isVirtual: true
  };
}

/**
 * Predicate to identify presentation-only virtual unresolved debt placeholders.
 */
export function isVirtualDebtPlaceholder(
  log: { id?: string; isVirtual?: boolean } | null | undefined
): boolean {
  if (!log) return false;
  return Boolean(log.isVirtual || (typeof log.id === 'string' && log.id.startsWith('virtual-')));
}

/**
 * Converts a virtual placeholder or updated log into an established DailyLog create/upsert input.
 *
 * Guarantees:
 * 1. A `virtual-*` ID is replaced with the standard `log-${date}` identity.
 * 2. Presentation-only markers (`isVirtual`) are stripped.
 * 3. Synthetic historical createdAt is NEVER invented for virtual placeholders.
 * 4. Existing real DailyLog IDs and timestamps are preserved unchanged.
 * 5. Selected date and active Cycle ID are preserved.
 */
export function convertVirtualDebtLogForMutation(
  incomingLog: DailyLog,
  activeCycleId: string,
  existingLogs: DailyLog[] = []
): DailyLog {
  const existingLog = existingLogs.find(l => l.date === incomingLog.date);
  if (existingLog && !isVirtualDebtPlaceholder(existingLog)) {
    // Preserve existing real DailyLog identity and metadata
    const preserved: DailyLog = {
      ...incomingLog,
      id: existingLog.id,
      cycleId: existingLog.cycleId || incomingLog.cycleId || activeCycleId,
      createdAt: existingLog.createdAt
    };
    delete (preserved as any).isVirtual;
    return preserved;
  }

  const isVirtual = isVirtualDebtPlaceholder(incomingLog);
  const cycleId = incomingLog.cycleId || activeCycleId;
  const date = incomingLog.date;

  const converted: DailyLog = {
    id: isVirtual || (incomingLog.id && incomingLog.id.startsWith('virtual-'))
      ? `log-${date}`
      : (incomingLog.id || `log-${date}`),
    cycleId,
    date,
    wakeUp: Boolean(incomingLog.wakeUp),
    workout: Boolean(incomingLog.workout),
    study: Boolean(incomingLog.study),
    journal: Boolean(incomingLog.journal),
    hardTask: Boolean(incomingLog.hardTask),
    specialMission: Boolean(incomingLog.specialMission),
    ...(incomingLog.failureReason !== undefined ? { failureReason: incomingLog.failureReason } : {}),
    ...(incomingLog.failureTime !== undefined ? { failureTime: incomingLog.failureTime } : {}),
    ...(incomingLog.autopsyNotes !== undefined ? { autopsyNotes: incomingLog.autopsyNotes } : {}),
    ...(incomingLog.countermeasure !== undefined ? { countermeasure: incomingLog.countermeasure } : {}),
    ...(incomingLog.aiFeedback !== undefined ? { aiFeedback: incomingLog.aiFeedback } : {}),
    ...(incomingLog.notes !== undefined ? { notes: incomingLog.notes } : {})
  };

  // Strip presentation-only marker
  delete (converted as any).isVirtual;

  // Never synthesize historical createdAt for virtual placeholders
  if (!isVirtual && incomingLog.createdAt) {
    converted.createdAt = incomingLog.createdAt;
  } else {
    delete (converted as any).createdAt;
  }

  return converted;
}

/**
 * Helper to validate positive integer revisions.
 * Returns the revision number if valid (> 0 integer), otherwise null.
 */
function getValidRevision(rev: unknown): number | null {
  return typeof rev === 'number' && Number.isInteger(rev) && rev > 0 ? rev : null;
}

/**
 * Derives the authoritative list of unresolved debt logs for the active cycle.
 * Used identically for:
 * - Navbar debt badge count
 * - Actionability of debt control
 * - First opened date on debt click
 * - Autopsy carousel in AutopsyModal
 *
 * Performance:
 * Single-pass date-indexed Map<string, DailyLog> construction in O(logs) time.
 * Resolves each candidate date in O(1) Map lookup, achieving O(candidate days + cycle logs) overall.
 * Deterministically deduplicates in-memory same-date logs:
 * - prefers the candidate with a valid higher revision when revisions differ,
 * - otherwise preserves the first stable occurrence.
 * No fields are merged from duplicate logs.
 */
export function deriveUnresolvedDebtLogs(
  currentCycle: Cycle | null | undefined,
  logs: DailyLog[],
  logicalToday: string
): DailyLog[] {
  if (!currentCycle || !currentCycle.startDate) return [];

  const candidateRange = getCycleDebtCandidateDateRange(currentCycle, logicalToday);
  if (!candidateRange) return [];

  const { startDate, endDateExclusive } = candidateRange;
  const list: DailyLog[] = [];

  // Strictly filter logs belonging to the active cycle
  const cycleEndDateFallback = currentCycle.endDate && currentCycle.endDate >= currentCycle.startDate
    ? currentCycle.endDate
    : addDaysToDate(currentCycle.startDate, 89);

  // Build a date-indexed Map once for active cycle logs: O(logs)
  const cycleLogsByDate = new Map<string, DailyLog>();

  for (const log of logs) {
    const isCycleMatch = log.cycleId === currentCycle.id ||
      (!log.cycleId && log.date >= currentCycle.startDate && log.date <= cycleEndDateFallback);

    if (!isCycleMatch) continue;

    const existing = cycleLogsByDate.get(log.date);
    if (!existing) {
      cycleLogsByDate.set(log.date, log);
    } else {
      // Deterministic duplicate selection policy:
      // Prefer the valid higher revision when revisions differ,
      // otherwise preserve the first stable occurrence.
      const existingRev = getValidRevision(existing.revision);
      const candidateRev = getValidRevision(log.revision);

      let shouldReplace = false;
      if (candidateRev !== null && existingRev !== null) {
        shouldReplace = candidateRev > existingRev;
      } else if (candidateRev !== null && existingRev === null) {
        shouldReplace = true;
      }

      if (shouldReplace) {
        cycleLogsByDate.set(log.date, log);
      }
    }
  }

  const cycleLogs = Array.from(cycleLogsByDate.values());

  // Iterate each candidate date with O(1) Map resolution: O(candidate days)
  let checkDate = startDate;
  while (checkDate < endDateExclusive) {
    let l = cycleLogsByDate.get(checkDate);
    if (!l) {
      l = createVirtualDebtPlaceholder(currentCycle.id, checkDate);
    }
    const c = computeDailyProperties(l, cycleLogs, logicalToday, startDate);
    if (c.statusType === 'burned_unresolved') {
      list.push(l);
    }
    checkDate = addDaysToDate(checkDate, 1);
  }

  return list.sort((a, b) => a.date.localeCompare(b.date));
}
