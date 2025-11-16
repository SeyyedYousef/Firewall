# Firewall Module Design Draft

This note sketches the missing pieces required to finish the DB-backed firewall system.

## Entities
- **FirewallRule**
  - scope: `group` \| `global`
  - name/description, enabled flag, priority ordering
  - `conditions[]`: typed JSON DSL (text, regex, keyword, media, time-range, role, etc.)
  - `actions[]`: ordered actions (delete, warn, mute, kick/ban, log)
  - `escalation`: thresholds → additional actions after N violations within window
  - backwards-compat legacy fields (`type`, `pattern`, `action`) kept for migration
- **RuleAudit**
  - references rule + offending user
  - stores payload (message snippet, media info, etc.)
- **PanelBan**
  - now persisted; needs integration with owner UI and enforcement middleware

## Persistence Flow
1. When owner edits rules in UI, call `server/db/firewallRepository.ts` to create/update/delete records.
2. Bot must load rules at runtime (e.g. cache per group) so message handlers can evaluate them.
3. After enforcement, call `appendRuleAudit` with outcome to keep history.
4. REST endpoint `/api/firewall/audits/:chatId` (GET) exposes the latest audits (up to 200) for dashboards.

## Runtime Enforcement
- Processing pipeline loads rule configs (with caching + TTL) and evaluates ordered conditions.
- Evaluation helpers:
  - text/keyword/regex matchers with case sensitivity toggles
  - media type filters & link/domain guards
  - context-aware checks (message length, user role, time ranges)
- Actions translate to Telegraf API calls (`deleteMessage`, `restrictChatMember`, `banChatMember`, warnings/logs) with escalation handling.

## Observability
- Extend `server/utils/logger.ts` usage in the new middleware.
- Consider metrics: rules triggered, actions taken, failures.

## TODO Summary
- Enhance owner panel and mini app UX (validation helpers, pagination, templates) for the DSL-based rule editor.
- Extend condition/action catalog (e.g., attachment hashes, per-role throttles, external reputation checks).
- Build UI for rule history and escalation insights (using RuleAudit + ModerationAction).
- Add integration tests + fixtures for common rule types and escalations.
