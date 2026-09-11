# SMTP Setup

Configured from **Administration → SMTP** - host, port, TLS, credentials, from-address/name. The
password is encrypted at rest (`SECRETS_ENCRYPTION_KEY`) and never shown back in the UI after saving.

## Setup

1. Administration → SMTP → fill in your provider's host/port/credentials → Save.
2. **Send Test Email** to an address you control, and check it actually arrives (including spam
   folder - a first-time send from a new host/domain often lands there until sender reputation
   builds up; that's normal, not a bug in this app).
3. That's it - every notification event (document approval pending/approved/rejected, file issued,
   extension approved/rejected, type test certificate expiring, etc.) now sends through this config
   automatically for any user/event combination where the Notification Rules admin page has email
   enabled (on by default for every event).

## Failure visibility

Every send attempt - success or failure - is logged to `EmailLog`, queryable via
`GET /api/email-logs` (requires `notification.manage`) - the API exists but no dedicated admin page
renders it yet (a table view here is a natural small addition for whoever picks this up next). If a
user reports "I never got the approval email," check that endpoint for their recipient/event rather
than assuming it's an SMTP config problem; a failed send is caught and logged, not silently
swallowed, and a `NotificationRule` with email disabled for that event is at least as likely a cause
as a real SMTP failure.

## Common provider notes

- **Office 365 / Exchange Online**: host `smtp.office365.com`, port `587`, TLS (not SSL) - requires
  an app password or OAuth2 if the tenant has MFA enforced on the sending mailbox (this app uses
  plain username/password auth via Nodemailer, not OAuth2 - use a dedicated service mailbox with an
  app password, not a personal MFA-protected account).
- **Gmail / Google Workspace**: host `smtp.gmail.com`, port `587`, requires an app password (not the
  account password) if 2FA is on, which it should be.
- **A self-hosted/internal relay**: port `25` with no auth is common for internal-only relays - if so,
  leave username/password blank.
- **`SMTP_FROM_EMAIL`/`SMTP_FROM_NAME`**: many providers reject or spam-flag mail where the `From`
  address doesn't match the authenticated account's domain (SPF/DKIM alignment) - keep these matching
  your actual sending domain.
