/**
 * Server-Authoritative VIP Renewal Policy Boundary
 * Phase 5A: Work Package 9
 *
 * POLICY SPECIFICATION (Approved temporary behavior):
 * 1. If the user currently has an active unexpired VIP entitlement (vipExpiresAt in the future),
 *    calculate the new expiration starting from that current vipExpiresAt.
 * 2. Otherwise (no previous VIP, or VIP already expired), calculate expiration starting from
 *    the current server time.
 * 3. Add the selected server-owned Plan duration exactly once.
 * 4. Duplicate verification must NOT add duration again (returns unchanged record).
 *
 * NOTE: This is an explicit, isolated policy boundary that Copilot may revisit
 * before Phase 5 closure. The client is strictly forbidden from providing or altering
 * the expiration base or duration.
 */

export function calculateRenewalExpiration(
  currentVipExpiresAt: string | Date | null | undefined,
  durationDays: number,
  now: Date = new Date()
): Date {
  const safeDays = Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 30;
  const nowMs = now.getTime();
  let baseMs = nowMs;

  if (currentVipExpiresAt) {
    const existingDate =
      currentVipExpiresAt instanceof Date
        ? currentVipExpiresAt
        : new Date(currentVipExpiresAt);

    if (!isNaN(existingDate.getTime()) && existingDate.getTime() > nowMs) {
      // User has an active unexpired VIP: extend from current expiration
      baseMs = existingDate.getTime();
    }
  }

  const durationMs = safeDays * 86400000;
  return new Date(baseMs + durationMs);
}
