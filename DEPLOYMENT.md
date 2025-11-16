# 🚀 راهنمای دیپلوی در Cloudflare Workers

این راهنما مراحل دیپلوی کامل پروژه Telegram Firewall Bot را در محیط production با استفاده از Cloudflare Workers توضیح می‌دهد.

## پیش‌نیازها

1. ✅ یک حساب Cloudflare (رایگان کافی است)
2. ✅ یک سرور برای اجرای Backend (VPS، Heroku، Railway، و غیره)
3. ✅ یک دیتابیس PostgreSQL (می‌توانید از Neon، Supabase، یا Railway استفاده کنید)
4. ✅ BOT_TOKEN از [@BotFather](https://t.me/BotFather)
5. ✅ BOT_OWNER_ID (شناسه عددی تلگرام خودتان)

## مرحله ۱: راه‌اندازی دیتابیس PostgreSQL

### گزینه A: استفاده از Neon (رایگان، توصیه می‌شود)

1. به [neon.tech](https://neon.tech) بروید
2. یک پروژه جدید ایجاد کنید
3. Connection String را کپی کنید (مثلاً: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb`)

### گزینه B: استفاده از Supabase

1. به [supabase.com](https://supabase.com) بروید
2. پروژه جدید بسازید
3. از بخش Settings > Database، Connection String را دریافت کنید

### گزینه C: استفاده از Railway

1. به [railway.app](https://railway.app) بروید
2. یک PostgreSQL service اضافه کنید
3. DATABASE_URL را از متغیرها کپی کنید

## مرحله ۲: راه‌اندازی Backend Server

Backend شما باید روی یک سرور در دسترس عمومی اجرا شود.

### گزینه A: استفاده از Railway (توصیه می‌شود)

```bash
# 1. نصب Railway CLI
npm install -g @railway/cli

# 2. لاگین
railway login

# 3. ایجاد پروژه جدید
railway init

# 4. متغیرهای محیطی را تنظیم کنید
railway variables set BOT_TOKEN="your_bot_token"
railway variables set BOT_OWNER_ID="your_telegram_id"
railway variables set DATABASE_URL="your_postgres_url"
railway variables set BOT_START_MODE="webhook"
railway variables set WEBHOOK_DOMAIN="https://your-railway-url.up.railway.app"

# 5. دیپلوی
railway up
```

### گزینه B: استفاده از Heroku

```bash
# 1. ایجاد اپ
heroku create your-firewall-bot

# 2. تنظیم متغیرها
heroku config:set BOT_TOKEN="your_bot_token"
heroku config:set BOT_OWNER_ID="your_telegram_id"
heroku config:set DATABASE_URL="your_postgres_url"
heroku config:set BOT_START_MODE="webhook"
heroku config:set WEBHOOK_DOMAIN="https://your-app.herokuapp.com"

# 3. دیپلوی
git push heroku main
```

### گزینه C: استفاده از VPS خودتان

```bash
# 1. کلون کردن پروژه
git clone your-repo-url
cd your-project

# 2. نصب dependencies
npm install

# 3. تنظیم .env
cp .env.example .env
# ویرایش .env و پر کردن مقادیر

# 4. اجرای migrations
npm run migrate:deploy

# 5. اجرای bot با PM2
npm install -g pm2
pm2 start npm --name "firewall-bot" -- run bot:webhook
pm2 save
pm2 startup
```

## مرحله ۳: دیپلوی Mini App در Cloudflare Workers

```bash
# 1. نصب Wrangler CLI
npm install -g wrangler

# 2. لاگین به Cloudflare
wrangler login

# 3. ویرایش wrangler.toml
# در خط 10، BACKEND_URL را به آدرس backend خود تغییر دهید:
# BACKEND_URL = "https://your-backend-server.com"

# 4. ویرایش .env
# خطوط زیر را به درستی تنظیم کنید:
# MINI_APP_URL=https://your-worker-name.workers.dev
# VITE_API_BASE_URL=https://your-worker-name.workers.dev/api/v1

# 5. Build کردن Mini App
npm run build

# 6. دیپلوی Worker
npm run worker:deploy
```

پس از دیپلوی موفق، URL Worker شما به این شکل خواهد بود:
```
https://tg-firewall-worker.your-account.workers.dev
```

## مرحله ۴: تنظیمات نهایی

### 1. به‌روزرسانی MINI_APP_URL در Backend

در backend خود، فایل `.env` را ویرایش کنید:

```env
MINI_APP_URL=https://tg-firewall-worker.your-account.workers.dev
WEBHOOK_DOMAIN=https://your-backend-server.com
```

Backend را restart کنید.

### 2. تنظیم Menu Button در BotFather

```
/mybots
انتخاب ربات خود
Bot Settings > Menu Button > Edit Menu Button URL
URL: https://tg-firewall-worker.your-account.workers.dev
```

### 3. تست کامل

1. پیام `/start` به ربات خود بفرستید
2. دکمه "Management Panel" را بزنید
3. Mini App باید باز شود

## 🔧 تنظیمات پیشرفته

### افزودن Custom Domain در Cloudflare Worker

```bash
# در wrangler.toml اضافه کنید:
routes = [
  { pattern = "bot.yourdomain.com", custom_domain = true }
]

# دیپلوی مجدد
npm run worker:deploy
```

### تنظیم Environment Variables در Worker

```bash
# اضافه کردن secrets
wrangler secret put BOT_WEBHOOK_SECRET
wrangler secret put DATABASE_URL
```

### راه‌اندازی با Docker

```bash
# Build image
docker build -t firewall-bot .

# Run container
docker run -d \
  --name firewall-bot \
  --env-file .env \
  -p 3000:3000 \
  firewall-bot
```

## 📊 مانیتورینگ و Logs

### Cloudflare Worker Logs

```bash
wrangler tail
```

### Backend Logs (Railway)

```bash
railway logs
```

### Backend Logs (Heroku)

```bash
heroku logs --tail
```

## 🐛 عیب‌یابی

### مشکل: Mini App باز نمی‌شود

- چک کنید MINI_APP_URL در backend صحیح است
- چک کنید Worker به درستی deploy شده: `curl https://your-worker-url/healthz`

### مشکل: API کار نمی‌کند

- چک کنید BACKEND_URL در wrangler.toml صحیح است
- چک کنید backend در دسترس است: `curl https://your-backend/healthz`

### مشکل: Webhook کار نمی‌کند

```bash
# چک کردن وضعیت webhook
curl -X GET "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

### مشکل: Database Connection

- چک کنید DATABASE_URL صحیح است
- مطمئن شوید migrations اجرا شده: `npm run migrate:deploy`

## 📞 پشتیبانی

در صورت بروز مشکل:
1. Logs را بررسی کنید
2. مطمئن شوید تمام environment variables صحیح هستند
3. /healthz endpoint را تست کنید

## ✅ Checklist نهایی

- [ ] PostgreSQL راه‌اندازی شد
- [ ] Migrations اجرا شدند
- [ ] Backend deploy شد و در دسترس است
- [ ] Worker deploy شد
- [ ] MINI_APP_URL در backend تنظیم شد
- [ ] BACKEND_URL در wrangler.toml تنظیم شد
- [ ] Menu Button در BotFather تنظیم شد
- [ ] ربات تست شد و کار می‌کند

---

🎉 تبریک! ربات شما آماده استفاده است!
