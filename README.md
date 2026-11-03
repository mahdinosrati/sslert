# Bamdad Alert 1.0.8


Self-hosted monitoring for SSL certificates, domain registrations, software licenses and API expiry dates. Built for the Bamdad Information Technology Group.

[راهنمای فارسی و نصب Ubuntu 24.04](README.fa.md) · [Release notes](docs/releases/1.0.8.md) · [API guide](docs/API-1.0.1.md) · [AGPL-3.0](LICENSE)

English is the default. Persian includes RTL layout and bundled Vazir fonts. Choose light, dark or system appearance.

## Quick start

Install Docker Engine and Compose v2 using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), then:

```bash
git clone --branch v1.0.8 https://github.com/mahdinosrati/sslert.git
cd sslert
cp .env.example .env
chmod 600 .env
sed -i 's/^WEB_PORT=.*/WEB_PORT=80/' .env
sudo docker compose up -d --build
sudo docker compose ps
```

Open `http://SERVER_IP`. Initial credentials are **admin / admin**. Changing the password to at least 12 characters is mandatory before accessing the panel. The initial account is created once and never reset on restart. Use HTTPS for public deployments and set `SESSION_COOKIE_SECURE=1` behind your HTTPS proxy. Keep it `0` for local HTTP.

The repository slug, npm workspace names and `sslert-data` volume remain unchanged for upgrade compatibility. The application display name is **Bamdad Alert**.

## Manual internal domains and organizational SSL

Use **Manual expiry records → Add item** and select Manual domain or Private SSL certificate. Enter hostname, title, issuer/registrar and expiry. Certificates also support valid-from date and serial number. These records do not connect to the target or validate certificate chains; notifications use the entered dates. Existing account assignments and global/custom alert policies also apply. No certificate private key is stored.

Login now has a Show password checkbox and centered branding. The browser tab uses the application shield logo; Persian branding is «هشدار بامداد». About offers accessible icon links for developer email and Telegram.

## Monitor items

- **Domains:** add a hostname without a URL scheme/path and port 443 (8443 also supported). Certificate checks use TLS; registration dates use RDAP/WHOIS. Private targets are blocked by default. Use Check Now for a manual check.
- **Licenses:** record a title, provider, responsible person, notes and expiry date, or mark the license perpetual.
- **API expiry:** record the expiry date manually. No API token secret is collected, stored or validated. No provider quota/revocation checks are performed.
- Manual expiry dates are Gregorian dates valid through the end of that UTC day. Disabled/perpetual records do not produce expiry alerts.

## Notifications

Define reusable connections under Notifications: email (SMTP or Resend), Telegram, webhook, Slack or ntfy. Choose an independent English/Persian message language for each connection. Use SMTP settings in the panel, or Resend with `RESEND_API_KEY` and a verified sender. With Resend and no key, email is **logged only**, never reported as sent.

Send Test sends an explicitly labeled test without waiting for an expiry. Tests are throttled to one per connection per 30 seconds and do not consume real expiry deduplication windows. No actual email or Telegram delivery is claimed until the configured provider reports success.

Global defaults use one-shot milestones at `30,20,10,7,6,5,4,3,2,1,0` calendar days (UTC). Only the latest missed stage is sent. Day zero is the final alert; a service that resumes after expiry sends that final stage once, never daily thereafter. A renewed expiry date starts a new cycle. Durable per-record/source/channel/destination/expiry claims survive history retention. Failed recipients retry after 15 minutes at the next monitoring run. Each record can inherit defaults, replace them with a custom policy, or disable notifications. The legacy hourly-repeat mode remains available.

Connections marked available to users, global connections, and connections already assigned to their items may be selected by users. Connection credentials are visible/editable only to administrators. Recent delivery results appear in Notifications; history is retained for 365 days by default.

`CHECK_INTERVAL=60` runs checks at the start of every hour. License/API checks run in the same scheduler tick. The existing cron mapper supports minute steps below 60 and whole-hour intervals below 24 hours; other values such as 90 or 1440 fall back to hourly.

## Per-user recipients and SMS drafts

Administrators edit each user's email, mobile number, Telegram chat ID and receiving channels in Users & access. Select user/connection pairs in a record's custom policy, or in global defaults. The expandable user subscription section offers the same editor per record. Receiving alerts does not grant record access; LDAP viewers are not automatically subscribed. Disabled users receive no user-targeted messages. Static connection destinations remain independent: uncheck those connections when only selected users should receive alerts.

Destinations are deduplicated per channel. Emails, including tests, are sent individually with individual history rows; recipient addresses are visible only to administrators. SMTP acceptance is not proof of inbox delivery.

SMS drafts accept a gateway URL, pattern ID, ordered variables (title,days,source,expiry), optional encrypted API token and test number. The server forces drafts disabled and refuses test requests. Completing the adapter requires the template, variable order, authentication contract, success/error response and test recipient. No SMS delivery is claimed in 1.0.8.

## Accounts and access

Administrators create accounts, assign domains/licenses/API records, and independently grant users permission to create records, edit assigned records and send test notifications. Local users view assigned records; LDAP users view all current and future records. Records they create are automatically assigned to them. Deletion, account management, server settings, connection definitions/secrets and the full audit log are administrator-only. The last enabled administrator cannot be demoted or disabled.

Passwords use salted scrypt. Session cookies are HttpOnly and SameSite=Strict, expire eight hours after login, and mutating requests require `X-SSLert-Request: 1`. First login and password resets require a new password. Changing an account or its password revokes its sessions and API tokens. Login attempts are rate-limited. SMS configuration is a disabled draft; sending awaits template, gateway response and test-number verification.

## Configuration and port changes

| Variable | Purpose |
| --- | --- |
| `WEB_PORT` | Published web port, default 5173 |
| `CHECK_INTERVAL` | Scheduler setting, default 60 |
| `RESEND_API_KEY` | Email delivery key |
| `ALERT_EMAIL_FROM` | Default verified email sender |
| `ALERT_EMAIL_TO` | Imported as a central connection on first migration only |
| `SESSION_COOKIE_SECURE` | Set 1 for HTTPS, 0 for local HTTP |

Server Settings saves the requested port and displays a command. Run it manually on the Docker host from the repository directory:

```bash
sudo bash scripts/set-web-port.sh 80
```

The internal deployment uses HTTP port 80 at `http://panel.bkls.org`, with no explicit port or TLS certificate. Set `WEB_PORT=80` and `SESSION_COOKIE_SECURE=0`. Supported host ports are 1–65535; the application itself stays behind the nginx proxy.

Saving in the UI does not change the active port. The script checks availability, backs up `.env`, recreates only `web`, and restores the previous configuration if application fails. Adjust firewall/proxy rules and reconnect to the new port. Protect `.env` backups, which contain secrets. The application has no Docker socket or host shell access.

## Upgrade and rollback

Back up the database and `.env` before upgrading. See the [complete Persian upgrade procedure](README.fa.md#۹-ارتقا-از-نسخههای-قبلی) for an online SQLite snapshot command. Fetch tags, check out `v1.0.8`, then run `sudo docker compose up -d --build`. Preserve local modifications first. Never use `docker compose down -v` during upgrades.

Migrations preserve old domains, checks and channels. Existing receiver configurations become per-domain custom policies; global email fallback is imported where applicable. Subsequent connection changes belong in the central Notifications UI. Legacy `/domains/:id/channels` configuration is retired after migration.

Old ownerless bearer tokens are rejected. Sign in with admin/admin and change the initial password. Automation can create a new token bound to an enabled user who has changed their password:

```bash
sudo docker compose exec --user 10001:10001 api node /app/dist/cli/tokens.js create --label automation --user admin
```

These authentication tokens are distinct from monitored API expiry records. They inherit their owner's permissions. To roll back, stop the app, restore the pre-upgrade database and `.env`, check out the previous revision, and rebuild. Do not run old code against the migrated database.

## Screenshots

Actual UI with synthetic example data; no real secrets or real monitoring results.

| Light | Dark |
| --- | --- |
| ![Dashboard](docs/images/fa/dashboard.png) | ![Dashboard dark](docs/images/fa/dashboard-dark.png) |
| ![Resources](docs/images/fa/resources.png) | ![Resources dark](docs/images/fa/resources-dark.png) |
| ![Notifications](docs/images/fa/notifications.png) | ![Notifications dark](docs/images/fa/notifications-dark.png) |

## Development

Node.js 22 is recommended for the native SQLite dependency.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev:api
# In another terminal:
npm run dev:web
```

`AUTH_DISABLED=1` is a development-only bypass and is rejected in production. Local data uses `data/sslert.db`. Browser tests: `npx playwright test --config packages/web/playwright.i18n.config.ts`; use `SSLERT_BROWSER_CHANNEL=msedge` for installed Edge. Set `SSLERT_DOC_SCREENSHOTS=1` to refresh documentation screenshots with fixture data. Backend tests cover real database migrations, authorization and dispatch with mocked transports. Provider credentials are required for live delivery verification.

## License and upstream

AGPL-3.0; original license and upstream attribution are retained. Based on [SSLert](https://github.com/einperegrin/sslert). Bamdad additions developed by Mahdi Nosrati.

## 1.0.3: unified dashboard and organizational email

The dashboard lists automatic SSL, domain registration and all manual expiry records with status cards, search and filters. Each automatic hostname contributes two independently monitored expiry entries. User access restrictions apply to both rows and counts.

Administrators can delete accounts after typing the username. The current account and last enabled administrator cannot be deleted. Sessions/tokens are revoked; monitored records remain. Password visibility applies only to newly entered passwords.

In Notifications, choose Email → SMTP, enter host, port, TLS mode, optional authentication, sender name/address and recipient, then save and send a test. STARTTLS is required when selected (usually port 587); implicit TLS usually uses 465. Plain SMTP is an explicit option for internal relays. Certificate verification remains enabled; mount your organizational CA and configure `NODE_EXTRA_CA_CERTS` if needed. SMTP transport uses [Nodemailer](https://nodemailer.com/smtp).

Resend remains available, with a per-connection API key or the server `RESEND_API_KEY` fallback. Without a key, Resend-mode delivery is logged only. SMTP passwords and per-connection Resend keys are encrypted with AES-256-GCM and never returned by the API. Blank password edits preserve the saved value; disabling SMTP authentication removes its password. The key is generated beside the database as `notification.key` (Docker: `/app/data/notification.key`). Securely preserve it separately with database backups; the legacy backup CLI does not export it. Losing the key requires re-entering connection credentials.

History includes target/connection names, channel, time and result, with status filtering and 50-row pagination. Accepted means the delivery service accepted the message, not guaranteed inbox delivery. Users see history only for assigned targets.

## 1.0.4: action-oriented dashboard and multiple email recipients

The dashboard separates unique host counts from expiry records, shows non-overlapping 1–7 and 8–30 day cards, highlights actionable records, and offers clickable 1–7/8–30/31–60/61–90 day bars. Disabled items are excluded from future-expiry bins. The table supports search, type/status filters, sortable columns and 15-row pages, with direct resource edit/policy links. Latest checks and delivery activity retain user access restrictions.

Alert coverage reflects the effective global/custom policy and enabled connections; Resend without an API key is not counted as active delivery coverage. Coverage does not guarantee successful delivery.

Email connections accept 1–50 recipients as an address array or comma/semicolon/newline-separated text. Invalid addresses are rejected and duplicates removed. Existing single-address connections remain compatible. Save the connection, then select **Send test email** to test all saved recipients (30-second cooldown). SMTP partial rejection is recorded as `partial`, not success. Recipients are included in To and can see the other addresses. Delivery-service acceptance does not guarantee inbox placement.

New endpoint: `GET /api/notifications/coverage` returns scoped target-key → boolean coverage without connection secrets. `GET /api/notifications/history?status=partial` filters partial deliveries.

## 1.0.5: Jalali dates, contracts and LDAP

Manual records support contracts with number, counterparty, owner, start/end dates and notes. They participate in dashboard filters, permissions and notification policies. Persian forms accept Jalali dates and Persian/Arabic/ASCII digits with leap-year validation; English forms remain Gregorian. API/storage use ISO Gregorian dates.

Administrators can configure AD under Settings: DNS hostname, Base DN, read-only bind account/password, sAMAccountName or userPrincipalName, and an allowed group DN. Use LDAPS (636) or STARTTLS (389), with a trusted certificate and optional organization CA in PEM format. Nested group membership is supported; primary-group-only membership is not. Group membership permits login only; it never grants administrator privileges. Test connection and optionally user lookup before enabling. Test lookup does not verify the user's password.

LDAP is disabled by default. Local login and the last enabled local administrator are retained for recovery. AD accounts are provisioned after successful login with an ad: prefix; LDAP users initially see all current and future records without write/test permissions. Administrators grant additional permissions and roles in the panel; LDAP login/revalidation preserves those grants. User passwords are never stored; the bind password is encrypted with notification.key. Back up that key alongside the database and .env.

Directory authorization is rechecked on requests after a five-minute cache; group loss or failed revalidation revoke sessions. Saving directory configuration revokes all AD sessions. Panel-disabled accounts cannot log back in. Deploy HTTPS at the panel before using organizational credentials; LDAP TLS protects only the server-to-directory connection. Actual organization connectivity must be tested with your own AD settings.

See the [Persian setup guide and screenshots](README.fa.md) for light/dark settings and the Jalali contract form.

## Contributors

Bamdad Alert development: **[Mahdi Nosrati / MahdiNosrati](https://github.com/mahdinosrati)**, Bamdad Information Technology Group. Built on SSLert; original contributors' attribution and AGPL-3.0 licensing are preserved. GitHub's automatic Contributors list is derived from attributed commits.

### Explicit plain LDAP and administrator-only directory group

Select LDAP without encryption to use port 389 without a certificate. Bind and user passwords travel without TLS; this mode requires an explicitly trusted network and compatible AD policy. LDAPS remains the default and never silently falls back to plaintext. Single-group mode admits only the configured allowed group. New accounts have read-only access to all records, and only panel administrators can grant more permissions or an administrator role. Existing LDAP accounts are reset to viewers once during migration; existing sessions expire and users must sign in again. Local recovery administrators remain available.

## 1.0.6: panel-managed LDAP permissions and eight-hour sessions

LDAP group membership permits login only. New LDAP users can read all current and future records; administrators grant create, edit-all, test-notification permissions or administrator roles in Users & access. LDAP reauthentication preserves panel grants. Add members through the group Members tab, not an account Security ACL.

Local and LDAP sessions expire eight hours after login, without sliding renewal. The one-time upgrade resets existing LDAP accounts to viewers, revokes their API tokens and expires all existing sessions. Local administrators remain available. Later restarts preserve newly granted permissions.

SMTP setup requires the server hostname, sender, authentication credentials and recipients. Use implicit TLS on 465 or STARTTLS on the provider-supported port (commonly 587). Save the connection, select it in the global or item policy, and send a test email. Check delivery history and recipient inbox separately. Documentation screenshots use fictional data and contain no organization credentials.

![LDAP permissions, light](docs/images/fa/ldap-permissions.png)
![LDAP permissions, dark](docs/images/fa/ldap-permissions-dark.png)

## 1.0.7: failed-delivery retries and SMTP diagnostics

A failed delivery no longer consumes the successful-alert repeat window. Previously, a transient failure with a 168-hour policy could suppress the same alert for seven days. Failed attempts become eligible after 15 minutes and retry at the next monitoring run, provided the item still qualifies. There is no separate 15-minute timer: an hourly schedule normally retries at its next hourly run.

In legacy repeat mode, successful, partial and pending deliveries retain the policy repeat window; manual tests retain their 30-second cooldown. Retry attempts create separate history entries without rewriting previous failures. New SMTP failures distinguish authentication, TLS/certificate, timeout, connection, temporary rejection and message/recipient rejection without exposing raw provider responses or credentials. Historical generic failures cannot be reconstructed. Sent means accepted by the sending service, not guaranteed inbox placement.

Upgrading from 1.0.6 adds no database migration and preserves records, grants, sessions and saved connections. Back up the database, .env and notification.key before upgrading.
