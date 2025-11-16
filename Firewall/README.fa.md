# 🔥 ربات فایروال تلگرام و Mini App

یک ربات قدرتمند تلگرام با قابلیت‌های پیشرفته مدیریت گروه، قوانین فایروال، و داشبورد زیبای Mini App.

[![آماده Production](https://img.shields.io/badge/Production-Ready-green.svg)](DEPLOYMENT.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb.svg)](https://reactjs.org/)

## ✨ ویژگی‌های اصلی

### 🤖 ربات تلگرام
- پنل مدیریتی کامل برای Owner
- سیستم Admin Panel با سطوح دسترسی
- مدیریت پیام‌های خوشامدگویی قابل تنظیم
- قابلیت Broadcast به تمام گروه‌ها
- سیستم Ban/Unban کاربران

### 🔥 سیستم Firewall
- قوانین خودکار برای فیلتر محتوا
- پشتیبانی از انواع قوانین: Link، Media، Text، Language
- زمان‌بندی قوانین (Schedule)
- Escalation System برای تکرار تخلفات
- Cache هوشمند برای عملکرد بهتر
- Audit Log کامل

### 📱 Mini App Dashboard
- داشبورد مدیریت گروه‌ها
- نمایش آماری لحظه‌ای
- تنظیمات Firewall از طریق UI
- مدیریت اعضا و History
- نمایش Analytics پیشرفته

### ⭐ سیستم پرداخت Telegram Stars
- خرید اشتراک برای گروه‌ها
- هدیه دادن اشتراک به دیگران
- کیف پول Stars با تاریخچه تراکنش‌ها
- پشتیبانی از Refund
- فاکتور خودکار

### 🎁 سیستم Giveaway
- برگزاری قرعه‌کشی در گروه‌ها
- چند برنده (Multi-Winner)
- شرایط شرکت قابل تنظیم
- اعلام خودکار برندگان

### 🎯 سیستم Missions و XP
- Daily Tasks برای کاربران
- سیستم Referral با لینک اختصاصی
- جمع‌آوری XP
- تبدیل XP به اشتراک یا Stars
- Leaderboard

### 📊 Analytics Dashboard
- نمودار رشد اعضا
- آمار پیام‌های روزانه
- تحلیل فعالیت کاربران
- Export به CSV و PNG
- چند بازه زمانی (Day، Week، Month)

## 🛠️ تکنولوژی‌ها

### Frontend
- **React 18** - کتابخانه UI
- **TypeScript** - Type Safety
- **Vite** - Build Tool سریع
- **Telegram UI** - کامپوننت‌های رسمی تلگرام
- **@telegram-apps/sdk-react** - SDK Mini App
- **TailwindCSS** - استایل‌دهی
- **Lottie** - انیمیشن‌های زیبا

### Backend
- **Node.js** - محیط اجرا
- **Express** - Web Framework
- **Telegraf** - کتابخانه Bot تلگرام
- **Prisma ORM** - دسترسی به Database
- **PostgreSQL** - دیتابیس
- **p-queue** - مدیریت صف پردازش

### Deployment
- **Cloudflare Workers** - میزبانی Mini App و Static Assets
- **Wrangler** - ابزار Deploy Cloudflare

## 📦 نصب و راه‌اندازی

### پیش‌نیازها
```bash
# Node.js 18 یا بالاتر
node --version

# npm یا yarn
npm --version
```

### 1. دریافت پروژه
```bash
git clone <repository-url>
cd telegram-firewall-bot
```

### 2. نصب Dependencies
```bash
npm install
```

### 3. تنظیم محیط
```bash
# کپی کردن فایل نمونه
cp .env.example .env

# ویرایش و تنظیم مقادیر
nano .env
```

**مقادیر ضروری:**
- `BOT_TOKEN` - توکن ربات از [@BotFather](https://t.me/BotFather)
- `BOT_OWNER_ID` - شناسه عددی تلگرام شما
- `DATABASE_URL` - آدرس دیتابیس PostgreSQL
- `MINI_APP_URL` - آدرس Mini App (بعد از deploy)
- `WEBHOOK_DOMAIN` - آدرس Backend Server

### 4. راه‌اندازی Database
```bash
# تولید Prisma Client
npx prisma generate

# اجرای Migrations
npm run migrate:deploy

# (اختیاری) مشاهده Database با Prisma Studio
npm run prisma:studio
```

### 5. Development
```bash
# ترمینال 1: اجرای Mini App
npm run dev

# ترمینال 2: اجرای Bot (حالت Polling)
npm run bot
```

Mini App در آدرس `http://localhost:5173` در دسترس خواهد بود.

## 🚀 Deploy به Production

### آماده‌سازی
```bash
# بررسی سلامت پروژه
bash scripts/health-check.sh

# Build Mini App
npm run build
```

### Deploy با Cloudflare Worker

**مرحله 1: نصب Wrangler**
```bash
npm install -g wrangler
```

**مرحله 2: لاگین به Cloudflare**
```bash
wrangler login
```

**مرحله 3: تنظیم wrangler.toml**

فایل `wrangler.toml` را ویرایش کنید:
```toml
[vars]
BACKEND_URL = "https://your-backend-server.com"
```

**مرحله 4: Deploy**
```bash
npm run worker:deploy
```

یا با استفاده از اسکریپت Helper:
```bash
bash scripts/deploy.sh
```

### Deploy Backend

Backend باید روی یک سرور با دسترسی عمومی اجرا شود. گزینه‌های توصیه‌شده:

- **Railway** (راحت و رایگان)
- **Heroku** (قابل اعتماد)
- **VPS** (کنترل کامل)
- **Fly.io** (جدید و سریع)

**مثال با Railway:**
```bash
# نصب Railway CLI
npm install -g @railway/cli

# لاگین
railway login

# ایجاد پروژه
railway init

# تنظیم متغیرها
railway variables set BOT_TOKEN="..." \
  BOT_OWNER_ID="..." \
  DATABASE_URL="..." \
  WEBHOOK_DOMAIN="https://xxx.up.railway.app"

# Deploy
railway up
```

## 📖 مستندات کامل

- [📚 راهنمای کامل Deployment](DEPLOYMENT.md) - گام به گام Deploy
- [✅ Checklist Production](PRODUCTION_CHECKLIST.md) - چک‌لیست قبل از Launch
- [🏗️ طراحی Firewall](docs/firewall-design.md) - معماری سیستم Firewall
- [💳 راهنمای Stars Payment](docs/stars-payments.md) - نحوه کار با Telegram Stars
- [🗄️ یادداشت‌های Database](docs/database-notes.md) - نکات مربوط به Database

## 🔧 Scripts مفید

```bash
# Development
npm run dev              # اجرای Mini App
npm run bot              # اجرای Bot (Polling)
npm run bot:webhook      # اجرای Bot (Webhook)

# Database
npm run migrate:dev      # Migrate در Development
npm run migrate:deploy   # Migrate در Production
npm run prisma:studio    # باز کردن Prisma Studio

# Build & Deploy
npm run build            # Build Mini App
npm run worker:dev       # Test Worker به صورت Local
npm run worker:deploy    # Deploy Worker به Cloudflare

# Testing & Quality
npm run lint             # ESLint
npm run lint:fix         # اصلاح خودکار ESLint

# Helper Scripts
bash scripts/health-check.sh  # بررسی سلامت پروژه
bash scripts/deploy.sh        # کمک به Deploy
```

## 🏗️ ساختار پروژه

```
/app/
├── bot/                    # کد ربات تلگرام
│   ├── index.ts           # Entry point اصلی
│   ├── content.json       # متن‌های ربات
│   ├── firewall.ts        # Firewall Engine
│   ├── processing/        # پردازش پیام‌ها
│   └── state.ts           # State Management
│
├── server/                # Backend API
│   ├── index.ts          # Server Entry
│   ├── api/              # API Routes
│   ├── db/               # Database Layer
│   ├── services/         # Business Logic
│   └── utils/            # Utilities
│
├── src/                  # Frontend Mini App
│   ├── index.tsx         # Entry Point
│   ├── components/       # React Components
│   ├── pages/            # صفحات App
│   ├── features/         # Features
│   └── hooks/            # Custom Hooks
│
├── worker/               # Cloudflare Worker
│   └── index.ts         # Worker Code
│
├── prisma/              # Database Schema
│   └── schema.prisma    # Prisma Schema
│
├── public/              # Static Assets
├── scripts/             # Helper Scripts
└── docs/                # مستندات
```

## 🐛 عیب‌یابی

### ربات پاسخ نمی‌دهد
```bash
# چک کردن وضعیت Webhook
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### Mini App باز نمی‌شود
- مطمئن شوید `MINI_APP_URL` در Backend صحیح است
- Worker را تست کنید: `curl https://your-worker.workers.dev/healthz`

### خطای Database
```bash
# Restart Migrations
npm run migrate:deploy

# بررسی Connection String
echo $DATABASE_URL
```

### Build Error
```bash
# پاک کردن و نصب مجدد
rm -rf node_modules package-lock.json
npm install
```

## 📊 عملکرد و بهینه‌سازی

### کش‌ کردن
- Firewall Rules: کش می‌شوند (45 ثانیه)
- Static Assets: توسط Cloudflare کش می‌شوند
- API Responses: قابل کش کردن

### Database Indexing
تمام جداول دارای Index های مناسب هستند:
- User: telegramId, role
- Group: telegramChatId
- FirewallRule: groupId
- Transactions: status, createdAt

### Bundle Size
- Main Bundle: ~1.4MB (با gzip: ~364KB)
- Lazy Loading: صفحات به صورت جداگانه load می‌شوند

## 🤝 مشارکت

این پروژه Open Source نیست و فقط برای استفاده شخصی شما آماده شده.

## 📝 License

[MIT License](LICENSE)

## 💬 پشتیبانی

در صورت بروز مشکل:
1. فایل‌های LOG را بررسی کنید
2. `scripts/health-check.sh` را اجرا کنید
3. [راهنمای Deployment](DEPLOYMENT.md) را مطالعه کنید
4. مستندات مربوطه را بخوانید

---

ساخته شده با ❤️ برای جامعه تلگرام
