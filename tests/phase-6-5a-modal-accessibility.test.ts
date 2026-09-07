import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { validateCycleDates, findOverlappingCycle } from '../src/utils/cycleValidation.ts';
import {
  shouldBlockEscape,
  handleEscapeKey,
  isElementVisible,
  getFocusableElements,
  trapTabKey
} from '../src/utils/useModalAccessibility.ts';
import {
  getNextTab,
  handleTabListKeyDown,
  AUTH_TABS,
  AuthTab
} from '../src/utils/authTabNavigation.ts';
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

  describe('Modal Accessibility Helpers - Pure Behavioral Tests', () => {
    describe('shouldBlockEscape', () => {
      it('blocks Escape when isBusy is true', () => {
        assert.strictEqual(shouldBlockEscape(true), true);
      });

      it('allows Escape when isBusy is false or undefined', () => {
        assert.strictEqual(shouldBlockEscape(false), false);
        assert.strictEqual(shouldBlockEscape(undefined), false);
      });
    });

    describe('handleEscapeKey', () => {
      it('returns false and does not trigger onClose for non-Escape keys', () => {
        let closed = false;
        let prevented = false;
        const e = {
          key: 'Tab',
          preventDefault: () => { prevented = true; }
        };

        const handled = handleEscapeKey(e, () => { closed = true; }, false);
        assert.strictEqual(handled, false);
        assert.strictEqual(closed, false);
        assert.strictEqual(prevented, false);
      });

      it('returns false and does not trigger onClose when busy', () => {
        let closed = false;
        let prevented = false;
        const e = {
          key: 'Escape',
          preventDefault: () => { prevented = true; }
        };

        const handled = handleEscapeKey(e, () => { closed = true; }, true);
        assert.strictEqual(handled, false);
        assert.strictEqual(closed, false);
        assert.strictEqual(prevented, false);
      });

      it('calls onClose and preventDefault when Escape is pressed and not busy', () => {
        let closed = false;
        let prevented = false;
        let stopped = false;
        const e = {
          key: 'Escape',
          preventDefault: () => { prevented = true; },
          stopPropagation: () => { stopped = true; }
        };

        const handled = handleEscapeKey(e, () => { closed = true; }, false);
        assert.strictEqual(handled, true);
        assert.strictEqual(closed, true);
        assert.strictEqual(prevented, true);
        assert.strictEqual(stopped, true);
      });
    });

    describe('isElementVisible', () => {
      const createMockEl = (attrs: Record<string, string> = {}, style: Record<string, string> = {}) => ({
        getAttribute: (name: string) => attrs[name] ?? null,
        hasAttribute: (name: string) => name in attrs,
        style
      } as unknown as HTMLElement);

      it('considers normal element visible', () => {
        const el = createMockEl();
        assert.strictEqual(isElementVisible(el), true);
      });

      it('returns false when disabled attribute is present', () => {
        const el = createMockEl({ disabled: '' });
        assert.strictEqual(isElementVisible(el), false);
      });

      it('returns false when aria-hidden is true', () => {
        const el = createMockEl({ 'aria-hidden': 'true' });
        assert.strictEqual(isElementVisible(el), false);
      });

      it('returns false when tabindex is -1', () => {
        const el = createMockEl({ tabindex: '-1' });
        assert.strictEqual(isElementVisible(el), false);
      });

      it('returns false when display is none', () => {
        const el = createMockEl({}, { display: 'none' });
        assert.strictEqual(isElementVisible(el), false);
      });

      it('returns false when visibility is hidden', () => {
        const el = createMockEl({}, { visibility: 'hidden' });
        assert.strictEqual(isElementVisible(el), false);
      });
    });

    describe('trapTabKey focus loop behavior', () => {
      class MockDOMNode {
        tagName: string;
        attrs: Record<string, string>;
        style: Record<string, string>;
        children: MockDOMNode[] = [];
        focused = false;

        constructor(tagName: string, attrs: Record<string, string> = {}, style: Record<string, string> = {}) {
          this.tagName = tagName.toUpperCase();
          this.attrs = { ...attrs };
          this.style = { ...style };
        }

        getAttribute(name: string) {
          return this.attrs[name] ?? null;
        }

        hasAttribute(name: string) {
          return name in this.attrs;
        }

        focus() {
          this.focused = true;
        }

        contains(target: any): boolean {
          if (!target) return false;
          if (target === this) return true;
          return this.children.some(c => c.contains(target));
        }

        querySelectorAll(selector: string): any[] {
          const res: MockDOMNode[] = [];
          const traverse = (node: MockDOMNode) => {
            const tag = node.tagName.toLowerCase();
            if (['button', 'input', 'select', 'textarea', 'a'].includes(tag)) {
              res.push(node);
            }
            for (const child of node.children) {
              traverse(child);
            }
          };
          for (const child of this.children) {
            traverse(child);
          }
          return res;
        }
      }

      it('ignores non-Tab key events', () => {
        let prevented = false;
        const e = { key: 'ArrowDown', shiftKey: false, preventDefault: () => { prevented = true; } };
        const handled = trapTabKey(e, null);
        assert.strictEqual(handled, false);
        assert.strictEqual(prevented, false);
      });

      it('traps tab key when container has no focusable elements', () => {
        let prevented = false;
        const container = new MockDOMNode('div');
        const e = { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } };

        const handled = trapTabKey(e, container as unknown as HTMLElement);
        assert.strictEqual(handled, true);
        assert.strictEqual(prevented, true);
      });

      it('wraps to first element when tabbing forward from last element', () => {
        const container = new MockDOMNode('div');
        const btn1 = new MockDOMNode('button');
        const btn2 = new MockDOMNode('button');
        container.children = [btn1, btn2];

        let prevented = false;
        const e = { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } };

        // Active element is btn2 (the last element)
        const handled = trapTabKey(e, container as unknown as HTMLElement, btn2 as unknown as HTMLElement);
        assert.strictEqual(handled, true);
        assert.strictEqual(prevented, true);
        assert.strictEqual(btn1.focused, true);
        assert.strictEqual(btn2.focused, false);
      });

      it('wraps to last element when shift-tabbing backward from first element', () => {
        const container = new MockDOMNode('div');
        const btn1 = new MockDOMNode('button');
        const btn2 = new MockDOMNode('button');
        container.children = [btn1, btn2];

        let prevented = false;
        const e = { key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } };

        // Active element is btn1 (the first element)
        const handled = trapTabKey(e, container as unknown as HTMLElement, btn1 as unknown as HTMLElement);
        assert.strictEqual(handled, true);
        assert.strictEqual(prevented, true);
        assert.strictEqual(btn2.focused, true);
        assert.strictEqual(btn1.focused, false);
      });

      it('allows natural tab flow when not at boundary', () => {
        const container = new MockDOMNode('div');
        const btn1 = new MockDOMNode('button');
        const btn2 = new MockDOMNode('button');
        const btn3 = new MockDOMNode('button');
        container.children = [btn1, btn2, btn3];

        let prevented = false;
        const e = { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } };

        // Active element is btn1 (first of 3): natural tab to btn2 should not be prevented
        const handled = trapTabKey(e, container as unknown as HTMLElement, btn1 as unknown as HTMLElement);
        assert.strictEqual(handled, false);
        assert.strictEqual(prevented, false);
      });
    });
  });

  describe('Auth Tab Navigation - Pure RTL Behavior', () => {
    it('defines the three canonical auth tabs in order', () => {
      assert.deepStrictEqual(AUTH_TABS, ['login', 'register', 'forgot']);
    });

    it('navigates next, prev, first, and last with wrap-around support', () => {
      assert.strictEqual(getNextTab('login', 'next'), 'register');
      assert.strictEqual(getNextTab('register', 'next'), 'forgot');
      assert.strictEqual(getNextTab('forgot', 'next'), 'login'); // wraps cyclically

      assert.strictEqual(getNextTab('forgot', 'prev'), 'register');
      assert.strictEqual(getNextTab('register', 'prev'), 'login');
      assert.strictEqual(getNextTab('login', 'prev'), 'forgot'); // wraps cyclically

      assert.strictEqual(getNextTab('register', 'first'), 'login');
      assert.strictEqual(getNextTab('register', 'last'), 'forgot');
    });

    it('handles RTL keyboard arrows correctly (ArrowLeft moves next, ArrowRight moves prev)', () => {
      // In RTL reading direction, ArrowLeft is moving forward (next)
      const nextTab = handleTabListKeyDown('ArrowLeft', 'login', true);
      assert.strictEqual(nextTab, 'register');

      // In RTL, ArrowRight moves backwards (prev)
      const prevTab = handleTabListKeyDown('ArrowRight', 'register', true);
      assert.strictEqual(prevTab, 'login');
    });

    it('handles Home and End keys for rapid navigation', () => {
      const firstTab = handleTabListKeyDown('Home', 'forgot', true);
      assert.strictEqual(firstTab, 'login');

      const lastTab = handleTabListKeyDown('End', 'login', true);
      assert.strictEqual(lastTab, 'forgot');
    });

    it('ignores unrelated keys like Tab, Space, or Enter in tablist navigation', () => {
      assert.strictEqual(handleTabListKeyDown('Tab', 'login', true), null);
      assert.strictEqual(handleTabListKeyDown('Enter', 'login', true), null);
      assert.strictEqual(handleTabListKeyDown(' ', 'login', true), null);
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
      assert.ok(content.includes('htmlFor="create-cycle-end-date-output"'), 'CreateCycleModal must associate label with end date output');
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

    it('verifies AuthModal has dialog semantics, tabs semantics, roving tabIndex, keydown handling, field-specific aria-invalid, and password toggle', () => {
      const filePath = path.resolve('src/components/AuthModal.tsx');
      const content = fs.readFileSync(filePath, 'utf-8');

      assert.ok(content.includes('role="dialog"'), 'AuthModal must have role="dialog"');
      assert.ok(content.includes('aria-modal="true"'), 'AuthModal must have aria-modal="true"');
      assert.ok(content.includes('aria-labelledby="auth-title"'), 'AuthModal must have aria-labelledby');
      assert.ok(content.includes('useModalAccessibility'), 'AuthModal must use useModalAccessibility hook');
      assert.ok(content.includes('role="tablist"'), 'AuthModal navigation must have role="tablist"');
      assert.ok(content.includes('role="tab"'), 'AuthModal tabs must have role="tab"');
      assert.ok(content.includes('role="tabpanel"'), 'AuthModal content panels must have role="tabpanel"');
      assert.ok(content.includes('onKeyDown={handleTabKeyDown}'), 'AuthModal tabs must have keyboard navigation handler');
      assert.ok(content.includes("tabIndex={activeTab === 'login' ? 0 : -1}"), 'AuthModal login tab must have roving tabIndex');
      assert.ok(content.includes("aria-invalid={errorField === 'phone'}"), 'AuthModal phone input must have field-specific aria-invalid');
      assert.ok(content.includes("aria-invalid={errorField === 'password'}"), 'AuthModal password input must have field-specific aria-invalid');
      assert.ok(content.includes("aria-invalid={errorField === 'otp'}"), 'AuthModal otp input must have field-specific aria-invalid');
      assert.ok(content.includes('aria-pressed={showPassword}'), 'AuthModal password visibility toggle must have aria-pressed');
      assert.ok(content.includes('role="alert"'), 'AuthModal must announce errors with role="alert"');
    });
  });
});

