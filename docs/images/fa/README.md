# Persian panel screenshots — Bamdad Alert 1.0.1

Captured from the real UI with synthetic fixtures (example.com, example software and API dates), not a production monitor. No real credentials, recipient addresses or monitored API tokens are shown. Each panel has a light image and a matching `-dark.png` image. Vazir is loaded from the local bundled font files.

```bash
SSLERT_DOC_SCREENSHOTS=1 npx playwright test --config packages/web/playwright.i18n.config.ts --grep "documentation screenshots"
```

Use `SSLERT_BROWSER_CHANNEL=msedge` for installed Edge. Review images before committing. A separate local smoke run uses the real API/database; these fixtures make screenshots deterministic and do not prove external email or Telegram delivery.
