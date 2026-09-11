# AD / LDAP Setup

Entirely configured from **Administration → AD / LDAP** - no server-side config file editing needed.

## Fields

| Field | Notes |
|---|---|
| AD/LDAP sign-in enabled | Off by default - the local bootstrap admin can configure everything before turning this on. Leave off until Test Connection succeeds. |
| Host / Protocol / Port | Protocol is `ldap` or `ldaps` - use `ldaps` (port 636) in production; plain `ldap` (389) sends the bind password over the wire unencrypted. |
| Timeout (ms) | Connection timeout for both the login bind and sync - 5000ms default is generous for an on-prem DC, may need raising for a DC over a slow WAN link. |
| Base DN | e.g. `DC=yourcompany,DC=com` |
| User search DN | Optional - narrows the search to an OU (e.g. `OU=Employees,DC=yourcompany,DC=com`) instead of the whole Base DN. Leave blank to search from the Base DN. |
| Service account (bind DN or UPN) | A dedicated read-only service account, not a personal admin account - e.g. `svc-trafo360@yourcompany.com` (UPN) or `CN=svc-trafo360,OU=Service Accounts,DC=yourcompany,DC=com` (DN) |
| Service account password | Encrypted at rest (`SECRETS_ENCRYPTION_KEY`) - never stored or logged in plaintext |
| User search filter | e.g. `(sAMAccountName={{username}})` - `{{username}}` is substituted with whatever the user typed on the login form |
| Group search base | Optional - only needed if you plan to use AD group → role mapping (`AdGroup`/`AdGroupRoleMapping`) rather than assigning roles per-user |
| Domain | Display-only, not used for auth logic |

## First-time setup

1. Log in as the bootstrap local admin (`BOOTSTRAP_ADMIN_USERNAME`/`PASSWORD` from `.env`).
2. Administration → AD/LDAP → fill in the fields above → **Save**.
3. **Test Connection** - this does a real bind with the service account and reports success/failure
   without touching any user data. Fix any error here before proceeding (common ones: wrong port for
   the protocol, firewall blocking the DC, wrong bind DN format for your AD flavor).
4. **Sync Now** - walks the configured search base, upserts `User`/`AdGroup` rows, and logs the run
   to the audit log. **This is manual/admin-triggered only today** - `POST /api/ldap/sync-now`
   requires a real admin session (`ad.manage` permission), not a service token, so it can't simply be
   put on a cron job the way `scripts/backup.sh` can. An admin needs to click Sync Now periodically
   (or this endpoint needs the same internal-token treatment
   `POST /api/type-test-certificates/check-expiring` already has, to make it cron-automatable - not
   done yet, see `docs/BUILD_PROGRESS.md`'s Known Gaps).
5. Toggle **AD/LDAP sign-in enabled** once you've confirmed a real AD user can log in.
6. Assign roles/departments to the newly-synced users (Administration → Users) - sync creates the
   user records but doesn't guess which role they should have, unless you've set up
   `AdGroupRoleMapping` for automatic group-based assignment.

## Login behavior once enabled

`AuthService.validateAdCredentials` binds **as the user** with the password they typed (never stores
it) against the configured DN pattern. This is in addition to, not instead of, the local bootstrap
admin account - that account keeps working (flagged in the UI as "Local account - not AD-backed", its
use audit-logged) so you're never locked out if AD becomes unreachable. Disabling it is a manual
choice from Administration → Users once you're confident AD is solid - the app never disables it for
you automatically, since automatic disablement risks locking everyone out simultaneously.

## Known limitation

This has been built and tested against the `ldapjs` library's documented behavior and its failure
paths (connection refused, bad credentials, malformed filter), but **never against a real Active
Directory server** - no AD instance was available in the environment this was built in. Directory-
specific quirks (attribute casing, `memberOf` referral chasing, nested group membership) are unknowns
until tested against a real DC. Test Connection + a real test-user login before rolling this out
beyond a pilot group.
