import { useEffect, useRef, useCallback } from 'react';

/**
 * Standard CSS selector for focusable DOM elements
 */
export const FOCUSABLE_ELEMENTS_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'iframe:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  '[contentEditable=true]:not([tabindex="-1"])'
].join(', ');

/**
 * Checks if a DOM element is visible and capable of receiving focus
 */
export function isElementVisible(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('tabindex') === '-1') return false;

  // Check inline style directly (works in Node and browser)
  if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
    return false;
  }

  // In standard browser environment, check computed style
  if (typeof window !== 'undefined' && 'getComputedStyle' in window) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }

  // If layout metrics exist, verify non-zero size or parent attachment
  if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects && el.getClientRects().length === 0) {
    // If element or parent has offsetParent null and not fixed/body, it may be hidden
    if (el.offsetParent === null && el.style && el.style.position !== 'fixed' && el.tagName !== 'BODY') {
      return false;
    }
  }

  return true;
}

/**
 * Retrieves all focusable, visible elements inside a container in DOM order
 */
export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const matches = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR));
  return matches.filter(isElementVisible);
}

/**
 * Evaluates whether Escape dismissal should be prevented (e.g. during an in-flight operation)
 */
export function shouldBlockEscape(isBusy?: boolean): boolean {
  return Boolean(isBusy);
}

/**
 * Pure Tab/Shift+Tab trapping logic
 * Returns true if the key event was trapped/handled, false otherwise.
 */
export function trapTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  container: HTMLElement | null,
  activeElement: HTMLElement | null = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null)
): boolean {
  if (e.key !== 'Tab') return false;
  if (!container) return false;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    e.preventDefault();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    // Shift + Tab: moving backwards
    if (!activeElement || !container.contains(activeElement) || activeElement === first) {
      e.preventDefault();
      last.focus();
      return true;
    }
  } else {
    // Tab: moving forwards
    if (!activeElement || !container.contains(activeElement) || activeElement === last) {
      e.preventDefault();
      first.focus();
      return true;
    }
  }

  return false;
}

/**
 * Pure Escape key handler
 * Returns true if Escape closed the modal, false if blocked or not Escape
 */
export function handleEscapeKey(
  e: { key: string; preventDefault: () => void; stopPropagation?: () => void },
  onClose: () => void,
  isBusy?: boolean
): boolean {
  if (e.key !== 'Escape') return false;
  if (shouldBlockEscape(isBusy)) return false;

  if (e.stopPropagation) e.stopPropagation();
  e.preventDefault();
  onClose();
  return true;
}

export interface UseModalAccessibilityOptions {
  isOpen: boolean;
  onClose: () => void;
  isBusy?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  focusKey?: any; // Re-evaluate focus when this key changes while open (e.g., activeTab in AuthModal)
  autoFocusFirst?: boolean;
}

/**
 * Universal Modal Accessibility Hook
 * Enforces:
 * 1. Opener focus capture and return on close
 * 2. Initial focus entry to first meaningful form control or initialFocusRef
 * 3. Tab & Shift+Tab focus containment (trap)
 * 4. Escape dismissal with protection against closing in-flight operations
 * 5. Re-focus management on nested state/tab transitions
 */
export function useModalAccessibility<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  isBusy = false,
  initialFocusRef,
  focusKey,
  autoFocusFirst = true
}: UseModalAccessibilityOptions) {
  const containerRef = useRef<T>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  // 1. Capture previously focused opener element before opening
  useEffect(() => {
    if (isOpen) {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        openerRef.current = document.activeElement;
      }
    } else {
      // When modal closes, return focus to the opener element
      if (openerRef.current && typeof document !== 'undefined') {
        const opener = openerRef.current;
        openerRef.current = null;
        if (document.contains(opener) && typeof opener.focus === 'function') {
          opener.focus();
        }
      }
    }
  }, [isOpen]);

  // Clean up focus return on unmount
  useEffect(() => {
    return () => {
      if (openerRef.current && typeof document !== 'undefined') {
        const opener = openerRef.current;
        openerRef.current = null;
        if (document.contains(opener) && typeof opener.focus === 'function') {
          opener.focus();
        }
      }
    };
  }, []);

  // 2. Initial focus entry when modal opens or when focusKey changes
  const applyInitialFocus = useCallback(() => {
    if (!isOpen || !containerRef.current) return;

    // A small tick / RAF allows child animations and DOM mounting to settle
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      // Priority 1: explicitly passed initialFocusRef
      if (initialFocusRef?.current && containerRef.current.contains(initialFocusRef.current)) {
        initialFocusRef.current.focus();
        return;
      }

      if (!autoFocusFirst) return;

      const focusables = getFocusableElements(containerRef.current);
      if (focusables.length === 0) {
        // Fallback: focus dialog container itself
        containerRef.current.focus();
        return;
      }

      // Priority 2: first meaningful form field (input, textarea, select)
      const formInput = focusables.find(el => 
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
        (el as HTMLInputElement).type !== 'button' &&
        (el as HTMLInputElement).type !== 'submit'
      );

      if (formInput) {
        formInput.focus();
      } else {
        // Priority 3: first focusable element (e.g. close button or tab)
        focusables[0].focus();
      }
    }, 30);

    return () => clearTimeout(timer);
  }, [isOpen, initialFocusRef, autoFocusFirst]);

  useEffect(() => {
    if (isOpen) {
      const cleanup = applyInitialFocus();
      return cleanup;
    }
  }, [isOpen, focusKey, applyInitialFocus]);

  // 3. Focus containment (Tab trap) and Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if another nested element stopped propagation
      if (e.defaultPrevented) return;

      if (e.key === 'Escape') {
        handleEscapeKey(e, () => onCloseRef.current(), isBusyRef.current);
        return;
      }

      if (e.key === 'Tab') {
        trapTabKey(e, containerRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  return {
    containerRef,
    openerRef
  };
}
