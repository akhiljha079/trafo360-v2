// Type test certificate expiry reminders live entirely in the API
// (NotificationsService, so admins can still control channels/templates
// from Administration -> Notification Rules) - the worker's only job is to
// trigger that check on a schedule via an internal token, since it has no
// logged-in user of its own to call the endpoint as. The 4-day reminder
// cadence itself is enforced server-side (TypeTestCertificatesService
// tracks lastReminderSentAt), so ticking this more or less often than 4
// days never causes duplicate/missed reminders - it just changes how
// quickly a newly-qualifying certificate gets its first reminder.
export async function runCertificateExpiryCheck(): Promise<void> {
  // Defaults to localhost for local/dev where both processes share a host;
  // Docker Compose overrides this to http://api:4000 since "localhost"
  // inside the worker container would otherwise mean the worker container
  // itself, not the api one - see docker-compose.yml.
  const baseUrl = process.env.API_INTERNAL_URL ?? `http://localhost:${process.env.API_PORT ?? "4000"}`;
  const token = process.env.INTERNAL_WORKER_TOKEN;
  if (!token) {
    // eslint-disable-next-line no-console
    console.warn("[worker] INTERNAL_WORKER_TOKEN not set - skipping certificate expiry check");
    return;
  }
  const res = await fetch(`${baseUrl}/api/type-test-certificates/check-expiring`, {
    method: "POST",
    headers: { "x-internal-token": token },
  });
  if (!res.ok) {
    throw new Error(`certificate expiry check failed: ${res.status} ${await res.text()}`);
  }
}
