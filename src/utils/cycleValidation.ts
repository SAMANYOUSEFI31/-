import { Cycle } from '../types';
import { addDaysToDate } from './dateUtils';

/**
 * Validates whether a proposed cycle date range overlaps with any existing non-demo cycle.
 * Non-negotiable inclusive overlap contract:
 * proposedStart <= existingEnd && proposedEnd >= existingStart
 *
 * Demo-cycle exclusion contract:
 * Cycle with id === 'cycle-1' or title containing '(نمونه)' are excluded.
 */
export function findOverlappingCycle(
  proposedStart: string,
  proposedEnd: string,
  existingCycles: Cycle[]
): Cycle | undefined {
  const nonDemoCycles = existingCycles.filter(
    c => c.id !== 'cycle-1' && !c.title.includes('(نمونه)')
  );

  return nonDemoCycles.find(c => {
    const cStart = c.startDate;
    const cEnd = c.endDate || addDaysToDate(c.startDate, 89);
    return proposedStart <= cEnd && proposedEnd >= cStart;
  });
}

export interface CycleValidationResult {
  isValid: boolean;
  error?: string;
  field?: 'startDate' | 'endDate';
  overlappingCycle?: Cycle;
}

export function validateCycleDates(
  proposedStart: string,
  proposedEnd: string,
  existingCycles: Cycle[]
): CycleValidationResult {
  if (!proposedStart || !proposedEnd) {
    return {
      isValid: false,
      error: 'لطفاً تاریخ شروع و پایان نبرد را مشخص کنید.',
      field: !proposedStart ? 'startDate' : 'endDate'
    };
  }

  if (proposedEnd < proposedStart) {
    return {
      isValid: false,
      error: 'تاریخ پایان نبرد نمی‌تواند قبل از تاریخ شروع باشد.',
      field: 'endDate'
    };
  }

  const overlappingCycle = findOverlappingCycle(proposedStart, proposedEnd, existingCycles);
  if (overlappingCycle) {
    return {
      isValid: false,
      error: `تداخل زمانی با نبرد "${overlappingCycle.title}". امکان ایجاد همزمان دو نبرد فعال وجود ندارد.`,
      field: 'startDate',
      overlappingCycle
    };
  }

  return { isValid: true };
}

