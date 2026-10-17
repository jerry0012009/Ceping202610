# Changelog

## 2.14.1

- Preserve the ReportLab template and V2.14 report/scoring presentation.
- Add visible external-browser fallback, WeChat guidance, clipboard/manual-copy handling, and report-scoped links valid for 10 minutes.
- Sign links with existing AUTH_SECRET; issue only to owner/configured admin. Links allow only that report's PDF, never login or history APIs. Recheck ownership/admin binding on download.
- Carry tokens in URL fragments and POST bodies; no-store/no-referrer responses. Do not log bodies or fragments in proxies/analytics. Anyone holding a link can retrieve its report until expiry; do not forward it.
- Downloads do not consume quota or modify answers. No public PDF files or production deployment.
- Add security/UI regressions and GitHub Actions. Check the run on the published commit; this entry does not claim tests passed.
