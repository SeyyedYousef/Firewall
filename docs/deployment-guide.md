# Deployment Guide

This checklist describes the minimum steps required to launch the Firewall Bot backend and mini‑app in production.

## 1. Prepare Environment Variables

1. Copy `.env.example` to `.env` and populate **every** placeholder.
2. Ensure the following variables are present before starting the backend:
   - `BOT_TOKEN`, `BOT_OWNER_ID`, `BOT_USERNAME`
   - `MINI_APP_URL`, `CHANNEL_URL`, `ADD_TO_GROUP_URL`
   - `DATABASE_URL`
   - `BOT_START_MODE=webhook`
   - `WEBHOOK_DOMAIN`, `WEBHOOK_PATH`, `BOT_WEBHOOK_SECRET`
3. Generate a cryptographically strong `BOT_WEBHOOK_SECRET` (`openssl rand -hex 32` is a good default).
4. Configure the mini‑app frontend with `VITE_API_BASE_URL` pointing to the public HTTPS endpoint of the backend.

## 2. Database & Prisma

1. Provision PostgreSQL and make sure the connection string matches `DATABASE_URL`.
2. Run migrations: `npm run migrate:deploy`.
3. (Optional) `npx prisma migrate status` should report **Applied** for every migration.

## 3. Webhook Registration

1. Deploy the backend behind HTTPS (e.g., Render, Railway, Fly.io).
2. Verify health: `GET https://<domain>/api/health`.
3. Register the webhook with the secret:
   ```bash
   curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=https://${WEBHOOK_DOMAIN}${WEBHOOK_PATH}" \
     --data-urlencode "secret_token=${BOT_WEBHOOK_SECRET}"
   ```
4. Confirm webhook status:
   ```bash
   curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
   ```
   The response should echo the same URL and `secret_token`.

## 4. Build & Release

1. Run the automated release checklist:
   ```bash
   npm run release:check
   ```
2. Inspect reconciliation output (`npm run stars:reconcile`) and resolve any mismatches before go‑live.
3. Tag the release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

## 5. Production Smoke Tests

1. Add the bot to a staging group and confirm:
   - Onboarding message appears.
   - Credit adjustments are reflected in `/panel`.
2. Trigger a Stars payment in Telegram sandbox and check dashboards & reconciliation.
3. Hit `/api/health`, `/api/v1/dashboard`, `/api/v1/firewall` to ensure 200 responses.

## 6. Monitoring & Rollback

1. Enable structured logging in your host platform and set alerting for `error` level events.
2. Schedule `npm run stars:reconcile` (cron/CI) to watch for billing inconsistencies.
3. Keep the previous deployment image available for fast rollback.
