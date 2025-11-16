# Database Integration Notes

## Pending Entities
- **Firewall rules & audits**: CRUD helpers now exist in server/db/firewallRepository.ts, but the bot/mini-app must call them when rules change or events occur.
- **Moderation & membership logs**: new tables (`ModerationAction`, `MembershipEvent`) capture group enforcement history. Run migrations and define retention/backfill procedures.
- **Ban list operations**: panel_bans table was added; ensure owner panel flows rely on the updated state functions.
- **Reports**: schema ready (Report model) but no repository yet.

## Migration Workflow
1. Update prisma/schema.prisma.
2. Run `npm run migrate:dev -- --name <migration_name>` after starting Postgres (`docker-compose up -d postgres`).
3. Commit generated files under prisma/migrations/.
4. Deploy with `npm run migrate:deploy` in staging/production.

## Testing Checklist
- Run `npm run lint` and `npx tsc --noEmit`.
- Spin up Postgres and run migrations.
- Exercise panel admin/ban/promo flows and confirm table contents via `npm run prisma:studio`.

## TODO
- Wire firewall rule management UI/bot commands to `firewallRepository`.
- Finalise moderation log readers (API + dashboards) and design archival strategy.
- Implement report generation & persistence.
- Add integration tests (e.g., via Vitest + Prisma test DB).
- Configure backup/monitoring for production database.

