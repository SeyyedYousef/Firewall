# Stars Payments Integration

This document summarises the production flow for Telegram Stars payments and how to test the implementation locally.

## Configuration Checklist

| Variable | Purpose |
| --- | --- |
| BOT_USERNAME | Used to generate fallback deep links for invoices. |
| MINI_APP_URL | Required for opening the dashboard from Telegram. |
| STARS_AUTO_CAPTURE | Set to false in production to require official Telegram payment confirmation. Use true for local mocks. |
| STARS_PAYMENT_URL | Optional custom invoice endpoint. Leave empty to rely on bot deep links. |
| STARS_CURRENCY | Defaults to XTR (Telegram Stars) but can be overridden if Telegram adds additional denominations. |

When STARS_AUTO_CAPTURE=false, every purchase or gift will stay in the pending state until Telegram confirms the payment via successful_payment. The server automatically issues invoices through the Bot API and the mini app opens them with Telegram.WebApp.openInvoice.

## Local Testing

1. Copy .env.example to .env and keep STARS_AUTO_CAPTURE=true to bypass invoices.
2. Run npm install to install the new dependencies (notably vitest).
3. Start the dev stack: npm run dev for the Mini App UI and npm run bot for the Telegram bot.
4. Execute the integration tests with npm run test. The Vitest suite covers:
   - Pending invoice creation when auto capture is disabled.
   - Finalisation logic that recharges the internal wallet before applying a plan.
   - Refund issuance and wallet adjustments.

The tests mock the Telegram Bot API and the Prisma layer so they can run without network or database access.

## Production Deployment

1. Set STARS_AUTO_CAPTURE=false so purchases require a real Telegram invoice.
2. Configure WEBHOOK_DOMAIN and BOT_WEBHOOK_SECRET before starting npm run bot:webhook.
3. Ensure the bot is added to the @BotFather payments test sandbox if you are still validating the flow.
4. After deployment, trigger a real purchase from the Mini App. The UI should display live invoice status updates, and the /stars/wallet API will list the resulting transaction with the proper status.
5. Refunds can be issued from the Mini App wallet section; the backend calls refundStarsPayment and records the refund in the database.

## Monitoring Tips

- /api/v1/stars/wallet now returns balance, aggregated totals, and the latest transaction history.
- Server logs include [stars] prefixed entries for invoice creation, payment success, and refunds to help trace the flow end to end.
