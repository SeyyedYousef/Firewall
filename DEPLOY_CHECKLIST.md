# 🎯 چک‌لیست Deploy: چی رو کجا بذاریم؟

## 📝 اطلاعاتی که نیاز داری:

### 1. از تلگرام 📱

| چی رو؟ | از کجا؟ | مثال |
|--------|---------|------|
| **BOT_TOKEN** | @BotFather → /newbot | `7879361823:AAGqYs...` |
| **BOT_OWNER_ID** | @userinfobot → /start | `5076130392` |
| **BOT_USERNAME** | @BotFather (username که دادی) | `MyFirewallBot` |

### 2. از Neon.tech 💾

| چی رو؟ | از کجا؟ | مثال |
|--------|---------|------|
| **DATABASE_URL** | Neon Dashboard → Connection String | `postgresql://user:pass@ep-...` |

### 3. از Railway 🚂

| چی رو؟ | از کجا؟ | مثال |
|--------|---------|------|
| **WEBHOOK_DOMAIN** | Railway → Settings → Domain | `https://xxx.up.railway.app` |

### 4. از Cloudflare ☁️

| چی رو؟ | از کجا؟ | مثال |
|--------|---------|------|
| **MINI_APP_URL** | بعد از `wrangler deploy` | `https://xxx.workers.dev` |

---

## 🗺️ این اطلاعات رو کجا بذاریم؟

### در Railway (Backend) 🚂

به **Railway Dashboard → Variables** برو و این‌ها رو اضافه کن:

```env
BOT_TOKEN = [از BotFather]
BOT_OWNER_ID = [از userinfobot]
BOT_USERNAME = [username ربات]
DATABASE_URL = [از Neon]
WEBHOOK_DOMAIN = [URL خود Railway]
BOT_START_MODE = webhook
PORT = 3000
MINI_APP_URL = [بعداً از Cloudflare]
```

### در wrangler.toml (Cloudflare) ☁️

فایل `/app/wrangler.toml` را باز کن و:

```toml
[vars]
BACKEND_URL = "[URL Railway]"
```

### در BotFather (تلگرام) 🤖

```
/mybots
→ [ربات خود]
→ Bot Settings
→ Menu Button
→ Configure Menu Button
→ [URL Cloudflare Worker]
```

---

## 🔄 ترتیب انجام کارها:

```
1. 📱 BotFather → دریافت TOKEN
2. 📱 userinfobot → دریافت User ID
3. 💾 Neon → ساخت دیتابیس
4. 🚂 Railway → Deploy backend
5. 🚂 Railway Variables → قرار دادن اطلاعات
6. 💻 Terminal → Migration دیتابیس
7. 📱 تلگرام → تست /start
8. ☁️ Cloudflare → Deploy Mini App
9. 🚂 Railway Variables → اضافه کردن MINI_APP_URL
10. 📱 BotFather → تنظیم Menu Button
11. 📱 تلگرام → تست Mini App
```

---

## ✅ چطور بفهمم درست کار کرد؟

### تست Backend:
```bash
# اگر این URL کار کرد، backend OK است:
https://[RAILWAY_URL]/healthz
```

باید بگه: `{"status":"ok"}`

### تست ربات:
```
تلگرام → ربات → /start
جواب بده؟ ✅ OK
```

### تست Owner Panel:
```
تلگرام → ربات → /panel
پنل باز شه؟ ✅ OK
```

### تست Mini App:
```
تلگرام → ربات → دکمه Management Panel
Mini App باز شه؟ ✅ OK
```

### تست Firewall:
```
1. گروه تست بساز
2. ربات رو admin کن
3. لینک بفرست
4. ربات لینک رو پاک کنه؟ ✅ OK
```

---

## 🐛 Debug: چطور بفهمم مشکل کجاست؟

### ربات جواب نمی‌ده:
```bash
# چک کن Webhook تنظیم شده:
curl "https://api.telegram.org/bot[TOKEN]/getWebhookInfo"
```

باید ببینی:
```json
{
  "url": "https://[RAILWAY_URL]/telegram/webhook",
  "has_custom_certificate": false,
  "pending_update_count": 0
}
```

### دیتابیس وصل نیست:
```
Railway → Deployments → View Logs
دنبال این خطا بگرد: "table does not exist"
```

**راه حل:** Migration رو دوباره بزن:
```bash
npx prisma migrate deploy
```

### Mini App کار نمی‌کنه:
```
1. چک کن MINI_APP_URL در Railway درست است
2. چک کن BACKEND_URL در wrangler.toml درست است
3. Railway رو restart کن
```

---

## 💡 نکات مهم:

### ✅ انجام بده:
- TOKEN و URL ها رو بدون فاصله کپی کن
- همه URL ها با `https://` شروع شن
- بعد از هر تغییر در Railway Variables، منتظر بمون تا redeploy بشه

### ❌ انجام نده:
- TOKEN رو تو GitHub commit نکن
- `.env` رو commit نکن
- بعد از Deploy مرحله Migration رو فراموش نکن

---

## 📞 کمک بیشتر:

اگر گیر کردی، این اطلاعات رو بفرست:
1. ✅ کدوم مراحل رو انجام دادی
2. ❌ کجا گیر کردی
3. 📋 خطای دقیق چی بود (از Railway Logs)
4. 🔗 URL های Railway و Cloudflare چی هستن

---

**موفق باشی! 🚀**
