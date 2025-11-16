# Mission & Store Rollout Notes

## Mission System
- A single UTC-aligned reset job keeps daily, weekly, and monthly windows in sync. The bot schedules the next reset on startup (`bot/jobs/missionReset.ts`); no manual cron wiring is required.
- Only actionable missions (daily spin + channel verification) expose a "Complete" button. All other missions are auto-tracked once the backend observes the event, and the Mini App labels them as such to reduce confusion.
- The daily spin endpoint now returns the concrete XP reward so the UI can render `+N XP` in the completion toast, matching the spec requirement for transparent rewards.
- When verification fails (for example, the user never joined the channel), the Mini App surfaces the precise backend error so operators know what to fix.

## Store Credit Codes
- Credit rewards now issue hashed one-time codes stored in `CreditRedemptionCode`. Users receive the plaintext via bot DM and can forward it to admins as needed.
- Codes may only be redeemed by the original purchaser; the bot validates ownership before applying credit to a group and logs every attempt.
- Messages in groups are scanned for credit codes whenever Firewall is present. On success, the bot replies in chat and silently logs the redemption for support.

## Badges
- Badge purchases immediately populate `UserBadge`, and profile responses expose the current badge list so the Mini App can show the latest flair without waiting for cache refreshes.
- A new panel-admin endpoint `GET /api/stars/rewards/badges` lists recent badge purchases for auditing/support dashboards so staff can confirm fulfillment.

## Operational Checklist
1. Deploy backend + bot so the new credit code tables/migrations exist.
2. Restart the bot to register the mission reset scheduler.
3. Verify the bot owner can redeem a credit code in a test group and that the mission auto-completes with the disclosed reward.
4. Confirm badge redemptions render in the staff dashboard using the badge endpoint and Mini App store widgets.
