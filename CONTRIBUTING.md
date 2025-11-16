# 🤝 راهنمای توسعه و مشارکت

این راهنما برای توسعه‌دهندگانی است که می‌خواهند روی این پروژه کار کنند یا آن را سفارشی‌سازی کنند.

## 🏗️ معماری پروژه

### نمای کلی

```
┌─────────────┐         ┌──────────────┐
│   Telegram  │  ◄────► │   Bot API    │
│     User    │         │  (Telegraf)  │
└─────────────┘         └──────────────┘
       │                       │
       │                       ▼
       │                ┌──────────────┐
       │                │  Processing  │
       │                │   Pipeline   │
       │                └──────────────┘
       │                       │
       ▼                       ▼
┌─────────────┐         ┌──────────────┐
│  Mini App   │  ────►  │  Express API │
│   (React)   │         │    Server    │
└─────────────┘         └──────────────┘
       │                       │
       │                       ▼
       │                ┌──────────────┐
       │                │  PostgreSQL  │
       │                │   Database   │
       └───────────────►└──────────────┘
```

### کامپوننت‌های اصلی

1. **Bot Layer** (`/bot`)
   - Telegram Bot با Telegraf
   - Command handlers
   - Webhook/Polling support
   - State management

2. **Processing Pipeline** (`/bot/processing`)
   - Message processing
   - Firewall engine
   - Warning system
   - Action executor

3. **API Layer** (`/server/api`)
   - Express REST API
   - Telegram initData authentication
   - CRUD endpoints

4. **Database Layer** (`/server/db`)
   - Prisma ORM
   - Repository pattern
   - State management

5. **Frontend** (`/src`)
   - React Mini App
   - Telegram UI components
   - State management
   - Routing

6. **Worker** (`/worker`)
   - Cloudflare Worker
   - Static asset serving
   - API proxy

## 🛠️ Setup محیط Development

### 1. نصب Dependencies

```bash
npm install
```

### 2. تنظیم Database

```bash
# Generate Prisma Client
npx prisma generate

# اجرای Migrations
npm run migrate:dev

# (اختیاری) Seed data
npx prisma db seed
```

### 3. تنظیم Environment Variables

```bash
cp .env.example .env
```

**حداقل متغیرهای لازم:**
- `BOT_TOKEN`
- `BOT_OWNER_ID`
- `MINI_APP_URL`
- `DATABASE_URL`

### 4. اجرای Development Servers

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Bot
npm run bot
```

## 📝 Code Style

### TypeScript

```typescript
// ✅ Good
export async function fetchUserData(userId: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { telegramId: userId },
  });
  return user;
}

// ❌ Bad
export async function fetch_user(id) {
  return await db.users.find(id);
}
```

### React Components

```typescript
// ✅ Good
interface ProfileProps {
  userId: string;
  onUpdate?: () => void;
}

export function UserProfile({ userId, onUpdate }: ProfileProps) {
  // ...
}

// ❌ Bad
export function UserProfile(props) {
  // ...
}
```

### Naming Conventions

- **Files**: `camelCase.ts` or `PascalCase.tsx` (components)
- **Functions**: `camelCase`
- **Components**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces/Types**: `PascalCase`

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### E2E Tests

```bash
npm run test:e2e
```

## 📦 Adding New Features

### 1. ویژگی جدید در Bot

```typescript
// /bot/index.ts

bot.command('newcommand', async (ctx) => {
  await ctx.reply('Hello from new command!');
});
```

### 2. API Endpoint جدید

```typescript
// /server/api/routes/myroute.ts

import { Router } from 'express';

export function createMyRouter() {
  const router = Router();
  
  router.get('/my-data', async (req, res) => {
    const data = await fetchData();
    res.json(data);
  });
  
  return router;
}
```

### 3. صفحه جدید در Mini App

```typescript
// /src/pages/MyPage/MyPage.tsx

import { Page } from '@/components/Page';

export function MyPage() {
  return (
    <Page>
      <h1>My New Page</h1>
    </Page>
  );
}
```

### 4. جدول جدید در Database

```prisma
// /prisma/schema.prisma

model MyModel {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
}
```

```bash
# ایجاد Migration
npm run migrate:dev -- --name add_my_model
```

## 🔍 Debugging

### Bot Debugging

```typescript
// اضافه کردن logs
import { logger } from '../server/utils/logger.js';

logger.debug('User action', { userId, action });
logger.error('Failed to process', error);
```

### API Debugging

```bash
# چک کردن logs
tail -f /var/log/supervisor/backend.err.log
```

### Frontend Debugging

```typescript
// در Development
console.log('[component]', data);

// برای Telegram debugging
import eruda from 'eruda';
if (import.meta.env.DEV) {
  eruda.init();
}
```

## 🚀 Deploy Flow

### 1. تغییرات خود را Test کنید

```bash
npm run lint
npm run build
npm test
bash scripts/health-check.sh
```

### 2. Commit کنید

```bash
git add .
git commit -m "feat: add new feature"
```

### 3. Push کنید

```bash
git push origin main
```

### 4. Deploy کنید

```bash
# Frontend (Cloudflare Worker)
npm run worker:deploy

# Backend
# بسته به platform (Railway, Heroku, etc.)
railway up
# یا
git push heroku main
```

## 📊 Performance Tips

### Database Queries

```typescript
// ✅ Good: Include only needed fields
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true },
});

// ❌ Bad: Fetch everything
const user = await prisma.user.findUnique({
  where: { id },
});
```

### React Rendering

```typescript
// ✅ Good: Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return calculateExpensive(data);
}, [data]);

// ✅ Good: Memoize callbacks
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);
```

### Bundle Size

```typescript
// ✅ Good: Dynamic imports
const HeavyComponent = lazy(() => import('./HeavyComponent'));

// ❌ Bad: Import everything
import HeavyComponent from './HeavyComponent';
```

## 🔒 Security Best Practices

1. **هرگز Credentials را commit نکنید**
   ```bash
   # همیشه چک کنید
   git diff --cached
   ```

2. **از Environment Variables استفاده کنید**
   ```typescript
   const token = process.env.BOT_TOKEN;
   ```

3. **Input Validation**
   ```typescript
   function validateUserId(id: unknown): string {
     if (typeof id !== 'string' || !id.match(/^\d+$/)) {
       throw new Error('Invalid user ID');
     }
     return id;
   }
   ```

4. **Rate Limiting**
   ```typescript
   // در API endpoints
   app.use(rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100
   }));
   ```

## 📖 منابع مفید

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegraf Documentation](https://telegraf.js.org/)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)

## 💡 Tips & Tricks

### دسترسی سریع به Prisma Studio

```bash
npm run prisma:studio
```

### Reset کامل Database

```bash
npx prisma migrate reset
```

### Generate Types از Prisma

```bash
npx prisma generate
```

### بررسی Webhook Info

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### Test API Endpoint

```bash
curl -X GET http://localhost:3000/healthz
```

## ❓ سوالات متداول

### چگونه Firewall Rule جدید اضافه کنم؟

به `/bot/processing/firewallEngine.ts` نگاه کنید و pattern موجود را دنبال کنید.

### چگونه صفحه جدید به Mini App اضافه کنم؟

1. Component در `/src/pages/` بسازید
2. Route در `/src/navigation/routes.tsx` اضافه کنید
3. Link در منوی مربوطه قرار دهید

### چگونه Migration جدید بسازم؟

```bash
# تغییر schema.prisma
# سپس:
npm run migrate:dev -- --name description_of_change
```

---

**Happy Coding! 🚀**
