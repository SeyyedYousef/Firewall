# راهنمای رفع مشکل "Unable to load groups" در مینی اپ

## مشکلات شناسایی شده:

### 1. **عدم ارسال Telegram Init Data**
- Frontend نیاز به ارسال Telegram init data برای authentication دارد
- **✅ رفع شده**: کد `requestApi` به‌روزرسانی شد

### 2. **API Base URL تنظیم نشده**
- Frontend نمی‌داند به کدام سرور درخواست بفرستد
- **✅ رفع شده**: URL production server اضافه شد

### 3. **مشکل CORS در سرور**
- سرور نیاز به تنظیم CORS برای دامنه مینی اپ دارد

## راه‌حل‌های اعمال شده:

### 1. **به‌روزرسانی requestApi function**
```typescript
// اضافه شده در src/features/dashboard/api.ts
const { getTelegramInitData } = await import("@/utils/telegram.ts");
const initData = getTelegramInitData();
if (initData) {
  headers.set("X-Telegram-Init-Data", initData);
}
```

### 2. **تنظیم API Base URL**
```typescript
// اضافه شده در src/features/dashboard/api.ts
if (import.meta.env.PROD) {
  return "https://firewall-bot-backend.onrender.com/api";
}
```

## تنظیمات مورد نیاز در سرور:

### 1. **فایل .env سرور**
اطمینان حاصل کنید که متغیرهای زیر در سرور تنظیم شده‌اند:

```bash
# URL مینی اپ شما
MINI_APP_URL=https://your-miniapp-domain.com

# CORS Origins - دامنه مینی اپ را اضافه کنید
ALLOWED_ORIGINS=https://your-miniapp-domain.com,https://firewall-bot-frontend.onrender.com

# یا برای development
ALLOWED_ORIGINS=*

# Telegram Bot Token
BOT_TOKEN=your_bot_token_here

# Bot Owner ID
BOT_OWNER_ID=your_telegram_user_id

# Database URL
DATABASE_URL=your_database_url

# Webhook settings
WEBHOOK_DOMAIN=firewall-bot-backend.onrender.com
WEBHOOK_PATH=/telegram/webhook
BOT_WEBHOOK_SECRET=your_webhook_secret
```

### 2. **مشکل اتصال Telegram API**
بر اساس لاگ‌های سرور، مشکل `ETIMEDOUT` در اتصال به Telegram API وجود دارد:

```
FetchError: request to https://api.telegram.org/bot.../getMe failed, reason: ETIMEDOUT
```

**راه‌حل‌های پیشنهادی:**
1. **بررسی Network**: ممکن است سرور Render مشکل اتصال به Telegram API داشته باشد
2. **تنظیم Polling Mode**: به جای webhook از polling استفاده کنید:
   ```bash
   BOT_START_MODE=polling
   ```
3. **بررسی BOT_TOKEN**: اطمینان حاصل کنید که token معتبر است

## مراحل تست:

### 1. **تست در Development**
```bash
# اجرای frontend
npm run dev

# اجرای backend در terminal جداگانه
npm run start
```

### 2. **تست در Production**
1. Build کردن frontend:
   ```bash
   npm run build
   ```
2. Deploy کردن به سرور
3. تست مینی اپ در Telegram

## نکات مهم:

### 1. **Telegram Init Data**
- مینی اپ باید از داخل Telegram باز شود
- در development می‌توانید از mock data استفاده کنید

### 2. **CORS Configuration**
- دامنه مینی اپ باید در `ALLOWED_ORIGINS` باشد
- برای development می‌توانید `*` استفاده کنید

### 3. **Authentication**
- Server از Telegram init data برای authentication استفاده می‌کند
- اگر init data موجود نباشد، در development mode bypass می‌شود

## Debug Commands:

### 1. **بررسی لاگ‌های سرور**
```bash
# در Render dashboard
tail -f logs
```

### 2. **تست API endpoint**
```bash
curl -X GET https://firewall-bot-backend.onrender.com/api/groups \
  -H "X-Telegram-Init-Data: your_init_data_here"
```

### 3. **بررسی CORS**
```bash
curl -H "Origin: https://your-miniapp-domain.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: X-Telegram-Init-Data" \
  -X OPTIONS \
  https://firewall-bot-backend.onrender.com/api/groups
```

## وضعیت فعلی:

- ✅ **Frontend Code**: به‌روزرسانی شده
- ✅ **API Base URL**: تنظیم شده
- ⚠️ **Server CORS**: نیاز به تنظیم دامنه مینی اپ
- ⚠️ **Telegram API Connection**: نیاز به بررسی network یا تغییر به polling mode

## مرحله بعدی:

1. **تنظیم CORS**: دامنه مینی اپ را به `ALLOWED_ORIGINS` اضافه کنید
2. **تست مینی اپ**: از داخل Telegram تست کنید
3. **بررسی لاگ‌ها**: در صورت مشکل، لاگ‌های جدید را بررسی کنید
