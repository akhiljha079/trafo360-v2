/** Pure expiry/reminder-cadence rules for Type Test Certificates - zero
 * DB/Nest dependency (same reasoning as workflow/stage-status.ts), so the
 * "1 month left" and "every 4 days" rules are trivially unit-testable and
 * can't silently drift from what's actually implemented. Every function
 * takes `now` explicitly rather than reading `Date.now()` internally, so
 * tests are deterministic. */

export const EXPIRY_WARNING_DAYS = 30; // spec ask: "1 month left"
export const REMINDER_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // spec ask: "every 4" days

export type ExpiryStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED";

export function daysUntil(expiryDate: Date, now: Date): number {
  return Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeExpiryStatus(expiryDate: Date, now: Date): { daysLeft: number; expiryStatus: ExpiryStatus } {
  const daysLeft = daysUntil(expiryDate, now);
  const expiryStatus: ExpiryStatus = daysLeft < 0 ? "EXPIRED" : daysLeft <= EXPIRY_WARNING_DAYS ? "EXPIRING_SOON" : "VALID";
  return { daysLeft, expiryStatus };
}

/** A certificate is due for a reminder once it's within the warning window
 * (including already expired - reminders don't stop just because the date
 * passed, they stop only on renewal) AND either never reminded before or
 * the last reminder was at least REMINDER_INTERVAL_MS ago. */
export function isReminderDue(expiryDate: Date, lastReminderSentAt: Date | null, now: Date): boolean {
  const withinWarningWindow = daysUntil(expiryDate, now) <= EXPIRY_WARNING_DAYS;
  if (!withinWarningWindow) return false;
  if (lastReminderSentAt === null) return true;
  return now.getTime() - lastReminderSentAt.getTime() >= REMINDER_INTERVAL_MS;
}
