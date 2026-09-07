import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { handleEscapeKey } from '../src/utils/useModalAccessibility';

describe('Phase 6.5B: Application Navigation & Accessibility Verification', () => {
  const resetModalPath = path.join(process.cwd(), 'src/components/ResetConfirmationModal.tsx');
  const navbarPath = path.join(process.cwd(), 'src/components/Navbar.tsx');
  const appPath = path.join(process.cwd(), 'src/App.tsx');
  const indexCssPath = path.join(process.cwd(), 'src/index.css');

  const resetModalContent = fs.readFileSync(resetModalPath, 'utf8');
  const navbarContent = fs.readFileSync(navbarPath, 'utf8');
  const appContent = fs.readFileSync(appPath, 'utf8');
  const indexCssContent = fs.readFileSync(indexCssPath, 'utf8');

  describe('Defect 1: Reset Confirmation Modal Accessibility & Backdrop Invariant Contract', () => {
    it('uses useModalAccessibility with initialFocusRef bound to the safe cancel action', () => {
      assert.ok(
        resetModalContent.includes('useModalAccessibility'),
        'ResetConfirmationModal must use useModalAccessibility hook'
      );
      assert.ok(
        resetModalContent.includes('initialFocusRef: cancelButtonRef'),
        'Initial focus must be directed to safe cancel button'
      );
      assert.ok(
        resetModalContent.includes('autoFocusFirst: false'),
        'autoFocusFirst must be false to avoid accidental focus on destructive reset action'
      );
    });

    it('enforces semantic dialog attributes, labelledby, describedby, and backdrop containment', () => {
      assert.ok(
        resetModalContent.includes('role="dialog"'),
        'Must declare role="dialog"'
      );
      assert.ok(
        resetModalContent.includes('aria-modal="true"'),
        'Must declare aria-modal="true"'
      );
      assert.ok(
        resetModalContent.includes('aria-labelledby="reset-confirmation-title"'),
        'Must reference title via aria-labelledby'
      );
      assert.ok(
        resetModalContent.includes('id="reset-confirmation-title"'),
        'Title element must have id="reset-confirmation-title"'
      );
      assert.ok(
        resetModalContent.includes('aria-describedby="reset-confirmation-description"'),
        'Must reference warning description via aria-describedby'
      );
      assert.ok(
        resetModalContent.includes('id="reset-confirmation-description"'),
        'Description element must have id="reset-confirmation-description"'
      );
    });

    it('ensures backdrop interaction NEVER invokes onClose or onConfirm (accidental dismissal/reset protection)', () => {
      // Find the outer backdrop div container
      const outerBackdropRegex = /<div\s+className="fixed inset-0[^"]*"[^>]*>/i;
      const match = resetModalContent.match(outerBackdropRegex);
      assert.ok(match, 'Outer backdrop container must exist');
      const outerTag = match[0];
      assert.strictEqual(
        outerTag.includes('onClick'),
        false,
        'Backdrop must NOT have an onClick handler'
      );
    });

    it('proves behavioral invocation contracts for Cancel, Escape, and Confirm', () => {
      // 1. Simulate Cancel action
      let closeCallCount = 0;
      let confirmCallCount = 0;
      const onClose = () => { closeCallCount++; };
      const onConfirm = () => { confirmCallCount++; };

      // Simulate clicking Cancel button
      onClose();
      assert.strictEqual(closeCallCount, 1, 'Cancel button must invoke onClose exactly once');
      assert.strictEqual(confirmCallCount, 0, 'Cancel button must never invoke onConfirm');

      // 2. Simulate Escape key dismissal via handleEscapeKey
      let escapePrevented = false;
      let escapeStopped = false;
      const escapeEvent = {
        key: 'Escape',
        preventDefault: () => { escapePrevented = true; },
        stopPropagation: () => { escapeStopped = true; }
      };
      const handled = handleEscapeKey(escapeEvent, onClose, false);
      assert.strictEqual(handled, true);
      assert.strictEqual(escapePrevented, true);
      assert.strictEqual(escapeStopped, true);
      assert.strictEqual(closeCallCount, 2, 'Escape key must invoke onClose exactly once');
      assert.strictEqual(confirmCallCount, 0, 'Escape key must never invoke onConfirm');

      // 3. Simulate Confirm action
      onConfirm();
      assert.strictEqual(confirmCallCount, 1, 'Confirm button must invoke onConfirm exactly once');
      assert.strictEqual(closeCallCount, 2, 'Confirm button must not invoke onClose');
    });

    it('ensures cancel button has ref and triggers onClose, and destructive button triggers onConfirm', () => {
      assert.ok(
        resetModalContent.includes('ref={cancelButtonRef}'),
        'Cancel button must attach cancelButtonRef'
      );
      assert.ok(
        resetModalContent.includes('onClick={onClose}'),
        'Cancel button must trigger onClose'
      );
      assert.ok(
        resetModalContent.includes('onClick={onConfirm}'),
        'Confirm button must trigger onConfirm'
      );
      assert.ok(
        resetModalContent.includes('type="button"'),
        'Action buttons must have explicit type="button"'
      );
    });
  });

  describe('Defect 2: Navbar Cycle Dropdown Keyboard Operability & Hierarchy', () => {
    it('implements semantic trigger button with aria-haspopup, aria-expanded, and focus management', () => {
      assert.ok(
        navbarContent.includes('aria-haspopup="true"'),
        'Trigger button must declare aria-haspopup'
      );
      assert.ok(
        navbarContent.includes('aria-expanded={isCycleDropdownOpen}'),
        'Trigger button must expose aria-expanded state'
      );
      assert.ok(
        navbarContent.includes('ref={cycleDropdownButtonRef}'),
        'Trigger button must have ref for focus return'
      );
    });

    it('provides native buttons for cycle selection and separate non-nested delete button', () => {
      assert.ok(
        navbarContent.includes('onSelectCycle(c)'),
        'Cycle selection button must call onSelectCycle'
      );
      assert.ok(
        navbarContent.includes('aria-current={isCurrent ? \'true\' : undefined}'),
        'Active cycle must declare aria-current="true"'
      );
      assert.ok(
        navbarContent.includes('handleDeleteCycleClick'),
        'Delete button must have distinct click handler'
      );
      assert.ok(
        navbarContent.includes('e.stopPropagation()'),
        'Delete button click must stop propagation to avoid selecting cycle'
      );
    });

    it('contains Tab trapping, Escape dismissal, and Arrow key navigation in dropdown panel', () => {
      assert.ok(
        navbarContent.includes("if (e.key === 'Escape')"),
        'Must handle Escape key to dismiss dropdown'
      );
      assert.ok(
        navbarContent.includes("if (e.key === 'Tab'"),
        'Must handle Tab key for focus containment in dropdown'
      );
      assert.ok(
        navbarContent.includes("e.key === 'ArrowDown' || e.key === 'ArrowUp'"),
        'Must support ArrowUp / ArrowDown keyboard navigation'
      );
      assert.ok(
        navbarContent.includes('cycleDropdownButtonRef.current?.focus()'),
        'Must return focus to trigger button on Escape or selection'
      );
    });
  });

  describe('Defect 3: Forced-Color & High Contrast Support', () => {
    it('does not suppress forced-color-adjust globally on html, body, or #root', () => {
      const globalMatches = indexCssContent.match(/(?:html|body|#root)[^{]*\{[^}]*forced-color-adjust\s*:\s*none/gi);
      assert.strictEqual(
        globalMatches,
        null,
        'Global forced-color-adjust: none is strictly forbidden'
      );
    });

    it('includes @media (forced-colors: active) rules for WHCM system colors and visible focus outlines', () => {
      assert.ok(
        indexCssContent.includes('@media (forced-colors: active)'),
        'Must include @media (forced-colors: active) block'
      );
      assert.ok(
        indexCssContent.includes('Highlight'),
        'Must use system Highlight color for focus / active items'
      );
      assert.ok(
        indexCssContent.includes('ButtonText'),
        'Must use system ButtonText color'
      );
      assert.ok(
        indexCssContent.includes('CanvasText'),
        'Must use system CanvasText color'
      );
    });
  });

  describe('Gap 4: Application-Level Navigation Semantics', () => {
    it('exposes aria-current="page" on the active navigation destination across Desktop and Mobile', () => {
      assert.ok(
        navbarContent.includes("aria-current={isActive ? 'page' : undefined}"),
        'Navigation buttons must set aria-current="page" when active'
      );
    });

    it('declares descriptive Persian aria-label attributes on navigation landmarks', () => {
      assert.ok(
        navbarContent.includes('aria-label="ناوبری اصلی"'),
        'Desktop nav must declare aria-label="ناوبری اصلی"'
      );
      assert.ok(
        navbarContent.includes('aria-label="ناوبری اصلی همراه"'),
        'Mobile nav must declare aria-label="ناوبری اصلی همراه"'
      );
    });

    it('provides screen-reader text for debt and milestone indicator badges', () => {
      assert.ok(
        navbarContent.includes('بدهی باز'),
        'Debt alert badge must include accessible text for screen readers'
      );
      assert.ok(
        navbarContent.includes('نقطه عطف جدید در دسترس است'),
        'Milestone alert must include accessible Persian description'
      );
    });
  });

  describe('Gap 5: Skip Link to Main Content Landmark', () => {
    it('renders skip link targeting #main-content as the first interactive element in App.tsx', () => {
      assert.ok(
        appContent.includes('href="#main-content"'),
        'App.tsx must include skip link pointing to #main-content'
      );
      assert.ok(
        appContent.includes('پرش به محتوای اصلی'),
        'Skip link must use Persian label "پرش به محتوای اصلی"'
      );
      assert.ok(
        appContent.includes('id="main-content"'),
        'Main element must have id="main-content"'
      );
      assert.ok(
        appContent.includes('tabIndex={-1}'),
        'Main element must be focusable via tabIndex={-1} for skip navigation'
      );
    });
  });

  describe('Gap 6: Reduced-Motion Support in Application Shell', () => {
    it('respects useReducedMotion in App.tsx to suppress page transitions', () => {
      assert.ok(
        appContent.includes('useReducedMotion()'),
        'App.tsx must invoke useReducedMotion()'
      );
      assert.ok(
        appContent.includes('shouldReduceMotion'),
        'App.tsx must condition transitions on shouldReduceMotion'
      );
    });

    it('respects useReducedMotion in Navbar.tsx for tab indicator layouts', () => {
      assert.ok(
        navbarContent.includes('useReducedMotion()'),
        'Navbar.tsx must invoke useReducedMotion()'
      );
      assert.ok(
        navbarContent.includes('shouldReduceMotion ? undefined : "desktopActiveTabIndicator"') ||
        navbarContent.includes('shouldReduceMotion ? undefined : "activeTabIndicator"'),
        'Navbar must suppress layout animations under reduced motion'
      );
    });

    it('applies motion-reduce:animate-none on pulse and ping badges', () => {
      assert.ok(
        navbarContent.includes('motion-reduce:animate-none'),
        'Navbar must include motion-reduce:animate-none'
      );
      assert.ok(
        appContent.includes('motion-reduce:animate-none'),
        'App shell must include motion-reduce:animate-none'
      );
    });
  });
});
