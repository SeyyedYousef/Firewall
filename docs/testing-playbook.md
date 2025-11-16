
# Testing Playbook

This guide documents the manual validation steps that must be executed before shipping a production release of Firewall Bot.

## 1. Automated Pre-checks

1. `npm run release:check` – executes lint, unit tests, production build, Prisma migration status, and Stars reconciliation.
2. `npm run worker:deploy -- --dry-run` (or equivalent) – ensure the latest frontend bundle builds without errors.

## 2. Sandbox Verification

1. Provision a sandbox Telegram supergroup and invite the bot (without admin rights). Confirm the onboarding reminder is posted.
2. Promote the bot to admin; verify the full onboarding sequence and owner panel access (`/panel` followed by **Management Panel**).
3. Run a sample firewall rule:
   - Create a rule that deletes messages containing a keyword.
   - Post the keyword and confirm the message is removed and an audit entry exists (`owner panel → View Total Statistics`).
4. Execute owner credit adjustments:
   - Increase and decrease credit for the sandbox group.
   - Confirm the moderation audit log (Database → `moderationAction` table) shows `owner_credit_adjustment`.
5. Trigger a Stars payment in the Telegram sandbox. After completion, run `npm run stars:reconcile` and confirm no mismatches are reported.

## 3. Webhook & API Smoke Tests

1. `GET https://<API_DOMAIN>/api/health` should return `200` with `{ status: "ok" }`.
2. `GET https://<API_DOMAIN>/api/v1/dashboard` with valid init data should return group summaries.
3. `POST https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo` must show the expected URL and secret token.

## 4. Logging & Monitoring

1. Inspect platform logs for warnings or errors during the sandbox run.
2. Confirm alerts are configured for:
   - Prisma retry exhaustion (`prisma operation retry` → severity warn).
   - Processing queue backlog (`processing queue backlog` log line).
   - Rate-limit penalties (`adaptive throttle applied after Telegram rate limit`).

## 5. Sign-off

1. Record the release date, commands executed, and sandbox group links in `docs/test-report.md`.
2. Attach screenshots or log excerpts where applicable.
3. Obtain approval from the release owner before tagging the version.
