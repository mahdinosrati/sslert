# Persian panel screenshots

Captured from the running UI with deterministic, mocked API data (example.com), not a production monitor. No real credentials or account data are used.

From the repository root, after installing dependencies and a Playwright browser:

```bash
SSLERT_DOC_SCREENSHOTS=1 npm run test:i18n --workspace=@sslert/web -- --grep "capture Persian documentation"
```

The capture test writes these images to the repository's `docs/images/fa` directory. Images are reviewed before committing. Use `SSLERT_BROWSER_CHANNEL=msedge` to select an installed Microsoft Edge browser instead of Playwright Chromium.
