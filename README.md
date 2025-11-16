# Firewall Telegram Bot & Mini App

A complete moderation suite for Telegram supergroups powered by a Telegraf bot, an Express/Prisma backend, and a Telegram Mini App dashboard. Firewall keeps communities safe with automation, analytics, and configurable workflows that operators can manage visually.

---

## Features at a Glance
- **Firewall engine** with rule-based actions (delete, warn, restrict, escalate).
- **Mini App dashboard** for Stars balance, analytics, giveaways, missions, and promo slides.
- **Owner panel** inside Telegram for credit adjustments, broadcasts, firewall rules, and onboarding helpers.
- **Group settings** endpoints (general, bans, limits, silence windows, mandatory membership, custom texts) stored as JSON.
- **Telegram Stars integration** with purchase, gifting, and refund flows.
- **Express API** secured with Telegram WebApp init data and rate limiting.
- **Cloudflare Worker** deployment serving the React app and proxying API/webhook traffic.

---

## Quick Start
### Prerequisites
- Node.js 20+ and npm (or bun)
- PostgreSQL 14+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Cloudflare account if you plan to deploy the worker

### Installation
```bash
git clone <repo-url>
cd Firewall
npm install
```

### Configure Environment
```bash
cp .env.example .env
# Fill BOT_TOKEN, BOT_OWNER_ID, DATABASE_URL, MINI_APP_URL, etc.
```

### Database
```bash
npx prisma generate
npm run migrate:deploy
```

### Development
```bash
# React Mini App + API proxy
npm run dev

# Bot polling mode (in another terminal)
npm run bot
```

### Production Build & Deploy
```bash
npm run build          # Mini App bundle
npm run worker:deploy  # Cloudflare Worker (static + proxy)
npm run bot:webhook    # Start bot/webhook server (ensure WEBHOOK_DOMAIN)
```

---

## Configuration Essentials
| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token |
| `BOT_OWNER_ID` | Telegram ID allowed to open the owner panel |
| `MINI_APP_URL` | HTTPS URL of the Mini App (used in buttons) |
| `ADD_TO_GROUP_URL` | Optional direct invite link (falls back to `BOT_USERNAME`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `WEBHOOK_DOMAIN` | Public HTTPS origin that Telegram can reach |
| `VITE_API_BASE_URL` | Frontend base URL for API calls (Worker proxy in production) |
| `CHANNEL_URL` | Optional URL for the channel button |
| `PROCESSING_*` | Queue settings for moderation pipeline |

See `.env.example` for the full list.

---

## Project Structure
- `bot/` – Telegraf bot, owner panel, firewall wiring.
- `server/` – Express routes, services, Prisma repositories.
- `src/` – React Mini App (dashboard, settings, giveaways, missions).
- `shared/` – Shared TypeScript contracts across backend/frontend.
- `openspec/` – OpenSpec project, specs, and active proposals.
- `prisma/` – Schema and migrations.
- `worker/` – Cloudflare Worker entry and configuration.

---

## Placeholders & Custom Text
- The bot replaces `{name}` / `{user}` with the user's display name.
- `{group}` resolves to the current chat title where available.
- Mandatory membership texts may use `{number}` (required invites) and `{added}` (current progress).
- Maintain these tokens when editing `bot/content.json` or dashboard custom texts so automations remain informative.

---

## Deployment Notes
See [docs/deployment-guide.md](docs/deployment-guide.md) for a complete checklist and [scripts/release-checklist.ts](scripts/release-checklist.ts) for the automated verification steps.
1. Run migrations before switching the bot to webhook mode.
2. Ensure `WEBHOOK_DOMAIN` points to a TLS endpoint that proxies `/telegram/webhook` to your server.
3. Update `VITE_API_BASE_URL` after publishing the Worker so the Mini App calls the proxied API.
4. Use `scripts/backup-db.ps1` / `scripts/backup-db.sh` before major releases.
5. After deployment, archive successful OpenSpec changes with `openspec archive <id> --yes`.

---

## فارسی – خلاصه
این پروژه یک مجموعه کامل برای مدیریت و امنیت گروه‌های تلگرام است. ربات با استفاده از فایروال، قوانین خودکار، و داشبورد مینی‌اپ، امکان مدیریت تنظیمات، پیام‌های خوشامد، محدودیت‌ها و متون سفارشی را در اختیار ادمین‌ها قرار می‌دهد. برای راه‌اندازی:
1. مخزن را کلون کنید و وابستگی‌ها را نصب نمایید.
2. فایل `.env` را بر اساس نمونه پر کنید (توکن ربات، آدرس پایگاه‌داده، لینک مینی‌اپ و ...).
3. `npm run migrate:deploy` را اجرا کنید و سپس `npm run bot` یا `npm run bot:webhook` را بالا بیاورید.
4. برای انتشار مینی‌اپ از Cloudflare Worker و دستور `npm run worker:deploy` استفاده کنید.

---

## Contributing
1. بررسی `openspec/project.md` و Specs فعال:  
   ```bash
   openspec list --specs
   ```
2. برای پیشنهاد تغییر جدید: `openspec change create <id>`، فایل‌های proposal/tasks/spec را تکمیل کنید، و سپس `openspec validate <id> --strict` را اجرا کنید.
3. Pull Request ها باید lint (`npm run lint`) و build (`npm run build`) را پاس کنند.

---

## License
[MIT](LICENSE)
