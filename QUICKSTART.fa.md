# ⚡ راهنمای شروع سریع

این راهنما برای کسانی است که می‌خواهند **سریع** پروژه را اجرا کنند.

## 🎯 5 دقیقه تا اجرا!

### مرحله 1: دریافت توکن ربات (2 دقیقه)

1. به [@BotFather](https://t.me/BotFather) بروید
2. دستور `/newbot` را بزنید
3. نام ربات را وارد کنید
4. Username ربات را وارد کنید
5. توکن را کپی کنید (مثل: `7879361823:AAGqYsVH...`)

### مرحله 2: پیدا کردن User ID خودتان (1 دقیقه)

1. به [@userinfobot](https://t.me/userinfobot) بروید
2. `/start` را بزنید
3. عدد `Id:` را کپی کنید (مثل: `5076130392`)

### مرحله 3: راه‌اندازی (2 دقیقه)

```bash
# کلون پروژه
git clone <your-repo>
cd telegram-firewall-bot

# نصب
npm install

# تنظیم .env
cp .env.example .env
```

**ویرایش `.env` و این 3 مورد را تغییر دهید:**

```env
BOT_TOKEN=7879361823:AAGqYsVH...        # توکن شما
BOT_OWNER_ID=5076130392                  # User ID شما
BOT_USERNAME=YourBotName                 # Username ربات شما
```

```bash
# Generate Prisma
npx prisma generate

# اجرا!
npm run bot
```

✅ ربات شما آماده است! به ربات خود در تلگرام پیام `/start` بدهید.

---

## 📱 Mini App هم می‌خواهید؟

### ترمینال دیگر باز کنید:

```bash
npm run dev
```

Mini App در `http://localhost:5173` باز می‌شود.

**نکته**: برای تست Mini App در تلگرام، باید آن را deploy کنید (مرحله بعدی).

---

## ☁️ Deploy در Cloudflare (10 دقیقه)

### گزینه A: با اسکریپت Helper (آسان)

```bash
bash scripts/deploy.sh
```

این اسکریپت همه چیز را برای شما انجام می‌دهد!

### گزینه B: دستی

```bash
# نصب Wrangler
npm install -g wrangler

# لاگین
wrangler login

# Build
npm run build

# Deploy
npm run worker:deploy
```

بعد از deploy، یک URL دریافت می‌کنید مثل:
```
https://tg-firewall-worker.yourname.workers.dev
```

این URL را در `.env` قرار دهید:
```env
MINI_APP_URL=https://tg-firewall-worker.yourname.workers.dev
```

Backend را restart کنید!

---

## 🗄️ دیتابیس می‌خواهید؟

### با Neon (رایگان، 5 دقیقه):

1. به [neon.tech](https://neon.tech) بروید
2. Sign Up کنید (با GitHub)
3. Create Project کنید
4. Connection String را کپی کنید
5. در `.env` قرار دهید:
   ```env
   DATABASE_URL="postgresql://user:pass@ep-xxx..."
   ```
6. Migration اجرا کنید:
   ```bash
   npm run migrate:deploy
   ```

✅ دیتابیس شما آماده است!

---

## ✅ چک‌لیست نهایی

- [ ] ربات پاسخ می‌دهد (`/start`)
- [ ] دستور `/panel` کار می‌کند (فقط برای owner)
- [ ] Mini App build می‌شود (`npm run build`)
- [ ] Worker deploy شد
- [ ] دیتابیس وصل است (اختیاری)

---

## 🆘 مشکل دارید؟

### ربات پاسخ نمی‌دهد
- `BOT_TOKEN` را چک کنید
- مطمئن شوید `npm run bot` در حال اجراست

### `/panel` کار نمی‌کند
- `BOT_OWNER_ID` را چک کنید
- مطمئن شوید عدد درست است

### Build خطا می‌دهد
```bash
rm -rf node_modules
npm install
npm run build
```

### Deploy خطا می‌دهد
```bash
wrangler whoami  # چک کردن لاگین
wrangler logout
wrangler login
```

---

## 🎉 تمام!

حالا شما یک ربات فایروال تلگرام کاملاً کاربردی دارید!

**مراحل بعدی:**
- [📖 راهنمای کامل Deployment](DEPLOYMENT.md)
- [✅ Production Checklist](PRODUCTION_CHECKLIST.md)
- [📚 README فارسی](README.fa.md)

---

**نکته Pro**: از `bash scripts/health-check.sh` برای چک کردن وضعیت پروژه استفاده کنید!
