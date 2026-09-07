import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { validateCycleDates, findOverlappingCycle } from '../src/utils/cycleValidation.ts';
import { Cycle } from '../src/types.ts';

describe('Phase 6.5A: Modal Accessibility & Cycle Overlap Invariant Verification', () => {
  describe('Cycle Overlap Non-Negotiable Contract', () => {
    const existingCycles: Cycle[] = [
      {
        id: 'cycle-custom-1',
        title: 'نبرد اول',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        habits: [],
        createdAt: '2026-09-01T00:00:00Z',
        isDemo: false
      },
      {
        id: 'cycle-1', // Default demo cycle id in Bushido
        title: 'سیکل دمو (نمونه)',
        startDate: '2026-08-01',
        endDate: '2026-08-15',
        habits: [],
        createdAt: '2026-08-01T00:00:00Z',
        isDemo: true
      }
    ];

    it('rejects proposed cycle where proposedStart <= existingEnd and proposedEnd >= existingStart', () => {
      // Direct overlap inside
      const insideOverlap = findOverlappingCycle('2026-09-12', '2026-09-18', existingCycles);
      assert.ok(insideOverlap);
      assert.strictEqual(insideOverlap?.id, 'cycle-custom-1');

      // Envelope overlap
      const envelopeOverlap = findOverlappingCycle('2026-09-05', '2026-09-25', existingCycles);
      assert.ok(envelopeOverlap);
      assert.strictEqual(envelopeOverlap?.id, 'cycle-custom-1');
    });

    it('rejects boundary overlap where proposedEnd === existingStart', () => {
      const boundaryStart = findOverlappingCycle('2026-09-01', '2026-09-10', existingCycles);
      assert.ok(boundaryStart);
      assert.strictEqual(boundaryStart?.id, 'cycle-custom-1');
    });

    it('rejects boundary overlap where proposedStart === existingEnd', () => {
      const boundaryEnd = findOverlappingCycle('2026-09-20', '2026-09-30', existingCycles);
      assert.ok(boundaryEnd);
      assert.strictEqual(boundaryEnd?.id, 'cycle-custom-1');
    });

    it('allows non-overlapping cycle strictly before existing cycle', () => {
      const beforeCycle = findOverlappingCycle('2026-09-01', '2026-09-09', existingCycles);
      assert.strictEqual(beforeCycle, undefined);
    });

    it('allows non-overlapping cycle strictly after existing cycle', () => {
      const afterCycle = findOverlappingCycle('2026-09-21', '2026-09-30', existingCycles);
      assert.strictEqual(afterCycle, undefined);
    });

    it('ignores demo cycles in overlap check', () => {
      // Overlaps with demo cycle (2026-08-01 to 2026-08-15)
      const demoOverlap = findOverlappingCycle('2026-08-05', '2026-08-12', existingCycles);
      assert.strictEqual(demoOverlap, undefined);
    });

    it('validates cycle date range integrity via validateCycleDates', () => {
      // Inverted dates
      const inverted = validateCycleDates('2026-09-25', '2026-09-20', existingCycles);
      assert.strictEqual(inverted.isValid, false);
      assert.strictEqual(inverted.field, 'endDate');

      // Empty dates
      const empty = validateCycleDates('', '', existingCycles);
      assert.strictEqual(empty.isValid, false);

      // Overlapping dates
      const overlap = validateCycleDates('2026-09-15', '2026-09-25', existingCycles);
      assert.strictEqual(overlap.isValid, false);
      assert.strictEqual(overlap.field, 'startDate');

      // Valid range
      const valid = validateCycleDates('2026-10-01', '2026-10-20', existingCycles);
      assert.strictEqual(valid.isValid, true);
      assert.strictEqual(valid.error, undefined);
    });
  });

  describe('Modal Accessibility Implementation Audit in Codebase', () => {
    it('verifies CreateCycleModal has dialog semantics, aria-modal, aria-describedby, and focus management', () => {
      const filePath = path.resolve('src/components/CreateCycleModal.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');

      assert.ok(content.includes('role="dialog"'), 'CreateCycleModal must have role="dialog"');
      assert.ok(content.includes('aria-modal="true"'), 'CreateCycleModal must have aria-modal="true"');
      assert.ok(content.includes('aria-labelledby="create-cycle-title"'), 'CreateCycleModal must have aria-labelledby');
      assert.ok(content.includes('useModalAccessibility'), 'CreateCycleModal must use useModalAccessibility hook');
      assert.ok(content.includes('role="alert"'), 'CreateCycleModal must announce error with role="alert"');
      assert.ok(content.includes('htmlFor="create-cycle-start-date-input"'), 'CreateCycleModal must associate label with start date');
      assert.ok(content.includes('htmlFor="create-cycle-end-date-display"'), 'CreateCycleModal must associate label with end date');
    });

    it('verifies AutopsyModal has dialog semantics, live region, busy state, and focus management', () => {
      const filePath = path.resolve('src/components/AutopsyModal.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');

      assert.ok(content.includes('role="dialog"'), 'AutopsyModal must have role="dialog"');
      assert.ok(content.includes('aria-modal="true"'), 'AutopsyModal must have aria-modal="true"');
      assert.ok(content.includes('aria-labelledby="autopsy-title"'), 'AutopsyModal must have aria-labelledby');
      assert.ok(content.includes('useModalAccessibility'), 'AutopsyModal must use useModalAccessibility hook');
      assert.ok(content.includes('role="status"'), 'AutopsyModal must have role="status" or role="alert" for live announcements');
      assert.ok(content.includes('aria-live='), 'AutopsyModal must have aria-live regions');
      assert.ok(content.includes('aria-busy='), 'AutopsyModal must mark aria-busy when AI analysis is loading');
    });

    it('verifies AuthModal has dialog semantics, tabs semantics, password visibility accessibility, and live alerts', () => {
      const filePath = path.resolve('src/components/AuthModal.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');

      assert.ok(content.includes('role="dialog"'), 'AuthModal must have role="dialog"');
      assert.ok(content.includes('aria-modal="true"'), 'AuthModal must have aria-modal="true"');
      assert.ok(content.includes('aria-labelledby="auth-title"'), 'AuthModal must have aria-labelledby');
      assert.ok(content.includes('useModalAccessibility'), 'AuthModal must use useModalAccessibility hook');
      assert.ok(content.includes('role="tablist"'), 'AuthModal navigation must have role="tablist"');
      assert.ok(content.includes('role="tab"'), 'AuthModal tabs must have role="tab"');
      assert.ok(content.includes('role="tabpanel"'), 'AuthModal content panels must have role="tabpanel"');
      assert.ok(content.includes('aria-pressed={showPassword}'), 'AuthModal password visibility toggle must have aria-pressed');
      assert.ok(content.includes('role="alert"'), 'AuthModal must announce errors with role="alert"');
    });
  });
});
