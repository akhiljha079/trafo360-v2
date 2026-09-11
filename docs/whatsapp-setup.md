# WhatsApp Web Setup

Configured entirely from **Administration → WhatsApp Web** - no server config needed beyond the
`WHATSAPP_SESSION_PATH` directory already set up in `.env`/`docker-compose.yml` (a volume, so a
container restart doesn't force you to re-pair).

## Read this before you turn it on

WhatsApp is **not the authoritative notification channel** - email is (see `docs/architecture.md`
section 8, and the default `NotificationRule` for every event: email on, WhatsApp off). This isn't a
technical limitation, it's a deliberate stance: `whatsapp-web.js` drives an unofficial, policy-fragile
protocol (it automates a real WhatsApp Web session, not an official Business API), and Meta can and
does change things that break libraries like this without notice, or flag/ban numbers that send
programmatically at volume. Treat it as a nice-to-have supplementary channel for users who actually
want it, not something a business-critical workflow should depend on exclusively. Turn on the
WhatsApp channel per-event in Notification Rules only for events where that risk is acceptable to
you.

## Pairing

1. Administration → WhatsApp Web → **Connect**.
2. A QR code appears (rendered server-side by a headless Chromium instance the API/worker container
   launches on demand - no browser installation needed on your end beyond what's already in the
   `node:20-bookworm-slim` base image).
3. On the phone number you want sending these notifications: WhatsApp → Settings → Linked Devices →
   Link a Device → scan the QR code.
4. Status flips to Connected once pairing completes. Session files are written to
   `WHATSAPP_SESSION_PATH` (filesystem-only, never returned in any API response) so a restart doesn't
   require re-pairing.
5. **Disconnect** tears down the session cleanly (verified during Phase 6 build/test to actually kill
   the underlying Chrome process tree, not leave it orphaned) - use this before re-pairing to a
   different number, or if you want to revoke WhatsApp access entirely.

## What's actually been verified vs. what hasn't

Verified live during this build: QR generation produces a genuinely valid, scannable code; connection
status is reported correctly (including a real bug fix - see `docs/BUILD_PROGRESS.md`'s Phase 6 notes
- where a timeout was originally being misreported as a successful connection); Disconnect cleanly
terminates the Chrome process.

**Not verified**: actual message delivery to a real phone through a completed pairing - that needs a
physical phone to pair with, which wasn't available in the build environment. The send path
(`WhatsappService.send()`) is code-complete and follows the same client API pattern as connect/
disconnect, but treat first real-world use as the actual first test of it. Every send is logged to
the `WhatsappLog` table (same idea as `EmailLog`), but unlike `EmailLog` there's no
`GET /api/whatsapp-logs` endpoint yet - checking delivery failures today means querying the table
directly rather than through the API.

## Troubleshooting

- **QR code never appears / "did not respond within 15s" error**: usually means the headless Chromium
  couldn't launch - check the container has the shared libraries Puppeteer needs (the
  `node:20-bookworm-slim` base image does; a from-scratch/alpine-based custom image likely won't) and
  that the container isn't memory-constrained (headless Chrome is not lightweight).
- **Session keeps dropping**: WhatsApp Web sessions expire if the linked phone stays offline for an
  extended period (WhatsApp's own behavior, not this app's) - re-pair from Administration → WhatsApp
  Web.
