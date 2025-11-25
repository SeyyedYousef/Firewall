# Avatar Acronym Errors - Fix List

## Files to Fix:
1. ✅ GroupCard.tsx - FIXED
2. ✅ ProfileHeader.tsx - FIXED  
3. ✅ DashboardPage.tsx - FIXED
4. ✅ MissionsPage.tsx - ALREADY FIXED
5. ✅ ProfilePage.tsx - ALREADY FIXED
6. ✅ StarsPage.tsx - ALREADY FIXED
7. GroupDashboardPage.tsx - NEEDS FIX
8. GroupAnalyticsPage.tsx - NEEDS FIX
9. GeneralSettingsPage.tsx - NEEDS FIX
10. GroupBanSettingsPage.tsx - NEEDS FIX
11. GroupCountLimitSettingsPage.tsx - NEEDS FIX
12. GroupCustomTextsPage.tsx - NEEDS FIX
13. GroupMandatoryMembershipPage.tsx - NEEDS FIX
14. GroupSilenceSettingsPage.tsx - NEEDS FIX

## Pattern to Fix:
Change:
```typescript
acronym={photoUrl ? undefined : initialsFromTitle(title)}
```

To:
```typescript
acronym={photoUrl ? undefined : (initialsFromTitle(title) ?? undefined)}
```
