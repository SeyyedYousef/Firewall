# Firewall Bot – v1.0.0 (LTS) Release Notes

## Highlights

- **Runtime hardening**: state validation, Prisma retry with transactional safeguards, and adaptive rate limiting for Telegram actions.
- **Billing reliability**: automated telemetry-backed Stars metadata, owner reconciliation tooling, and audited credit adjustments.
- **Operational tooling**: release checklist script, webhook secret enforcement, and a deployment playbook.

## Breaking Changes

- Webhook deployments now require `BOT_WEBHOOK_SECRET`. The server fails fast if the secret is missing while `NODE_ENV=production`.
- The owner credit menu logs every change to the moderation history table; adjust downstream analytics if you filter by custom actions.

## Upgrade Path

1. Pull the latest code and install dependencies (`npm install`).
2. Copy the updated `.env.example` and ensure the new variables are provided.
3. Apply database migrations if any were added since your previous version (`npm run migrate:deploy`).
4. Execute `npm run release:check` to validate linting, tests, build, migrations, and billing reconciliation.
5. Deploy the backend + mini-app, register webhook with the secret, and smoke test the bot in a staging group.

## Known Issues

- TypeScript still reports legacy type warnings for certain Telegraf/Prisma definitions; these are tracked and slated for cleanup in the next minor release.
- Stars reconciliation depends on the in-memory bot state; if the bot restarts without state restoration, the script may flag transient mismatches until the cache is repopulated.

## Support

For upgrades and incident response, review `docs/deployment-guide.md` and `scripts/release-checklist.ts`. Open GitHub issues or reach the maintainer on the support channel if you encounter failures not covered above.
