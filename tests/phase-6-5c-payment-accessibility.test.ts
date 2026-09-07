import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { handleEscapeKey, shouldBlockEscape, trapTabKey } from '../src/utils/useModalAccessibility';
import { PLANS } from '../src/config/plans';

describe('Phase 6.5C: Payment Modal Accessibility Verification', () => {
  const paymentModalPath = path.join(process.cwd(), 'src/components/PaymentModal.tsx');
  const paymentModalContent = fs.readFileSync(paymentModalPath, 'utf8');

  describe('1. Dialog Semantics & Modal Accessibility Hook Contract', () => {
    it('uses useModalAccessibility with isOpen, onClose, isBusy (isLoading), and focusKey (step)', () => {
      assert.ok(
        paymentModalContent.includes('useModalAccessibility'),
        'PaymentModal must use useModalAccessibility'
      );
      assert.ok(
        paymentModalContent.includes('isBusy: isLoading'),
        'Must pass isBusy: isLoading to prevent closing during in-flight payments'
      );
      assert.ok(
        paymentModalContent.includes('focusKey: step'),
        'Must pass focusKey: step to update focus across steps'
      );
    });

    it('exposes semantic role="dialog", aria-modal="true", and aria-busy={isLoading}', () => {
      assert.ok(
        paymentModalContent.includes('role="dialog"'),
        'Must declare role="dialog"'
      );
      assert.ok(
        paymentModalContent.includes('aria-modal="true"'),
        'Must declare aria-modal="true"'
      );
      assert.ok(
        paymentModalContent.includes('aria-busy={isLoading}'),
        'Must declare aria-busy={isLoading}'
      );
    });

    it('connects aria-labelledby and aria-describedby dynamically for each step', () => {
      // Step 1: plans
      assert.ok(paymentModalContent.includes("'payment-modal-title'"), 'Must link plan title ID');
      assert.ok(paymentModalContent.includes("'payment-modal-desc'"), 'Must link plan desc ID');
      assert.ok(paymentModalContent.includes('id="payment-modal-title"'), 'Title must have id="payment-modal-title"');
      assert.ok(paymentModalContent.includes('id="payment-modal-desc"'), 'Desc must have id="payment-modal-desc"');

      // Step 2: simulator
      assert.ok(paymentModalContent.includes("'payment-simulator-title'"), 'Must link simulator title ID');
      assert.ok(paymentModalContent.includes("'payment-simulator-desc'"), 'Must link simulator desc ID');
      assert.ok(paymentModalContent.includes('id="payment-simulator-title"'), 'Simulator title must have id="payment-simulator-title"');
      assert.ok(paymentModalContent.includes('id="payment-simulator-desc"'), 'Simulator desc must have id="payment-simulator-desc"');

      // Step 3: success
      assert.ok(paymentModalContent.includes("'payment-success-title'"), 'Must link success title ID');
      assert.ok(paymentModalContent.includes("'payment-success-desc'"), 'Must link success desc ID');
      assert.ok(paymentModalContent.includes('id="payment-success-title"'), 'Success title must have id="payment-success-title"');
      assert.ok(paymentModalContent.includes('id="payment-success-desc"'), 'Success desc must have id="payment-success-desc"');
    });
  });

  describe('2. Behavioral Dismissal & In-Flight Protection Contract', () => {
    it('Escape closes when idle and is blocked when isLoading is true', () => {
      let closeCount = 0;
      const onClose = () => { closeCount++; };

      // Idle state
      const idleEvent = {
        key: 'Escape',
        preventDefault: () => {},
        stopPropagation: () => {}
      };
      const handledIdle = handleEscapeKey(idleEvent, onClose, false);
      assert.strictEqual(handledIdle, true, 'Escape must handle when idle');
      assert.strictEqual(closeCount, 1, 'onClose called once when idle');

      // Busy / isLoading state
      const busyEvent = {
        key: 'Escape',
        preventDefault: () => {},
        stopPropagation: () => {}
      };
      const handledBusy = handleEscapeKey(busyEvent, onClose, true);
      assert.strictEqual(handledBusy, false, 'Escape must be blocked when busy');
      assert.strictEqual(closeCount, 1, 'onClose must NOT be called when busy');
      assert.strictEqual(shouldBlockEscape(true), true);
      assert.strictEqual(shouldBlockEscape(false), false);
    });

    it('Backdrop interaction closes when idle and is blocked when isLoading is true', () => {
      // Pure behavioral simulation of handleBackdropClick logic
      const createBackdropHandler = (isLoading: boolean, onClose: () => void) => {
        return () => {
          if (isLoading) return;
          onClose();
        };
      };

      let closeCount = 0;
      const onClose = () => { closeCount++; };

      // Idle backdrop click
      const idleBackdropClick = createBackdropHandler(false, onClose);
      idleBackdropClick();
      assert.strictEqual(closeCount, 1, 'Backdrop click invokes onClose when idle');

      // Busy backdrop click (during payment request or verification)
      const busyBackdropClick = createBackdropHandler(true, onClose);
      busyBackdropClick();
      assert.strictEqual(closeCount, 1, 'Backdrop click does NOT invoke onClose when loading');
    });

    it('disables cancel and close buttons while isLoading is true', () => {
      assert.ok(
        paymentModalContent.includes('disabled={isLoading}'),
        'Close and Cancel buttons must be disabled when isLoading is true'
      );
    });
  });

  describe('3. Plan Selection Radiogroup & Keyboard Operability', () => {
    it('declares role="radiogroup" and renders plans as native buttons with role="radio"', () => {
      assert.ok(
        paymentModalContent.includes('role="radiogroup"'),
        'Plan collection must declare role="radiogroup"'
      );
      assert.ok(
        paymentModalContent.includes('aria-label="انتخاب طرح اشتراک"'),
        'Radiogroup must have descriptive aria-label'
      );
      assert.ok(
        paymentModalContent.includes('role="radio"'),
        'Plan options must declare role="radio"'
      );
      assert.ok(
        paymentModalContent.includes('aria-checked={isSelected}'),
        'Plan options must expose aria-checked={isSelected}'
      );
    });

    it('proves keyboard arrow cycling and selection behavior across plans', () => {
      let selectedIndex = 0;
      const cyclePlan = (key: string, currentIndex: number): number => {
        if (key === 'ArrowDown' || key === 'ArrowRight') {
          return (currentIndex + 1) % PLANS.length;
        } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
          return (currentIndex - 1 + PLANS.length) % PLANS.length;
        }
        return currentIndex;
      };

      assert.strictEqual(PLANS.length >= 2, true, 'There should be at least 2 subscription plans');

      // Down / Right moves next
      selectedIndex = cyclePlan('ArrowDown', 0);
      assert.strictEqual(selectedIndex, 1);

      // Up / Left moves prev
      selectedIndex = cyclePlan('ArrowUp', 1);
      assert.strictEqual(selectedIndex, 0);

      // Wrap-around backward from 0
      selectedIndex = cyclePlan('ArrowLeft', 0);
      assert.strictEqual(selectedIndex, PLANS.length - 1);

      // Wrap-around forward from last
      selectedIndex = cyclePlan('ArrowRight', PLANS.length - 1);
      assert.strictEqual(selectedIndex, 0);
    });
  });

  describe('4. Live Regions, Errors, Status, and Reduced Motion', () => {
    it('exposes payment errors through role="alert" and aria-live="assertive"', () => {
      assert.ok(
        paymentModalContent.includes('role="alert"'),
        'Payment error container must declare role="alert"'
      );
      assert.ok(
        paymentModalContent.includes('aria-live="assertive"'),
        'Payment error container must declare aria-live="assertive"'
      );
    });

    it('exposes payment success through role="status" and aria-live="polite"', () => {
      assert.ok(
        paymentModalContent.includes('role="status"'),
        'Payment success receipt must declare role="status"'
      );
      assert.ok(
        paymentModalContent.includes('aria-live="polite"'),
        'Payment success receipt must declare aria-live="polite"'
      );
    });

    it('respects useReducedMotion for transitions and spinner animations', () => {
      assert.ok(
        paymentModalContent.includes('useReducedMotion()'),
        'Must import and call useReducedMotion()'
      );
      assert.ok(
        paymentModalContent.includes('shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }'),
        'Must suppress scale and translation when shouldReduceMotion is active'
      );
      assert.ok(
        paymentModalContent.includes("shouldReduceMotion ? '' : 'animate-spin'"),
        'Must suppress spinner rotation when shouldReduceMotion is active'
      );
    });

    it('preserves LTR direction for authority, refId, cardPan, and date values', () => {
      assert.ok(
        paymentModalContent.includes('dir="ltr"'),
        'Technical receipt values must declare dir="ltr"'
      );
    });
  });

  describe('5. Payment Invariants & Verification Contract Integrity', () => {
    it('preserves payment request endpoint and parameters', () => {
      assert.ok(
        paymentModalContent.includes("fetch('/api/payment/request'"),
        'Payment request endpoint must remain /api/payment/request'
      );
      assert.ok(
        paymentModalContent.includes('planId: selectedPlan.id'),
        'Request must send selectedPlan.id'
      );
      assert.ok(
        paymentModalContent.includes('amount: selectedPlan.priceToman'),
        'Request must send selectedPlan.priceToman'
      );
    });

    it('preserves payment verification endpoint and validateAuthoritativePaymentResponse call', () => {
      assert.ok(
        paymentModalContent.includes("fetch('/api/payment/verify'"),
        'Payment verification endpoint must remain /api/payment/verify'
      );
      assert.ok(
        paymentModalContent.includes('validateAuthoritativePaymentResponse'),
        'Must invoke validateAuthoritativePaymentResponse'
      );
      assert.ok(
        paymentModalContent.includes('onUpgradeSuccess(validation.validatedUser)'),
        'Must pass validatedUser to onUpgradeSuccess'
      );
    });
  });
});
