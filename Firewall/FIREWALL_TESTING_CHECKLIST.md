# Firewall Enforcement Testing Checklist 🔥

This document provides a comprehensive checklist to verify that each firewall setting is actually enforced in real Telegram groups, not just saved in the database.

## Prerequisites ⚙️

- [ ] Bot is deployed and running
- [ ] Database connection is working
- [ ] Test Telegram group is created with bot as admin
- [ ] Bot has the following permissions:
  - [ ] Delete messages
  - [ ] Restrict members
  - [ ] Pin messages
  - [ ] Manage chat

## 1. General Settings Enforcement ✅

### Welcome Message Settings
- [ ] **Enable welcome message**
  - Action: Add new member to group
  - Expected: Bot sends welcome message
  - Verify: Custom welcome text is used (if configured)

- [ ] **Disable welcome message**
  - Action: Add new member to group
  - Expected: No welcome message sent

- [ ] **Welcome message scheduling**
  - Configure: Set specific time window (e.g., 09:00-17:00)
  - Test during window: Welcome message should be sent
  - Test outside window: Welcome message should NOT be sent

### Warning Message Settings
- [ ] **Enable warning messages**
  - Action: Send message that violates a rule (e.g., link when links are banned)
  - Expected: Message deleted + warning posted in group
  - Verify: Custom warning template is used (if configured)

- [ ] **Disable warning messages**
  - Action: Send rule-violating message
  - Expected: Message deleted but no warning posted

- [ ] **Warning message scheduling**
  - Configure: Set specific time window
  - Test during/outside window to verify timing enforcement

### Silent Mode Settings
- [ ] **Enable silent mode**
  - Action: Trigger any bot message
  - Expected: Bot messages sent with `disable_notification: true`
  - Verify: No sound/notification on mobile devices

- [ ] **Disable silent mode**
  - Expected: Bot messages sent with notifications enabled

### Auto-Delete Settings
- [ ] **Enable auto-delete with 1 minute delay**
  - Action: Trigger bot warning/message
  - Expected: Bot message appears, then deletes after 1 minute
  - Verify: Message actually disappears after specified time

- [ ] **Disable auto-delete**
  - Expected: Bot messages remain permanently

### User Verification Settings
- [ ] **Enable user verification**
  - Action: New unverified user sends message
  - Expected: Message is blocked/deleted
  - Verify: Verification prompt is shown

- [ ] **Disable user verification**
  - Action: Any user sends message
  - Expected: Messages allowed regardless of verification status

### Public Commands Restriction
- [ ] **Enable public commands restriction**
  - Action: Non-admin user sends `/help` or `/start`
  - Expected: Command message is deleted
  - Test scheduling: Commands blocked only during configured hours

- [ ] **Disable public commands restriction**
  - Expected: All users can use public commands

### Join/Leave Message Removal
- [ ] **Enable join/leave message removal**
  - Action: User joins or leaves group
  - Expected: Telegram's default join/leave messages are deleted by bot
  - Verify: Custom welcome message still appears (if enabled)

- [ ] **Disable join/leave message removal**
  - Expected: Default Telegram join/leave messages remain visible

## 2. Content Restriction Enforcement 🚫

### Link Restrictions
- [ ] **Enable ban links**
  - Test: Send `https://example.com`
  - Expected: Message deleted immediately
  - Test: Send `www.google.com`
  - Expected: Message deleted immediately
  - Test: Send text link with different display text
  - Expected: Message deleted immediately

- [ ] **Test whitelist**
  - Configure: Add `t.me` to whitelist
  - Test: Send `https://t.me/username`
  - Expected: Message allowed
  - Test: Send `https://example.com`
  - Expected: Message still blocked

- [ ] **Test blacklist**
  - Configure: Add `spam` to blacklist
  - Test: Send `https://spamsite.com`
  - Expected: Message blocked
  - Test: Send `https://goodsite.com`
  - Expected: Message allowed (if not in blacklist)

### Media Restrictions
- [ ] **Ban photos**
  - Action: Send a photo
  - Expected: Photo deleted immediately

- [ ] **Ban videos**
  - Action: Send a video file
  - Expected: Video deleted immediately

- [ ] **Ban stickers**
  - Action: Send a sticker
  - Expected: Sticker deleted immediately

- [ ] **Ban voice messages**
  - Action: Send a voice note
  - Expected: Voice message deleted immediately

- [ ] **Ban documents/files**
  - Action: Send any file attachment
  - Expected: Document deleted immediately

### Text Pattern Restrictions
- [ ] **Configure text patterns**
  - Setup: Add "spam" and "promo" to blacklist
  - Test: Send "Join my spam channel"
  - Expected: Message deleted
  - Test: Send "Check out this promo"
  - Expected: Message deleted
  - Test: Send "Hello everyone"
  - Expected: Message allowed

### Language/Script Restrictions
- [ ] **Ban non-Latin scripts** (if configured)
  - Test: Send message in Arabic: "مرحبا"
  - Test: Send message in Cyrillic: "Привет"
  - Test: Send message in Chinese: "你好"
  - Expected: Messages deleted based on configuration

### Forward Restrictions
- [ ] **Ban forwards**
  - Action: Forward any message to the group
  - Expected: Forwarded message deleted immediately

- [ ] **Ban channel forwards only**
  - Action: Forward message from channel
  - Expected: Channel forward deleted
  - Action: Forward message from user
  - Expected: User forward allowed

### Rule Scheduling
- [ ] **Test scheduled enforcement**
  - Configure: Links banned only 09:00-17:00
  - Test at 10:00: Send link - should be deleted
  - Test at 20:00: Send link - should be allowed
  - Verify: Time zone settings are respected

## 3. Rate Limiting and Message Limits 📊

### Word Count Limits
- [ ] **Minimum word limit**
  - Configure: Minimum 3 words per message
  - Test: Send "hi" (1 word)
  - Expected: Message deleted
  - Test: Send "hello everyone today" (3 words)
  - Expected: Message allowed

- [ ] **Maximum word limit**
  - Configure: Maximum 50 words per message
  - Test: Send message with 60 words
  - Expected: Message deleted
  - Test: Send message with 40 words
  - Expected: Message allowed

### Rate Limiting
- [ ] **Messages per window limit**
  - Configure: Maximum 5 messages per 1 minute
  - Action: Send 6 messages quickly from same user
  - Expected: 6th message deleted
  - Wait 1 minute, send another message
  - Expected: Message allowed (counter reset)

### Duplicate Detection
- [ ] **Duplicate message detection**
  - Configure: Maximum 3 duplicate messages per 10 minutes
  - Action: Send "test message" 4 times quickly
  - Expected: 4th duplicate deleted
  - Wait 10 minutes, send "test message" again
  - Expected: Message allowed (counter reset)

## 4. Quiet Hours Enforcement 🔇

### Basic Quiet Hours
- [ ] **Configure quiet hours window**
  - Setup: Quiet hours 22:00-06:00
  - Test at 23:00: Send any message as regular user
  - Expected: Message deleted immediately
  - Test at 10:00: Send same message
  - Expected: Message allowed

### Multiple Quiet Windows
- [ ] **Multiple quiet periods**
  - Configure: Window 1: 12:00-13:00, Window 2: 18:00-19:00
  - Test during lunch break (12:30): Message deleted
  - Test during evening break (18:30): Message deleted
  - Test at other times: Messages allowed

### Emergency Lock
- [ ] **Emergency lock activation**
  - Configure: Enable emergency lock
  - Test: Send any message as regular user
  - Expected: All messages blocked regardless of time
  - Verify: Admin messages still allowed

### Admin Exemption
- [ ] **Admin/owner exemption during quiet hours**
  - Setup: Quiet hours active
  - Test: Send message as group admin
  - Expected: Admin message allowed
  - Test: Send message as regular member
  - Expected: Member message deleted

### Quiet Hours Messages
- [ ] **Start/end notifications**
  - Expected: Bot posts message when quiet hours begin
  - Expected: Bot posts message when quiet hours end
  - Verify: Custom quiet hours messages are used (if configured)

## 5. Mandatory Membership Enforcement 👥

### Forced Invite Requirements
- [ ] **Invite requirement enforcement**
  - Configure: Users must invite 2 members before posting
  - Action: New user (0 invites) sends message
  - Expected: Message deleted + invitation requirement notice
  - Action: User who invited 2+ people sends message
  - Expected: Message allowed

### Invite Counter Reset
- [ ] **Reset period enforcement**
  - Configure: Counter resets every 7 days
  - Track: User who met requirement should need to invite again after 7 days

### Required Channel Membership
- [ ] **Mandatory channel membership**
  - Configure: Users must join @requiredchannel
  - Test: User not in channel sends message
  - Expected: Message deleted + channel join requirement notice
  - Test: User who joined channel sends message
  - Expected: Message allowed

### Membership Verification
- [ ] **Real-time membership checking**
  - Action: User joins required channel then immediately sends message
  - Expected: Message allowed (bot should detect membership)
  - Action: User leaves required channel then sends message
  - Expected: Message blocked (bot should detect departure)

## 6. Custom Messages Enforcement 💬

### Template Usage
- [ ] **Welcome message template**
  - Configure: "Welcome {user} to {group}! Please follow our rules."
  - Action: Add user named "John"
  - Expected: "Welcome John to [GroupName]! Please follow our rules."

- [ ] **Warning message template**
  - Configure: "{user}, you violated: {reason}. Penalty: {penalty}"
  - Action: Trigger violation (e.g., send link)
  - Expected: Custom warning with proper substitutions

### Placeholder Substitution
- [ ] **All placeholders working**
  - Test placeholders: {user}, {group}, {reason}, {penalty}, {starttime}, {endtime}
  - Verify: Each placeholder is replaced with actual values
  - Verify: Messages render correctly in Telegram

### Promo Button
- [ ] **Promo button functionality**
  - Configure: Enable promo button with text "Learn More" and URL "https://t.me/channel"
  - Action: Trigger bot message (welcome, warning, etc.)
  - Expected: Message includes inline button
  - Action: Click button
  - Expected: Opens specified URL

### Custom Message Scheduling
- [ ] **Scheduled custom messages**
  - Configure: Custom quiet hours start message
  - Expected: Custom message appears when quiet hours begin
  - Verify: Message uses configured template, not default

## 7. Integration and Edge Cases 🔧

### Multiple Rule Violations
- [ ] **Simultaneous violations**
  - Action: Send message with link + forbidden word + photo
  - Expected: Message deleted + appropriate combined warning
  - Verify: All violations logged correctly

### Admin Override Behavior
- [ ] **Admin exemptions**
  - Test: Group owner/admin violates content rules
  - Expected: Admins exempt from restrictions (configurable)
  - Test: Bot admin commands work during quiet hours

### Database Failures
- [ ] **Graceful degradation**
  - Simulate: Database connection failure
  - Expected: Bot continues operating with default/cached settings
  - Verify: No crashes or infinite error loops

### Performance Under Load
- [ ] **High message volume**
  - Test: Multiple users sending messages rapidly
  - Expected: All rules enforced consistently
  - Verify: No messages slip through due to processing delays

## 8. Logging and Monitoring 📝

### Enforcement Logging
- [ ] **Action logging**
  - Check bot logs for:
    - Rule violations detected
    - Actions taken (delete, warn, restrict)
    - User IDs and timestamps
  - Verify: All enforcement actions are logged

### Error Logging
- [ ] **Error handling**
  - Check logs for:
    - Failed message deletions
    - Permission errors
    - Configuration errors
  - Verify: Errors don't prevent other rules from working

## Testing Results Summary 📊

After completing all tests, document your findings:

### ✅ Working Features
- [ ] List all features that work correctly
- [ ] Note any configuration requirements

### ❌ Issues Found
- [ ] Document any features that don't work
- [ ] Include error messages and reproduction steps
- [ ] Note if issues are configuration-related or bugs

### 🔧 Recommendations
- [ ] Suggest improvements for unclear/inconsistent behavior
- [ ] Recommend additional testing scenarios
- [ ] Document best practices discovered

---

## Notes for Developers 👨‍💻

When implementing fixes for failed tests:

1. **Check the enforcement pipeline**: `bot/processing/banGuards.ts` → `bot/processing/firewallEngine.ts`
2. **Verify database queries**: Settings loading functions in `server/db/groupSettingsRepository.ts`
3. **Test scheduling logic**: Time-based rule enforcement in `isRuleActive()` function
4. **Monitor caching**: Settings are cached - ensure cache invalidation works
5. **Check permissions**: Bot needs appropriate Telegram permissions for each action

Remember: **UI functionality ≠ Real enforcement**. Always test in actual Telegram groups!
