# Bamdad Alert API 1.0.1

Base path `/api`; JSON requests. Read the generated `/api/openapi.json` or `/api/docs` for existing SSL endpoints. Protected routes accept either the `sslert_session` cookie or a user-owned bearer token. All session writes and login require `X-SSLert-Request: 1`. Send credentials only to the same origin.

| Method/path | Purpose |
| --- | --- |
| POST /auth/login | `{username,password}`; sets 12-hour HttpOnly cookie and returns public user |
| GET /auth/me | Current account and capabilities |
| POST /auth/password | `{currentPassword,password}`; minimum 12 characters, revokes old credentials |
| POST /auth/logout | Revokes current session |
| GET, POST /users | Administrator list/create; username, password, role admin/user, canCreate/canEdit/canTest, domainIds, resourceIds |
| PATCH /users/:id | Administrator role/capabilities/assignments/enabled/password; revokes access |
| GET, POST /resources | List assigned/create; kind license/api, title, provider, owner, notes, expiresAt YYYY-MM-DD or null for perpetual license, enabled |
| PUT, DELETE /resources/:id | Replace editable fields / administrator deletion |
| GET, POST /notifications/connections | Permitted list / administrator creation; name, channel, enabled, shared, config |
| PUT, DELETE /notifications/connections/:id | Administrator replace/delete |
| POST /notifications/connections/:id/test | Test without expiry; 30-second per-connection cooldown |
| GET, PUT /notifications/policies/:key | key global, domain:ID, resource:ID; mode inherit/custom/disabled, connectionIds, thresholds, repeatHours |
| GET /notifications/history | Recent deliveries scoped to assigned items; administrator sees all |
| GET /settings | Requested port and manual server command |
| PUT /settings/port | Administrator `{port:1024..65535}`; does not change running host port |

Users cannot read connection secrets or modify global/default connection definitions. Test requires canTest; create requires canCreate; item/policy edits require canEdit. Assignment is checked independently of capability. DELETE, accounts, settings and audit log require administrator.

`config.language` is en/fa. Email: to/from; Telegram: botToken/chatId; webhook: url/optional secret; Slack: url; ntfy: topic/optional server. Connection config is validated and URL-bearing transports retain SSRF checks. Full configs are returned only to administrators.

Test statuses: sent, logged, failed (502), deduped (429). Logged means no actual email was delivered because the server has no Resend key. Provider error text is not exposed. Real deliveries and test deliveries have separate deduplication windows.

Legacy domain channel write endpoints return 410 after central migration; use connections and policies. Monitored API records contain dates, not bearer tokens.
