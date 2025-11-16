# 📝 Changelog

تمام تغییرات مهم این پروژه در این فایل مستند می‌شود.

## [1.0.0] - 2025-01-XX - Production Ready

### ✨ Added - موارد اضافه شده
- **مستندات کامل فارسی**: README.fa.md، QUICKSTART.fa.md
- **راهنمای Deployment**: راهنمای گام به گام برای Cloudflare Workers
- **Production Checklist**: چک‌لیست کامل برای آماده‌سازی production
- **Helper Scripts**: 
  - `scripts/deploy.sh` - اسکریپت کمکی برای deploy
  - `scripts/health-check.sh` - بررسی سلامت پروژه
- **Environment Templates**: `.env.production.template` برای تنظیمات production

### 🔧 Fixed - باگ‌های رفع شده
- **Vite Base Path**: تغییر از `/reactjs-template/` به `/` برای production
- **Package.json**: به‌روزرسانی نام و homepage
- **Build Configuration**: بهینه‌سازی تنظیمات build

### 📚 Documentation - مستندات
- راهنمای کامل Deployment به فارسی
- Quick Start Guide برای شروع سریع
- Production Checklist با 50+ آیتم
- Health Check Script برای debugging

### 🎯 Improved - بهبودها
- بهبود ساختار مستندات
- اضافه شدن مثال‌های عملی بیشتر
- راهنماهای تصویری برای deployment
- بهینه‌سازی bundle size

---

## [0.0.1] - Initial Version

### Features - ویژگی‌ها
- ربات تلگرام با Telegraf
- Mini App Dashboard با React
- سیستم Firewall پیشرفته
- Telegram Stars Payment
- PostgreSQL با Prisma ORM
- Cloudflare Worker Support
- Analytics Dashboard
- Giveaway System
- Mission & XP System
- Group Management
- Owner Panel
- API Layer با Express

### Tech Stack - پشته فناوری
- Frontend: React 18 + TypeScript + Vite
- Backend: Node.js + Express + Telegraf
- Database: PostgreSQL + Prisma
- Deployment: Cloudflare Workers

---

## Format

این changelog از [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) پیروی می‌کند.

### دسته‌بندی‌ها:
- **Added**: ویژگی‌های جدید
- **Changed**: تغییرات در ویژگی‌های موجود
- **Deprecated**: ویژگی‌هایی که قرار است حذف شوند
- **Removed**: ویژگی‌های حذف شده
- **Fixed**: باگ‌های رفع شده
- **Security**: اصلاحات امنیتی
