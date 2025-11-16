# 🎯 Mission System Implementation Plan

## تغییرات اصلی:

### 1. Mission XP Values (متعادل شده):

**Daily Missions:**
- Check in: 20 XP
- Review log: 20 XP  
- Share tip: 25 XP
- Welcome newcomers: 25 XP
- **Completion Bonus:** +150 XP (وقتی همه انجام شوند)

**Weekly Missions:**
- Renew credit: 70 XP
- Create giveaway: 75 XP
- Weekly recap: 65 XP
- Referral push: 70 XP
- **Completion Bonus:** +400 XP

**Monthly Missions:**
- Complete 20 daily: 180 XP
- 10 referrals: 200 XP
- Store redemption: 170 XP
- **Completion Bonus:** +1000 XP

**General Missions:**
- Join channel (dynamic from owner panel): 30 XP each

### 2. XP Marketplace - New Rewards:

**Free Credits:**
- 7 روز رایگان: 800 XP
- 14 روز رایگان: 1400 XP  
- 30 روز رایگان: 2500 XP

**Badges (نشان‌ها):**
- 🌟 Rookie: 200 XP
- ⚡ Active Member: 500 XP
- 🎯 Mission Master: 1000 XP
- 💎 Elite Guardian: 2000 XP
- 👑 Legend: 5000 XP

### 3. حذف شده:
- ❌ Stars rewards
- ❌ Skin rewards
- ❌ "Wallet & Activity" section from all pages

### 4. Referral System:
- Automatic tracking (no manual "Log referral" button)
- 100 XP when referral adds a group
- Shows total invites & earned XP

### 5. Owner Panel Features:
- Add/Remove channel missions
- View all missions
- Set XP values per mission
- Enable/Disable missions

## Implementation Files:
1. `/app/src/pages/Missions/MissionsPage.tsx` - Update XP values & rewards
2. `/app/bot/index.ts` - Add mission management to owner panel
3. `/app/server/db/missionRepository.ts` - New database functions
4. `/app/prisma/schema.prisma` - Add Mission tables
5. `/app/src/features/referral/` - Automatic referral tracking

Status: ✅ Plan Complete - Ready for Implementation
