# ⚡ راهنمای سریع: 10 دقیقه تا ربات زنده!

## 1️⃣ توکن ربات (2 دقیقه)
```
1. تلگرام → @BotFather → /newbot
2. نام ربات → Username (باید با bot تمام شود)
3. TOKEN را کپی کنید
```

## 2️⃣ User ID خود (30 ثانیه)
```
1. تلگرام → @userinfobot → /start
2. عدد Id را کپی کنید
```

## 3️⃣ دیتابیس (2 دقیقه)
```
1. https://neon.tech → Sign up با GitHub
2. Create Project → نام: firewall-bot
3. Connection String را کپی کنید
```

## 4️⃣ Backend (3 دقیقه)
```
1. https://railway.app → Login با GitHub
2. New Project → Deploy from GitHub repo
3. Variables تنظیم کنید:
   BOT_TOKEN = [token شما]
   BOT_OWNER_ID = [user id شما]
   BOT_USERNAME = [username بدون @]
   DATABASE_URL = [neon connection string]
   BOT_START_MODE = webhook
   PORT = 3000
4. بعد از deploy، URL را کپی کنید
5. Variable دیگر اضافه کنید:
   WEBHOOK_DOMAIN = [railway url]
```

## 5️⃣ Migration (1 دقیقه)
```bash
git clone [repo]
cd [repo]
npm install
export DATABASE_URL="[neon connection string]"
npx prisma migrate deploy
```

## 6️⃣ تست (30 ثانیه)
```
1. تلگرام → ربات شما → /start
2. /panel → باید کار کند ✅
```

## 7️⃣ Mini App - اختیاری (2 دقیقه)
```bash
# Install Wrangler
npm install -g wrangler

# Login
wrangler login

# Edit wrangler.toml
# BACKEND_URL = [railway url]

# Deploy
npm run build
npm run worker:deploy

# کپی Worker URL
# برگردید به Railway Variables:
# MINI_APP_URL = [worker url]

# BotFather → /mybots → Bot Settings → Menu Button
# URL = [worker url]
```

## ✅ تمام!

**تست:**
```
تلگرام → ربات → /start → "Management Panel" → Mini App باز شود
```

---

## 🆘 خطا داری؟

**ربات جواب نمی‌ده:**
- چک کن TOKEN درست کپی شده
- Railway logs رو نگاه کن

**Migration error:**
```bash
npx prisma migrate deploy --preview-feature
```

**Webhook error:**
```bash
curl "https://api.telegram.org/bot[TOKEN]/setWebhook?url=[RAILWAY_URL]/telegram/webhook"
```

---

## 🎯 فقط می‌خوای ربات روشن شه؟

**بدون Mini App:**
```
1. BotFather → توکن
2. Railway → Deploy
3. Variables تنظیم کن
4. /start بزن
```

**با Mini App:**
```
همه مراحل بالا + 
Cloudflare Worker deploy
```

---

**سوال داری؟ بپرس! 💬**
