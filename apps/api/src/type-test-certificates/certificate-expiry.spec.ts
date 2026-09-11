import { computeExpiryStatus, isReminderDue, REMINDER_INTERVAL_MS } from "./certificate-expiry";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe("computeExpiryStatus", () => {
  it("is VALID with more than 30 days left", () => {
    expect(computeExpiryStatus(days(31), NOW).expiryStatus).toBe("VALID");
  });

  it("is EXPIRING_SOON at exactly 30 days left", () => {
    expect(computeExpiryStatus(days(30), NOW).expiryStatus).toBe("EXPIRING_SOON");
  });

  it("is EXPIRING_SOON with a few days left", () => {
    expect(computeExpiryStatus(days(3), NOW).expiryStatus).toBe("EXPIRING_SOON");
  });

  it("is EXPIRED the moment the date is in the past", () => {
    const result = computeExpiryStatus(days(-1), NOW);
    expect(result.expiryStatus).toBe("EXPIRED");
    expect(result.daysLeft).toBeLessThan(0);
  });
});

describe("isReminderDue", () => {
  it("is false when more than 30 days remain, regardless of reminder history", () => {
    expect(isReminderDue(days(45), null, NOW)).toBe(false);
  });

  it("is true the first time a certificate enters the 30-day window", () => {
    expect(isReminderDue(days(20), null, NOW)).toBe(true);
  });

  it("is false right after a reminder was just sent", () => {
    expect(isReminderDue(days(20), NOW, NOW)).toBe(false);
  });

  it("is false a day before the 4-day interval elapses", () => {
    const lastReminder = new Date(NOW.getTime() - REMINDER_INTERVAL_MS + 24 * 60 * 60 * 1000);
    expect(isReminderDue(days(20), lastReminder, NOW)).toBe(false);
  });

  it("is true once the 4-day interval has elapsed", () => {
    const lastReminder = new Date(NOW.getTime() - REMINDER_INTERVAL_MS);
    expect(isReminderDue(days(20), lastReminder, NOW)).toBe(true);
  });

  it("stays true after expiry - reminders don't stop just because the date passed", () => {
    expect(isReminderDue(days(-10), null, NOW)).toBe(true);
  });

  it("keeps reminding every 4 days indefinitely after expiry until renewed", () => {
    const lastReminder = new Date(NOW.getTime() - REMINDER_INTERVAL_MS);
    expect(isReminderDue(days(-30), lastReminder, NOW)).toBe(true);
  });
});
