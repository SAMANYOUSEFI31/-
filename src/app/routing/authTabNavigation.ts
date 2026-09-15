export type AuthTab = 'login' | 'register' | 'forgot';

export const AUTH_TABS: readonly AuthTab[] = ['login', 'register', 'forgot'] as const;

/**
 * Calculates the next or previous tab in the sequence.
 */
export function getNextTab(
  currentTab: AuthTab,
  direction: 'next' | 'prev' | 'first' | 'last'
): AuthTab {
  const currentIndex = AUTH_TABS.indexOf(currentTab);
  if (currentIndex === -1) return AUTH_TABS[0];

  if (direction === 'first') return AUTH_TABS[0];
  if (direction === 'last') return AUTH_TABS[AUTH_TABS.length - 1];

  if (direction === 'next') {
    return AUTH_TABS[(currentIndex + 1) % AUTH_TABS.length];
  } else {
    return AUTH_TABS[(currentIndex - 1 + AUTH_TABS.length) % AUTH_TABS.length];
  }
}

/**
 * Pure keyboard navigation handler for WAI-ARIA tablist in AuthModal.
 * In RTL (Right-to-Left) interface:
 * - Visual order is: [Login (right)] -> [Register (center)] -> [Forgot (left)]
 * - ArrowLeft moves towards the left (visually NEXT tab)
 * - ArrowRight moves towards the right (visually PREVIOUS tab)
 * - Home activates the first tab ('login')
 * - End activates the last tab ('forgot')
 *
 * Returns the target AuthTab to select and focus, or null if the key is not handled.
 */
export function handleTabListKeyDown(
  key: string,
  currentTab: AuthTab,
  isRtl: boolean = true
): AuthTab | null {
  if (key === 'Home') {
    return getNextTab(currentTab, 'first');
  }

  if (key === 'End') {
    return getNextTab(currentTab, 'last');
  }

  if (key === 'ArrowLeft') {
    return isRtl ? getNextTab(currentTab, 'next') : getNextTab(currentTab, 'prev');
  }

  if (key === 'ArrowRight') {
    return isRtl ? getNextTab(currentTab, 'prev') : getNextTab(currentTab, 'next');
  }

  return null;
}
