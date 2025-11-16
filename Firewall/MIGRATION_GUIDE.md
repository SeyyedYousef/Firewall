# راهنمای Migration - رفع مشکل "Unable to load groups"

## مشکل
کاربرانی که قبلاً ربات را به گروه خود اضافه کرده‌اند، نمی‌توانند لیست گروه‌های خود را ببینند و خطای "Unable to load groups" دریافت می‌کنند.

## علت
در نسخه‌های قبلی، وقتی ربات به گروه اضافه می‌شد، فیلد `ownerId` در دیتابیس ست نمی‌شد. این باعث می‌شود که سیستم نتواند تشخیص دهد کدام کاربر صاحب کدام گروه است.

## راه حل
یک migration script ایجاد شده که:
1. تمام گروه‌هایی که `ownerId` ندارند را پیدا می‌کند
2. از Telegram API لیست ادمین‌های هر گروه را دریافت می‌کند
3. Creator (سازنده) گروه را به عنوان owner ست می‌کند

## مراحل اجرا

### 1. مطمئن شوید که متغیرهای محیطی تنظیم شده‌اند
```bash
# در فایل .env
BOT_TOKEN=your_bot_token_here
DATABASE_URL=your_database_url_here
```

### 2. اجرای Migration
```bash
npm run migrate:owners
```

### 3. بررسی نتیجه
Migration در console لاگ می‌زند:
- تعداد گروه‌های پیدا شده بدون owner
- تعداد گروه‌هایی که با موفقیت owner آن‌ها ست شد
- تعداد گروه‌هایی که با خطا مواجه شدند

## نکات مهم

### ⚠️ هشدارها
- این migration ممکن است چند دقیقه طول بکشد اگر گروه‌های زیادی دارید
- برای هر گروه یک request به Telegram API ارسال می‌شود
- اگر ربات از گروهی remove شده باشد، نمی‌تواند owner را ست کند

### ✅ بعد از Migration
- کاربران می‌توانند لیست گروه‌های خود را ببینند
- گروه‌های جدید به صورت خودکار owner دارند (نیازی به migration ندارند)
- اگر گروهی owner نداشته باشد، فقط panel admin می‌تواند آن را ببیند

## Troubleshooting

### خطا: "Bot was blocked by the user"
این طبیعی است - برخی کاربران ممکن است ربات را بلاک کرده باشند. Migration برای گروه‌های دیگر ادامه می‌یابد.

### خطا: "Chat not found"
گروه حذف شده یا ربات از آن remove شده است. این گروه‌ها skip می‌شوند.

### خطا: "Too Many Requests"
اگر گروه‌های زیادی دارید، ممکن است به rate limit برخورد کنید. در این صورت:
1. صبر کنید چند دقیقه
2. دوباره migration را اجرا کنید (فقط گروه‌های باقی‌مانده را پردازش می‌کند)

## Alternative: استفاده از API Endpoint

اگر نمی‌توانید script را اجرا کنید، می‌توانید از API endpoint استفاده کنید:

```bash
POST /api/v1/groups/migrate-owners
Header: X-Telegram-Init-Data: <your_init_data>
```

**نکته:** فقط panel admin می‌تواند این endpoint را صدا بزند.

## تغییرات اعمال شده

### 1. Backend
- ✅ تابع `setGroupOwner` در `mutateRepository.ts`
- ✅ آپدیت `myChatMemberHandler` برای ست کردن owner در گروه‌های جدید
- ✅ Migration script در `server/db/migrations/setMissingGroupOwners.ts`
- ✅ API endpoint برای اجرای migration

### 2. Frontend
- ✅ Auto-refresh هر 10 ثانیه در Group Dashboard
- ✅ Real-time updates برای warnings و bot actions

### 3. Database Functions
- ✅ Support برای pagination در `listRuleAudits`
- ✅ Support برای pagination در `listModerationActionsFromDb`

## پشتیبانی
اگر مشکلی داشتید، لاگ‌ها را بررسی کنید:
```bash
# در console
npm run migrate:owners
```

تمام خطاها و موفقیت‌ها لاگ می‌شوند.
