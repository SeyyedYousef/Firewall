# 🔥 Firewall Bot - Complete UX Documentation
## مستندات کامل تجربه کاربری ربات و مینی اپ Firewall

---

# Table of Contents / فهرست مطالب

1. [Bot Overview / معرفی ربات](#1-bot-overview)
2. [Start Flow / جریان شروع](#2-start-flow)
3. [Main Menu / منوی اصلی](#3-main-menu)
4. [Management Panel / پنل مدیریت](#4-management-panel)
5. [Inline Panel / پنل اینلاین](#5-inline-panel)
6. [Lock Management / مدیریت قفل‌ها](#6-lock-management)
7. [User Penalties / مجازات کاربران](#7-user-penalties)
8. [Settings / تنظیمات](#8-settings)
9. [User Panel / پنل کاربر](#9-user-panel)
10. [Word Filter / فیلتر کلمات](#10-word-filter)
11. [Activity Statistics / آمار فعالیت](#11-activity-statistics)
12. [Entertainment & Utilities / سرگرمی و ابزارها](#12-entertainment)
13. [Cleanup Operations / عملیات پاکسازی](#13-cleanup)
14. [Promote & Demote / ارتقا و تنزل](#14-promote-demote)
15. [Welcome System / سیستم خوش‌آمدگویی](#15-welcome-system)
16. [Mandatory Add / اد اجباری](#16-mandatory-add)
17. [Mandatory Membership / عضویت اجباری](#17-mandatory-membership)
18. [Tabchi Detection / تشخیص تبچی](#18-tabchi)
19. [Owner Panel / پنل مالک](#19-owner-panel)
20. [Stars System / سیستم ستاره](#20-stars-system)
21. [Firewall Rules / قوانین فایروال](#21-firewall-rules)
22. [Mini App / مینی اپ](#22-mini-app)
23. [All Bot Messages / تمام پیام‌های ربات](#23-all-messages)
24. [Command Reference / مرجع دستورات](#24-commands)

---

# 1. Bot Overview / معرفی ربات {#1-bot-overview}

## 1.1 Welcome Message / پیام خوش‌آمدگویی

```
Welcome, {user}! 👋

Firewall is your complete group security solution — designed for smart, fast, and secure community management.

✨ What Firewall does:
• 🛡️ Automated spam protection — Block unwanted content instantly
• 🔒 Smart content filtering — Keep your group clean and safe
• 📊 Real-time analytics — Track member activity and engagement
• ⚡ Instant moderation — Automated warnings and restrictions

Getting started is easy:
1️⃣ Add Firewall to your supergroup
2️⃣ Grant admin permissions
3️⃣ Configure your settings in the Mini App

Firewall — Your community, protected. 🔥
```

## 1.2 Technology Stack
- **Framework:** Telegraf.js / Grammy (Strict Typing)
- **Runtime:** Node.js (Latest LTS)
- **Database:** Prisma ORM + PostgreSQL
- **Language:** TypeScript 5.x+ (Strict Mode enabled)
- **Mini App:** React + Vite

---

# 2. Start Flow / جریان شروع {#2-start-flow}

## 2.1 User Sends /start

When a user sends `/start` in private chat:

### 2.1.1 Initial Message Displayed:
```
Welcome, {user}! 👋

Firewall is your complete group security solution — designed for smart, fast, and secure community management.

✨ What Firewall does:
• 🛡️ Automated spam protection — Block unwanted content instantly
• 🔒 Smart content filtering — Keep your group clean and safe
• 📊 Real-time analytics — Track member activity and engagement
• ⚡ Instant moderation — Automated warnings and restrictions

Getting started is easy:
1️⃣ Add Firewall to your supergroup
2️⃣ Grant admin permissions
3️⃣ Configure your settings in the Mini App

Firewall — Your community, protected. 🔥
```

### 2.1.2 Inline Keyboard Buttons:
```
[ ➕ Add to Group ]  ← Opens t.me/bot?startgroup=inpvbtn&admin=permissions

[ ⚙️ Management Panel ] [ 📢 Channel ]

[ ❓ Help ] [ 💬 Info ]
```

## 2.2 Deep Link Handling

### 2.2.1 Referral Tracking
When `/start ref_<userId>` or `/start ref=<userId>`:
- Tracks referral via API
- Awards XP to referrer

### 2.2.2 Incoming Verification
When `/start -<chatId>`:
- Shows math captcha verification
- Generates one-time invite link on success

---

# 3. Main Menu / منوی اصلی {#3-main-menu}

## 3.1 Button Actions

### 3.1.1 "➕ Add to Group"
- Opens Telegram add-to-group dialog
- URL: `t.me/{botUsername}?startgroup=inpvbtn&admin=delete_messages+restrict_members+invite_users`

### 3.1.2 "⚙️ Management Panel"
Shows management question:
```
⚙️ Management Dashboard

Your command center for group management.

✨ What you can do:
• 📊 View real-time analytics and insights
• 🔒 Configure content locks and filters
• ⚡ Monitor automated actions
• 📈 Track member growth and engagement

Open the Mini App to access your full dashboard.

Choose Your Management Style

How would you like to manage your group?

🧩 Mini App Dashboard
• Full visual interface with detailed analytics
• Advanced settings and controls
• Real-time monitoring and insights
• Complete management experience

⌨️ Inline Panel
• Quick actions directly in chat
• Toggle locks and manage lists
• Lightweight and fast
• Perfect for quick adjustments

💡 Choose the option that best fits your workflow!
```

Buttons:
```
[ 🧩 Open Mini App ]  ← Opens WebApp

[ ⌨️ Inline Panel ]

[ 🔙 Back ]
```

### 3.1.3 "📢 Channel"
```
📢 Join Our Official Channel

Stay ahead with Firewall updates!

✨ What you'll get:
• 🚀 New feature announcements
• 🔐 Security tips and best practices
• 🐛 Bug fixes and improvements
• 💡 Pro tips for better moderation

Never miss an important update — join now!
```

### 3.1.4 "❓ Help"
Opens Help Center with all sections.

### 3.1.5 "💬 Info"
```
🚀 About Firewall

Firewall is proudly developed and maintained by @iamSeyyed with dedication to making Telegram communities safer and better.

🙏 Special Thanks:
• Development team for continuous improvements
• Beta testers and early adopters
• Every user who reports bugs and suggests features
• All community admins who trust Firewall

💬 Your feedback matters!
Every suggestion helps us improve. Together, we're building the best moderation bot for Telegram.

Firewall — Built with care, powered by community. 🔥
```

---

# 4. Management Panel / پنل مدیریت {#4-management-panel}

## 4.1 Group Selection Screen
```
📋 Select a group to manage:

Choose a group from the list below to access its inline management panel.
```

Buttons (dynamic per user):
```
[ 📂 Group Name 1 ]
[ 📂 Group Name 2 ]
[ 📂 Group Name 3 ]
[ ◀️ Back ]
```

## 4.2 No Groups Found
```
⚠️ No manageable groups were found for your account.

Make sure the bot is an admin in your group and that you are a group owner or admin.
```

---

# 5. Inline Panel / پنل اینلاین {#5-inline-panel}

## 5.1 Group Menu
```
🛠 Group Management Panel

Group: {Group Title}

Choose a section to manage:
```

Buttons:
```
[ 🔒 Locks ] [ 📋 Lists ]

[ ❓ Help ] [ ⭐️ Upgrade to Premium ]

[ ◀️ Back to Groups ]
```

---

# 6. Lock Management / مدیریت قفل‌ها {#6-lock-management}

## 6.1 Lock Types Overview

### 6.1.1 Page 1: Links & Content Restrictions (10 items)

| ID | Icon | Label | Key | Description |
|----|------|-------|-----|-------------|
| links | 🔗 | Links | banLinks | Blocks all Telegram links (t.me, telegram.me) |
| domains | 🌐 | Domains | banDomains | Blocks all external website URLs |
| usernames | 👤 | Usernames | banUsernames | Blocks @username mentions |
| hashtags | #️⃣ | Hashtags | banHashtags | Blocks messages containing #hashtags |
| latin | 🔤 | Latin | banLatin | Blocks messages with Latin alphabet |
| persian | 🔡 | Persian | banPersian | Blocks messages with Persian/Arabic script |
| text_patterns | 📝 | Text Patterns | banTextPatterns | Blocks plain text messages |
| emojis | 😀 | Emojis | banEmojis | Blocks messages containing emojis |
| forward | ↪️ | Forward | banForward | Blocks all forwarded messages |
| forward_channels | 📢 | Forward Channels | banForwardChannels | Blocks messages forwarded from channels |

### 6.1.2 Page 2: Media & Files (12 items)

| ID | Icon | Label | Key | Description |
|----|------|-------|-----|-------------|
| photos | 🖼️ | Photos | banPhotos | Blocks image uploads |
| videos | 🎬 | Videos | banVideos | Blocks video uploads |
| audio | 🎵 | Audio | banAudio | Blocks audio file uploads |
| voice | 🎤 | Voice | banVoice | Blocks voice notes |
| gif | 🎞️ | GIF | banGif | Blocks animated GIFs |
| stickers | 🎨 | Stickers | banStickers | Blocks sticker messages |
| files | 📁 | Files | banFiles | Blocks document uploads |
| location | 📍 | Location | banLocation | Blocks location sharing |
| apps | 📱 | Apps | banApps | Blocks messages sent via specific apps |
| inline_keyboards | ⌨️ | Inline Keyboards | banInlineKeyboards | Blocks messages with inline buttons |
| emoji_only | 😊 | Emoji Only | banEmojiOnly | Blocks messages with only emojis |
| captionless | 🚫 | Captionless | banCaptionless | Blocks media without captions |

### 6.1.3 Page 3: Bots, Games & Advanced (13 items)

| ID | Icon | Label | Key | Description |
|----|------|-------|-----|-------------|
| bots | 🤖 | Bots | banBots | Blocks messages from bot accounts |
| bot_inviters | 👥 | Bot Inviters | banBotInviters | Bans users who add bots |
| tabchi | 🚫 | Tabchi | banTabchi | Detects and bans spam bots |
| advertiser | 📢 | Advertisers | banAdvertiser | Detects advertising behavior |
| suspicious_bio | 📝 | Suspicious Bio | banSuspiciousBio | Blocks users with suspicious bios |
| phones | 📞 | Phone Numbers | banPhones | Blocks phone numbers |
| games | 🎮 | Games | banGames | Blocks Telegram games |
| polls | 📊 | Polls | banPolls | Blocks poll creation |
| slash_commands | ⚡ | Slash Commands | banSlashCommands | Blocks /command messages |
| cyrillic | 🔠 | Cyrillic | banCyrillic | Blocks Cyrillic alphabet messages |
| chinese | 🈯 | Chinese | banChinese | Blocks Chinese characters |
| user_replies | 💬 | User Replies | banUserReplies | Blocks users from replying |
| cross_replies | 🔀 | Cross Replies | banCrossReplies | Blocks replies to external chats |

## 6.2 Lock Page Display Message
```
🔐 Locks — Group: {Group Title}
Page {current}/{total} — {Page Title}

Tap a lock to toggle it on or off.
```

Page Titles:
- Page 1: "Links & Content"
- Page 2: "Media & Files"
- Page 3: "⚙️ Advanced"

## 6.3 Lock Detail Help Message
```
{icon} {Lock Name}

📝 What does it do?
{whatItDoes}

📌 Example:
{example}

✅ How to Enable:
• Inline: Settings → Locks → {Lock Name}
• Command: !lock {commandAlias}

❌ How to Disable:
• Command: !unlock {commandAlias}

📱 Mini App Path:
{miniAppPath}

💡 When to Use:
{whenToUse}

⚠️ Limitations:
{limitations}
```

---

# 7. User Penalties / مجازات کاربران {#7-user-penalties}

## 7.1 Penalty Types

### 7.1.1 Ban
```
🚫 Ban

📝 What does it do?
Permanently bans a user from the group. The user cannot rejoin until unbanned.

📌 Example:
Reply to a spammer's message and use the ban command

✅ Command:
!Ban

↩️ To Undo:
!Unban [user_id]

📋 Requires Reply: Yes - reply to user's message

💡 When to Use:
For severe violations, repeat offenders, or spammers

📝 Notes:
The banned user's message and your command are deleted.
```

### 7.1.2 Ban Plus
```
⛔ Ban Plus

📝 What does it do?
Bans the user AND deletes all their recent messages from the group.

📌 Example:
Reply to spam messages to ban and clean up their content

✅ Command:
!Ban+

↩️ To Undo:
!Unban [user_id]

📋 Requires Reply: Yes

💡 When to Use:
When you need to remove both the user and their spam content

📝 Notes:
Deletes recent messages from the banned user.
```

### 7.1.3 Kick
```
👢 Kick

📝 What does it do?
Removes a user from the group but they can rejoin using an invite link.

✅ Command:
!Kick

📋 Requires Reply: Yes

💡 When to Use:
For minor violations, when you don't want to permanently ban

📝 Notes:
User can rejoin via invite link.
```

### 7.1.4 Mute
```
🔇 Mute

📝 What does it do?
Permanently restricts a user from sending any messages in the group.

✅ Command:
!Mute

↩️ To Undo:
!Unmute (reply)

📋 Requires Reply: Yes

💡 When to Use:
For users who disrupt discussions but don't deserve a ban

📝 Notes:
User stays in group but cannot send messages.
```

### 7.1.5 Temporary Mute
```
⏱️ Temporary Mute

📝 What does it do?
Mutes a user for a specified duration. Auto-unmutes when time expires.

📌 Example:
!Mute 24 — mutes for 24 hours

✅ Command:
!Mute <hours>

↩️ To Undo:
!Unmute (reply)

📋 Requires Reply: Yes

💡 When to Use:
Give users time to cool down before returning

📝 Notes:
Specify duration in hours (e.g., 24 = 24 hours).
```

### 7.1.6 Warning
```
⚠️ Warning

📝 What does it do?
Issues a formal warning. Warnings accumulate and can trigger auto-actions.

✅ Command:
!Warn

↩️ To Undo:
!Reset (clears warnings)

📋 Requires Reply: Yes

💡 When to Use:
For first-time or minor violations

📝 Notes:
Configure auto-mute/ban after X warnings in Advanced settings.
```

---

# 8. Settings / تنظیمات {#8-settings}

## 8.1 Settings Categories

### 8.1.1 View Settings
```
⚙️ View Settings

View all your group's current settings, including active locks, verification status, and other configurations.

📝 Commands:
› !Settings
› !Status
› !Info
```

### 8.1.2 Media Lock
```
🖼️ Media Lock

Control which types of media can be sent. Lock photos, videos, GIFs, stickers, voice messages, and other media types.

📝 Commands:
› !Lock photo
› !Lock video
› !Lock sticker
› !Lock voice
› !Lock gif
› !Unlock [type]
```

### 8.1.3 Word/Character Limits
```
📏 Word/Character Limits

Set minimum and maximum character/word limits for messages. Messages outside these limits are automatically deleted.

📝 Commands:
› !MaxWords <count>
› !MinWords <count>
```

### 8.1.4 Strict Mode
```
🔐 Strict Mode

When enabled, rules apply to everyone including admins. When disabled, admins are exempt from most restrictions.

📝 Commands:
› !AdminLock on
› !AdminLock off
```

### 8.1.5 Auto Lock (Silence)
```
🔒 Auto Lock (Silence)

Automatically lock the group at specified times. Non-admin messages are deleted during locked periods.

📝 Commands:
› !Silence1 from <HH:MM> to <HH:MM>
› !Silence2 ...
› !Silence3 ...
› !ClearSilence
```

### 8.1.6 Group Lock
```
🚨 Group Lock

Emergency lock the entire group. Only admins can send messages. Useful for spam attacks or announcements.

📝 Commands:
› !LockGroup
› !UnlockGroup
```

### 8.1.7 Flood Control
```
🌊 Flood Control

Prevent message flooding. Users sending too many messages in a short time are automatically muted.

📝 Commands:
› !MsgLimit <count>
```

### 8.1.8 Warning Configuration
```
⚠️ Warning Configuration

Configure automatic warnings and thresholds.

📝 Commands:
› !Warning on/off
› !AutoWarn on/off
› !WarnThreshold <count>
› !WarnRetention <days>
```

### 8.1.9 Public Commands
```
📢 Public Commands

Toggle whether regular users can use bot commands.

📝 Commands:
› !PublicCmds on
› !PublicCmds off
```

### 8.1.10 Service Messages
```
👋 Service Messages

Toggle join/leave messages in the group.

📝 Commands:
› !JoinLeave on
› !JoinLeave off
```

### 8.1.11 Auto Delete
```
🗑️ Auto Delete

Automatically delete bot responses after a delay to keep chat clean.

📝 Commands:
› !AutoDelete on/off
› !AutoDelDelay <minutes>
```

### 8.1.12 Bot Configuration
```
🔧 Bot Configuration

Reload bot configuration or check subscription.

📝 Commands:
› !Reload
› !Credit
```

---

# 9. User Panel / پنل کاربر {#9-user-panel}

## 9.1 User Panel Main View
```
◄ User Status:

⊹ In Group: {userStatus}
⊹ In Bot: {botRole}

⊹ User Name: {userName}
⊹ Numeric ID: {userId}
⊹ Username: {username}
⊹ Nickname: {nickname}
⊹ Global Rank: None

⊹ Add Count: 0
⊹ Today's Messages: 0
⊹ Message Rank: None

⊹ Banned: {Yes/No}
⊹ Muted: {Yes/No}
⊹ Tabchi: No
⊹ Warning Count: {count}

This panel is specific to the selected user
and does not affect group or other user settings.
```

Buttons:
```
[ • Locks & Restrictions ]
[ • Punishments & Release ]
[ • Promote & Demote ]
[ • Confirm & Close ]
```

## 9.2 User Lock States

Each lock has 3 states:
- **✗ (Default)**: Uses the group's general settings
- **Open**: Content is allowed for this user even if locked in group settings
- **🔐 (Locked)**: Content is blocked for this user even if allowed in group settings

## 9.3 User Panel Lock Items

| ID | Key | Label |
|----|-----|-------|
| hyperlink | banLinks | Hyperlink |
| link | banDomains | Link |
| hashtag | banHashtags | Hashtag |
| username | banUsernames | Username |
| persian | banPersian | Persian |
| english | banLatin | English |
| emoji_single | banEmojiOnly | Emoji Single |
| file | banFiles | File |
| inline_keyboard | banInlineKeyboards | Inline Keyboard |
| forward | banForward | Forward |
| media_edit | banMediaEdit | Media Edit |
| message_edit | banMessageEdit | Message Edit |
| voice | banVoice | Voice |
| video | banVideos | Video |
| photo | banPhotos | Photo |
| animated_sticker | banAnimatedStickers | Animated Sticker |
| sticker | banStickers | Sticker |
| gif | banGif | GIF |
| game | banGames | Game |
| music | banAudio | Music |
| selfie_video | banVideoNotes | Selfie Video |

## 9.4 User Panel Commands
```
!userpanel - Open user panel (reply to user)
!userpanel @username - By username
!userpanel 123456789 - By numeric ID

Aliases: !up, !panel
```

---

# 10. Word Filter / فیلتر کلمات {#10-word-filter}

## 10.1 Single Filtering
```
➊ Single Filtering

Filter words one at a time with optional punishments

Block specific words in the group. When a filtered word is sent, the bot deletes the message. Optionally, set a punishment for the sender (warn, ban, or mute).

📝 Commands:
› !AddFilter <word>
› !FilterWarn <word>
› !FilterBan <word>
› !FilterMute <word>
› !RemFilter <word>
› !FilterList
› !CleanFilterList

💡 Examples:
• Filter the word 'spam'
  ⮨ !AddFilter spam
• Filter and warn sender
  ⮨ !FilterWarn advertisement
```

## 10.2 Continuous Filtering
```
➋ Continuous Filtering

Enter filter mode to add multiple words quickly

Efficient method for filtering multiple words at once. After sending the command, all words you type will be added to the filter list until you exit the mode.

📝 Commands:
› !Filter

💡 Examples:
• Start continuous filter mode
  ⮨ !Filter
```

## 10.3 Private Filtering
```
➌ Private Filtering

Filter words privately via bot panel

Manage filtered words without exposing commands in the group. Send the command in the group, then go to the bot's private chat and navigate to: Lists → Filter List.

📝 Commands:
› !PanelPV

💡 Examples:
• Open the private panel link
  ⮨ !PanelPV
```

---

# 11. Activity Statistics / آمار فعالیت {#11-activity-statistics}

## 11.1 Statistics Commands

### 11.1.1 Group Stats Overview
```
📊 Group Stats Overview

View the overall chat and add statistics for all users in the group

Using this feature, group admins can view comprehensive statistics about user activity including chat messages and adds (user invitations). The bot displays a ranked list of users based on their contribution to the group.

📝 Commands:
› !Stats
› .Stats
```

### 11.1.2 Add Stats
```
➕ Add Stats

View statistics for user invitations (adds) only

📝 Commands:
› !AddStats
› .AddStats
```

### 11.1.3 Rank Stats
```
👑 Rank Stats

View statistics for admins and ranked members only

📝 Commands:
› !RankStats
› .RankStats
```

### 11.1.4 Custom Member Count
```
🔢 Custom Member Count

View statistics for a specific number of top members

📝 Commands:
› !Stats <N> mem

💡 Examples:
• View top 30 members
  ⮨ !Stats 30 mem
```

### 11.1.5 Total Stats
```
📈 Total Stats

View all-time cumulative statistics for the group

📝 Commands:
› !TotalStats
› .TotalStats
```

### 11.1.6 Weekly Stats
```
📅 Weekly Stats

View statistics for the current week only

📝 Commands:
› !WeeklyStats
› .WeeklyStats
```

### 11.1.7 User Stats
```
👤 User Stats

View detailed statistics for a specific user

Reply to a user's message with this command to view their last 7 days of activity statistics.

📝 Commands:
› !UserStats
› .UserStats
```

### 11.1.8 Auto Stats Schedule
```
⏰ Auto Stats Schedule

Configure automatic stats posting at scheduled times

📝 Commands:
› !SetAutoStats
› !RemAutoStats
```

### 11.1.9 Stats Status
```
ℹ️ Stats Status

View current auto stats configuration

📝 Commands:
› !StatsStatus
› .StatsStatus
```

---

# 12. Entertainment & Utilities / سرگرمی و ابزارها {#12-entertainment}

## 12.1 Features List

| ID | Icon | Name | Command | Description |
|----|------|------|---------|-------------|
| font | 🔤 | Stylish Fonts | !Font <text> | Convert text to various stylish fonts |
| time | 🕐 | Current Time | !Time | Display the current time |
| echo | 📢 | Echo Message | !Echo <text> | Repeat a message through the bot |
| news | 📰 | Latest News | !News | Get latest news headlines |
| fortune | 🔮 | Fortune | !Fortune | Get a random fortune or horoscope |
| bio | 📝 | User Bio | !Bio / !SetBio | Set or view user biography |
| calendar | 📅 | Calendar | !Calendar / !Date | Display current date |
| sticker | 🎨 | Sticker Maker | !Sticker | Create custom stickers |
| azan | 🕌 | Prayer Times | !Azan | Get Islamic prayer times |
| joke | 😂 | Random Joke | !Joke | Get a random joke |
| poetry | 📜 | Random Poetry | !Poetry | Get a random poem |
| translate | 🌐 | Translation | !Translate <lang> <text> | Translate text |
| id | 🆔 | User/Chat ID | !ID | Get user or chat ID |
| currency | 💰 | Currency Rates | !Currency | Get live currency rates |
| info | ℹ️ | User Info | !Info | Get user information |
| joindate | 📆 | Join Date | !JoinDate | View when user joined |
| origin | 🔍 | User Origin | !Origin | Check how user joined |
| tag | 🏷️ | Tag Users | !Tag all / !Tag admins | Tag multiple users |
| nickname | 👤 | Nickname | !SetNick / !Nick | Set or view nicknames |
| profile | 👥 | User Profile | !Profile | View detailed user profile |
| meaning | 📖 | Word Meaning | !Meaning <word> | Get word definition |
| rules | 📋 | Group Rules | !Rules / !SetRules | Display or set rules |
| pin | 📌 | Pin Message | !Pin / !Unpin | Pin a message |
| getlink | 🔗 | Get Invite Link | !GetLink | Get group's invite link |
| weather | 🌤️ | Weather | !Weather <city> | Get weather information |
| setphoto | 🖼️ | Photo Settings | !SetPhoto | Set group photo |

---

# 13. Cleanup Operations / عملیات پاکسازی {#13-cleanup}

## 13.1 Cleanup Categories

| ID | Icon | Name | Command | Description |
|----|------|------|---------|-------------|
| messages | 💬 | Messages | !Del <count> | Delete a specified number of messages |
| bans | 🚫 | Ban List | !CleanBans | Remove all banned users from ban list |
| warns | ⚠️ | Warning List | !CleanWarns | Clear all warning records |
| mutes | 🔇 | Mute List | !CleanMutes | Unmute all muted users |
| filters | 🚷 | Filter Words | !CleanFilters | Remove all filtered keywords |
| exempts | ✅ | Exempt Users | !CleanExempts | Remove all exempt users |
| modlist | 👤 | Admin Users | !CleanModList | Demote all bot-assigned managers |
| vips | ⭐ | VIP Users | !CleanVIPs | Remove all VIP privileges |
| nicknames | 📛 | Nicknames | !CleanNicknames | Clear all stored nicknames |
| blocks | 🚫 | Blocked Users | !CleanBlocks | Unblock all users |
| restricts | 🔒 | Restricted Users | !CleanRestricts | Remove restrictions |
| bots | 🤖 | Bots | !CleanBots | Remove all bots (except Firewall) |
| fakes | 👻 | Fake Accounts | !CleanFakes | Kick fake/suspicious accounts |
| deleted | 🗑️ | Deleted Accounts | !CleanDeleted | Remove deleted (ghost) accounts |

---

# 14. Promote & Demote / ارتقا و تنزل {#14-promote-demote}

## 14.1 Rank Types

### 14.1.1 Owner
```
👑 Owner

Highest access level in the group. Owners can change all settings without restrictions and promote/demote users (except other owners).

📝 Commands:
› !SetOwner — Set Owner
› !RemOwner — Remove Owner
› !OwnerList — Owner List
› !CleanOwnerList — Clean Owner List

💡 Note: Commands work with reply, @username, or numeric ID.
```

### 14.1.2 Manager
```
👤 Manager

Managers can change most settings and restrict/ban regular users. Owners can customize each manager's permissions.

📝 Commands:
› !Promote — Promote
› !Demote — Demote
› !ModList — Mod List
› !CleanModList — Clean Mod List

💡 Note: Use !Promote [hours] for temporary promotion.
```

### 14.1.3 VIP/Special
```
⭐ VIP/Special

VIP members bypass all content restrictions. Their messages are never deleted or restricted by the bot.

📝 Commands:
› !VIP — Add VIP
› !RemVIP — Remove VIP
› !VIPList — VIP List

💡 Note: Commands work with reply, @username, or numeric ID.
```

---

# 15. Welcome System / سیستم خوش‌آمدگویی {#15-welcome-system}

## 15.1 Default Welcome Message
```
Welcome to {group}, {user}! 👋

We're excited to have you here. Please take a moment to read our group rules and enjoy your stay!

💡 This group is protected by Firewall for your safety.
```

## 15.2 Available Variables
```
⇝ !mention - User mention (clickable)
⇝ !firstname - User's first name
⇝ !lastname - User's last name
⇝ !username - User's @username
⇝ !userid - User's numeric ID
⇝ !grouplink - Group invite link
⇝ !grouprules - Group rules
⇝ !groupname - Group name
⇝ !date - Current date
⇝ !time - Current time
⇝ !emoji - Random emoji
```

## 15.3 Commands
```
!welcome on - Enable welcome message
!welcome off - Disable welcome message
!setwelcome - Set welcome message text
!getwelcome - View current welcome message
!resetwelcome - Reset to default
!setwelcometime 30 - Auto-delete after 30 sec
!setwelcomemedia - Set welcome media (reply to media)
```

---

# 16. Mandatory Add / اد اجباری {#16-mandatory-add}

## 16.1 Configuration
```
⚙️ Configuration

Commands to enable/disable the feature and set the number of invites required.

📝 Commands:
› !ForceAdd on
› !ForceAdd off
› !SetForceAdd <count>
› !ForceAddTime <min>

💡 Examples:
• Require 3 invites
  ⮨ !SetForceAdd 3
• Allow 5 minutes before restricting
  ⮨ !ForceAddTime 5
```

## 16.2 Message Customization
```
📝 Message Customization

Set a custom message to be displayed when a user tries to speak without meeting invite requirements.

📝 Commands:
› !SetForceAddText
› !DelForceAddText
```

## 16.3 Management
```
📊 Management & Info

View status, check user invites, and clean up records.

📝 Commands:
› !ForceAddStatus
› !ForceAddInfo (reply)
› !CleanForceAdd
```

---

# 17. Mandatory Membership / عضویت اجباری {#17-mandatory-membership}

## 17.1 Configuration
```
⚙️ Configuration

Commands to enable/disable mandatory channel membership.

📝 Commands:
› !ForceJoin on
› !ForceJoin off
› !ForceJoinStatus
```

## 17.2 Message Customization
```
📝 Message Customization

Set the message shown to users who haven't joined the channel.

📝 Commands:
› !SetForceJoinText <text>
› !DelForceJoinText

💡 Examples:
• Set message
  ⮨ !SetForceJoinText Please join our channel first!
```

---

# 18. Tabchi Detection / تشخیص تبچی {#18-tabchi}

## 18.1 Understanding Tabchi
```
🚫 Understanding & Combating Tabchi (Spam Bots)

Tabchi refers to fraudulent bot accounts or user accounts that join groups primarily for advertising purposes.

📋 Types of Tabchi:

➊ Advertisers
These tabchis send links, files, and promotional messages. If you check your busy group's activity, you'll see many ads being sent and deleted by the bot. 99% of these ads are from tabchi accounts.

➋ Bot Adders
After joining your group, these tabchis add other bots for advertising and member recruitment purposes.

➌ Member Recruiters
These tabchis use fake profiles, especially with female names and photos, to lure users into private chats and then redirect them to promotional groups or channels.
```

## 18.2 Prevention Methods
```
🛡️ Prevention Methods:

➊ Enable Tabchi Lock
By activating the tabchi lock, entry and activity of tabchis in your group will be severely restricted.

➋ Restrict Membership (Private Groups)
For private groups, limit membership to invite links to prevent bot adders from adding their bots.

➌ Cross-Group Detection
Our AI system tracks user behavior across all groups. If a user triggers violations in 3+ groups, they are automatically flagged as tabchi.
```

## 18.3 Commands
```
📝 Commands:

!lock tabchi - Enable tabchi detection
!lock advertiser - Enable advertiser detection
!lock bio - Enable suspicious bio detection

!unlock tabchi - Disable tabchi detection
!unlock advertiser - Disable advertiser detection
!unlock bio - Disable suspicious bio detection

🔧 Management Commands:

!untabchi - Remove replied user from tabchi list
!tabchiwhitelist - Add user to permanent whitelist
!tabchiinfo - Check tabchi info for replied user
```

---

# 19. Owner Panel / پنل مالک {#19-owner-panel}

## 19.1 Owner Panel Intro
```
🎛️ Owner Control Panel

Welcome to your private management center. From here you can control all aspects of your Firewall bot:

• 👥 Manage administrators
• 🏢 Control groups & billing
• 🎁 Generate credit codes
• 📢 Send broadcasts
• ⚙️ Configure global settings
```

## 19.2 Owner Panel Buttons
```
[ 👥 Panel Administrators ]
[ 🏢 Group Management ]
[ 💳 Credit Adjustment ]
[ 🎁 Generate Credit Codes ]
[ ⭐ Reconcile Stars ]
[ 📢 Broadcast Messages ]
[ 📣 Send Ad Banner (Free Groups) ]
[ 📊 Global Statistics ]
[ ⚙️ Global Configuration ]
[ 🛡️ Firewall Rules ]
[ 📋 Daily Task Channel ]
[ 🎨 Promo Slider ]
[ 🚫 User Ban Management ]
[ 🔴 Reset Bot Completely ]
[ Back ] [ Back to Main Menu ]
```

## 19.3 Owner Panel Messages

### Panel Administrators
```
👥 Panel Administrators

Manage who has access to your bot's dashboard. Choose an action below:
```

### Add Admin
```
➕ Add Panel Administrator

Send the numeric Telegram user ID of the person you want to promote to admin.

Example: 123456789
```

### Remove Admin
```
➖ Remove Panel Administrator

Send the numeric Telegram user ID of the admin you want to remove from the panel.

Example: 123456789
```

### Group Management
```
🏢 Group Management

Enter the target chat ID to open the management session for that specific group.

Example: -1001234567890
```

### Credit Adjustment
```
💳 Manual Credit Adjustment

Choose whether you want to increase or decrease the credit balance for a specific group:
```

### Increase Credit
```
➕ Increase Group Credit

Send the chat ID and the amount to add, separated by a space.

Example: -1001234567890 7

💡 This will add 7 days of credit to the group.
```

### Decrease Credit
```
➖ Decrease Group Credit

Send the chat ID and the amount to deduct, separated by a space.

Example: -1001234567890 3

⚠️ This will remove 3 days of credit from the group.
```

### Broadcast
```
📢 Broadcast Message

Send the message you want to deliver to all active groups. The bot will ask for confirmation before broadcasting.

💡 Use HTML formatting for better presentation
```

### Credit Codes
```
🎁 Credit Code Management

Generate and manage credit codes for your users. These codes can be used to add days to group subscriptions:
```

### Create Credit Code
```
➕ Create New Credit Code

Send the details in this format:
DAYS MAX_USES [EXPIRES_IN_DAYS]

Examples:
• 7 100 - 7 days, 100 uses, no expiry
• 30 50 90 - 30 days, 50 uses, expires in 90 days
• 14 1 - 14 days, single use, no expiry
```

### Promo Slider
```
🎨 Promo Slider Control

Manage the slides displayed in the dashboard carousel.

Recommended image size: 960x360px
```

### Add Slide
```
📸 Upload Promo Image

Send a high-quality photo (recommended 960x360px).

The bot will crop and compress it automatically.
```

### Slide Link
```
🔗 Add Slide Link

Great! Now send the HTTPS link that should open when users tap the slide.

Make sure the link is accessible and relevant.
```

### Daily Task
```
📋 Daily Task Channel

Share a channel mission in the daily checklist.

⚠️ Make sure the bot is already an admin before you send the invite link.
```

### Ban Management
```
🚫 Ban List Management

Block or unblock users from accessing the panel.

Banned users cannot access any panel features.
```

### Global Configuration
```
⚙️ Global Configuration

Select the parameter you want to configure:
```

Configuration options:
- Set Free Trial Days
- Set Monthly Stars
- Edit Welcome Messages
- Edit GPID Help Text
- Edit Button Labels
- Edit Channel Text
- Edit Info and Commands Text

---

# 20. Stars System / سیستم ستاره {#20-stars-system}

## 20.1 Stars Overview API
```
GET /api/stars/overview
```

Response includes:
- Total stars balance
- Transactions history
- Active plans

## 20.2 Stars Purchase
```
POST /api/stars/purchase
{
  "groupId": "string",
  "planId": "string",
  "metadata": {}
}
```

## 20.3 Stars Gift
```
POST /api/stars/gift
{
  "planId": "string",
  "group": {
    "id": "string",
    "title": "string",
    "membersCount": number
  }
}
```

## 20.4 Stars Wallet
```
GET /api/stars/wallet?limit=20
```

## 20.5 Refund Transaction
```
POST /api/stars/transactions/:id/refund
{
  "reason": "string"
}
```

---

# 21. Firewall Rules / قوانین فایروال {#21-firewall-rules}

## 21.1 Firewall Rule Structure
```json
{
  "name": "Block spam links",
  "scope": "global",
  "enabled": true,
  "priority": 100,
  "matchAll": false,
  "severity": 1,
  "conditions": [
    {
      "kind": "link_domain",
      "domains": ["spam.example", "bad.example"]
    }
  ],
  "actions": [
    { "kind": "delete_message" },
    { "kind": "warn", "message": "Links from spam domains are not allowed." }
  ],
  "escalation": {
    "steps": [
      {
        "threshold": 3,
        "windowSeconds": 600,
        "actions": [{ "kind": "mute", "durationSeconds": 3600 }]
      }
    ]
  }
}
```

## 21.2 Firewall Messages
```
Firewall Rule Manager
Create, review, and adjust automated moderation rules. Rules run in order of priority (lowest first).
```

```
Rule: {name}
Scope: {Global/Group}
Status: {Enabled/Disabled}
Priority: {number}
Match all conditions: {Yes/No}
Severity: {number}

Conditions:
  1. {...}

Actions:
  1. {...}

Escalation steps:
  1. threshold {n} within {s}s -> {actions}
```

---

# 22. Mini App / مینی اپ {#22-mini-app}

## 22.1 Mini App Pages

| Path | Component | Description |
|------|-----------|-------------|
| /dashboard | Dashboard | Main dashboard with overview |
| /groups | GroupDashboard | List of managed groups |
| /groups/:id/settings | GroupSettings | Group-specific settings |
| /groups/:id/analytics | GroupAnalytics | Group analytics and stats |
| /broadcasts | Broadcasts | Broadcast message management |
| /giveaways | Giveaways | Giveaway management |
| /missions | Missions | Daily missions and tasks |
| /profile | Profile | User profile |
| /stars | Stars | Stars system and purchases |
| /promo-slides | PromoSlides | Promo slider management |
| /ton-connect | TONConnectPage | TON wallet connection |

## 22.2 Mini App Features

### Dashboard
- Groups overview
- Quick stats
- Recent activity
- Promo slider

### Group Management
- Lock toggles
- Settings configuration
- Member management
- Analytics dashboard

### Stars System
- Purchase plans
- Gift stars
- Transaction history
- Wallet management

### Missions
- Daily tasks
- XP rewards
- Referral tracking
- Level progression

---

# 23. All Bot Messages / تمام پیام‌های ربات {#23-all-messages}

## 23.1 System Messages

### Start Message
```
Welcome, {user}! 👋

Firewall is your complete group security solution — designed for smart, fast, and secure community management.

✨ What Firewall does:
• 🛡️ Automated spam protection — Block unwanted content instantly
• 🔒 Smart content filtering — Keep your group clean and safe
• 📊 Real-time analytics — Track member activity and engagement
• ⚡ Instant moderation — Automated warnings and restrictions

Getting started is easy:
1️⃣ Add Firewall to your supergroup
2️⃣ Grant admin permissions
3️⃣ Configure your settings in the Mini App

Firewall — Your community, protected. 🔥
```

### Welcome Message
```
Welcome to {group}, {user}! 👋

We're excited to have you here. Please take a moment to read our group rules and enjoy your stay!

💡 This group is protected by Firewall for your safety.
```

### Management Panel
```
⚙️ Management Dashboard

Your command center for group management.

✨ What you can do:
• 📊 View real-time analytics and insights
• 🔒 Configure content locks and filters
• ⚡ Monitor automated actions
• 📈 Track member growth and engagement

Open the Mini App to access your full dashboard.
```

### Management Question
```
Choose Your Management Style

How would you like to manage your group?

🧩 Mini App Dashboard
• Full visual interface with detailed analytics
• Advanced settings and controls
• Real-time monitoring and insights
• Complete management experience

⌨️ Inline Panel
• Quick actions directly in chat
• Toggle locks and manage lists
• Lightweight and fast
• Perfect for quick adjustments

💡 Choose the option that best fits your workflow!
```

### Channel
```
📢 Join Our Official Channel

Stay ahead with Firewall updates!

✨ What you'll get:
• 🚀 New feature announcements
• 🔐 Security tips and best practices
• 🐛 Bug fixes and improvements
• 💡 Pro tips for better moderation

Never miss an important update — join now!
```

### Info
```
🚀 About Firewall

Firewall is proudly developed and maintained by @iamSeyyed with dedication to making Telegram communities safer and better.

🙏 Special Thanks:
• Development team for continuous improvements
• Beta testers and early adopters
• Every user who reports bugs and suggests features
• All community admins who trust Firewall

💬 Your feedback matters!
Every suggestion helps us improve. Together, we're building the best moderation bot for Telegram.

Firewall — Built with care, powered by community. 🔥
```

### Inline Panel
```
🛠 Inline Panel

Your quick-access management toolkit!

✨ Available Features:
• 🔒 Toggle content locks on/off
• 📋 Manage filters and whitelists
• 👥 View group statistics
• ❓ Access help and support

Select a group below to get started!
```

## 23.2 Firewall Rule Messages
```
✅ Rule deleted successfully.
✅ Rule added successfully.
✅ Rule updated successfully.
✅ Firewall rule enabled.
✅ Firewall rule disabled.
❌ Rule not found.
❌ Invalid JSON format. Please check your input.
❌ Ban setting not found.
```

## 23.3 Verification Messages

### Math Captcha
```
👋 Hello {userName}!

To verify your membership request, please answer the following question:

What is {a} + {b}?
```

### Captcha Success
```
✅ Your request has been approved!

You can join the group using the temporary link below.
This link can only be used once and will expire after that.

🔗 Temporary Link:
{inviteLink}
```

### Captcha Failure
```
❌ Incorrect answer. Please try again.
```

### Session Expired
```
Session expired. Please try again.
```

## 23.4 Access Control Messages
```
Unable to verify your account.
You are blocked from using the panel.
Only the bot owner or designated panel admins can access this panel.
To see the management menu, open a private chat with the bot and send /start.
Open a private chat with the bot to access the owner panel.
```

---

# 24. Command Reference / مرجع دستورات {#24-commands}

## 24.1 User Moderation
```
!ban <hours>      — Ban user (reply). 1=1 hour, 1000=Permanent
!ban+             — Ban and delete all recent messages (reply)
!mute <hours>     — Mute user (reply)
!unmute           — Unmute user (reply)
!kick             — Kick user (reply)
!warn             — Issue warning (reply)
!reset            — Reset warnings (reply)
```

## 24.2 Credit & Subscription
```
!charge           — Renew credit
!credit           — Check expiration
```

## 24.3 Content Locks
```
!lock <type>      — Enable restriction
!unlock <type>    — Disable restriction

Types: link, username, site, hashtag, text, forward, channelforward,
       photo, video, sticker, location, phone, voice, file, app,
       gif, poll, slash, captionless, emojionly, emoji, game,
       english, persian, reply, crossreply, bot, botinviter,
       tabchi, advertiser, bio
```

## 24.4 Whitelist
```
!whitelist        — Add user to whitelist (reply)
!unwhitelist      — Remove from whitelist (reply)
!clearwhitelist   — Clear all whitelist
!vip              — Add VIP (bypasses all rules)
!remvip           — Remove VIP
!viplist          — List VIP members
```

## 24.5 Message Limits
```
!msglimit <n>     — Max messages per window
!msgwindow <min>  — Window duration in minutes
!duplicate <n>    — Max duplicate messages
!dupwindow <min>  — Duplicate window in minutes
!minwords <n>     — Minimum words per message
!maxwords <n>     — Maximum words per message
```

## 24.6 Word Filter
```
!addfilter <word> — Filter a word
!filterwarn <word> — Filter and warn sender
!filterban <word>  — Filter and ban sender
!filtermute <word> — Filter and mute sender
!remfilter <word>  — Remove from filter
!filterlist        — Show filter list
!cleanfilterlist   — Clear all filters
!filter            — Enter continuous filter mode
```

## 24.7 Quiet Hours
```
!silence1 from HH:MM to HH:MM  — Set quiet hours slot 1
!silence2 from HH:MM to HH:MM  — Set quiet hours slot 2 (Premium)
!silence3 from HH:MM to HH:MM  — Set quiet hours slot 3 (Premium)
!silence1 off      — Disable slot 1
!clearsilence      — Remove all quiet hours
```

## 24.8 Group Control
```
!lockgroup        — Emergency lock group
!unlockgroup      — Unlock group
!purge <count>    — Delete last N messages
!del <count>      — Delete last N messages
```

## 24.9 Settings
```
!welcome on/off   — Toggle welcome message
!warning on/off   — Toggle warning messages
!autowarn on/off  — Toggle auto-warning
!warnthreshold <n> — Max warnings before action
!warnretention <d> — Days to keep warnings
!autodelete on/off — Toggle auto-delete bot messages
!autodeletedelay <min> — Delay before deletion
!joinleave on/off — Toggle join/leave messages
!adminlock on/off — Apply rules to admins
!publiccmds on/off — Toggle public commands
```

## 24.10 Ranks & Promotion
```
!setowner         — Set owner (reply/@username/ID)
!remowner         — Remove owner
!ownerlist        — List owners
!cleanownerlist   — Clean owner list
!promote          — Promote to manager
!demote           — Demote from manager
!modlist          — List managers
!cleanmodlist     — Clean mod list
```

## 24.11 Statistics
```
!stats            — View group statistics
!addstats         — View add statistics
!rankstats        — View ranked member stats
!stats <n> mem    — View top N members
!totalstats       — All-time statistics
!weeklystats      — Weekly statistics
!userstats        — User stats (reply)
!setautostats     — Set auto stats schedule
!remautostats     — Remove auto stats
!statsstatus      — View auto stats config
```

## 24.12 Entertainment & Utilities
```
!font <text>      — Convert to stylish fonts
!time             — Current time
!echo <text>      — Echo message
!news             — Latest news
!fortune          — Random fortune
!bio              — View bio
!setbio <text>    — Set bio
!calendar         — Current date
!date             — Current date
!sticker          — Make sticker (reply to image)
!azan             — Prayer times
!joke             — Random joke
!poetry           — Random poem
!translate <lang> <text> — Translate text
!id               — Get ID
!info             — User info
!whoIs            — User info
!joindate         — Join date
!origin           — How user joined
!tag all          — Tag all members
!tag admins       — Tag admins
!setnick <name>   — Set nickname
!nick             — View nickname
!remnick          — Remove nickname
!profile          — User profile
!meaning <word>   — Word definition
!rules            — View rules
!setrules <text>  — Set rules
!pin              — Pin message
!unpin            — Unpin message
!getlink          — Get invite link
!weather <city>   — Weather info
!setphoto         — Set group photo
!currency         — Currency rates
```

## 24.13 Force Add & Join
```
!forceadd on/off          — Toggle force add
!setforceadd <n>          — Required invites
!forceaddtime <min>       — Grace period
!setforceaddtext          — Custom message
!delforceaddtext          — Delete message
!forceaddstatus           — Check status
!forceaddinfo             — User info (reply)
!cleanforceadd            — Clean records

!forcejoin on/off         — Toggle force join
!setforcejointext <text>  — Custom message
!delforcejointext         — Delete message
!forcejoinstatus          — Check status
```

## 24.14 Cleanup
```
!cleanbans        — Clear ban list
!cleanwarns       — Clear warnings
!cleanmutes       — Clear mute list
!cleanfilters     — Clear filters
!cleanexempts     — Clear exempt list
!cleanmodlist     — Clear mod list
!cleanvips        — Clear VIP list
!cleannicknames   — Clear nicknames
!cleanblocks      — Clear block list
!cleanrestricts   — Clear restrictions
!cleanbots        — Remove all bots
!cleanfakes       — Kick fake accounts
!cleandeleted     — Remove deleted accounts
```

## 24.15 User Panel
```
!userpanel        — Open user panel (reply)
!userpanel @user  — By username
!userpanel 123456 — By ID
!up               — Alias
!panel            — Alias
```

## 24.16 Tabchi Management
```
!untabchi         — Remove from tabchi list (reply)
!tabchiwhitelist  — Add to permanent whitelist
!tabchiinfo       — Check tabchi info (reply)
```

## 24.17 Welcome Configuration
```
!welcome on/off           — Toggle welcome
!setwelcome               — Set message text
!getwelcome               — View current message
!resetwelcome             — Reset to default
!setwelcometime <sec>     — Auto-delete delay
!setwelcomemedia          — Set media (reply)
```

---

# Appendix A: Inline List Configurations

| ID | Title | Supports Add | Description |
|----|-------|--------------|-------------|
| owners | 👑 Owners | No | Group owners/creators |
| admins | 👥 Admins | No | Group administrators |
| vip | ⭐ VIP Members | Yes | VIP users who bypass all filtering |
| muted | 🔇 Muted | Yes | Users who are muted |
| banned | 🚫 Banned | Yes | Users who are banned |
| warnings | ⚠️ Warnings | No | Active warnings |
| exempt | ✅ Exempt | Yes | Users exempt from filtering |
| filters | 🚷 Filtered Keywords | Yes | Blacklisted words |
| whitelist | ✔️ Allowed Keywords | Yes | Whitelisted words |
| forward_whitelist | ↪️ Allowed Forwards | Yes | Allowed forward channels |
| auto_replies | 🤖 Auto Replies | Yes | Automatic responses |
| scheduled_posts | ⏰ Scheduled Posts | Yes | Scheduled messages |

---

# Appendix B: Help Sections

| ID | Icon | Title | Implemented |
|----|------|-------|-------------|
| lock_management | 🔒 | Lock Management | ✅ |
| settings | ⚙️ | Settings | ✅ |
| tabchi | 🚫 | Tabchi (Spam Bots) | ✅ |
| user_panel | 👤 | User Panel | ✅ |
| user_penalties | ⚠️ | User Penalties | ✅ |
| promote_demote | 👑 | Promote & Demote | ✅ |
| word_filter | 🚷 | Word Filter | ✅ |
| cleanup | 🧹 | Cleanup | ✅ |
| mandatory_add | ➕ | Mandatory Add | ✅ |
| welcome | 👋 | Welcome | ✅ |
| mandatory_membership | 📌 | Mandatory Membership | ✅ |
| activity_stats | 📊 | Activity Statistics | ✅ |
| entertainment | 🎮 | Entertainment & Utilities | ✅ |

---

# Appendix C: Bot Button Labels

Default button labels that can be customized:

| Key | Default Label |
|-----|---------------|
| start_add_to_group | ➕ Add to Group |
| start_management_panel | ⚙️ Management Panel |
| start_channel | 📢 Channel |
| start_info | 💬 Info |
| panel_mini_app | 🧩 Open Mini App |
| panel_inline_panel | ⌨️ Inline Panel |
| panel_back | 🔙 Back |
| owner_nav_back | Back |
| owner_nav_main | Back to Main Menu |

---

# Appendix D: API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /healthz | Health check |
| GET | /api/stars/overview | Stars overview |
| GET | /api/stars/search?q= | Search groups |
| POST | /api/stars/purchase | Purchase stars |
| POST | /api/stars/gift | Gift stars |
| GET | /api/stars/wallet | Wallet summary |
| POST | /api/stars/transactions/:id/refund | Refund transaction |
| GET | /api/firewall/audits/:chatId | Firewall audit logs |
| POST | /api/referrals/track | Track referral |

---

# Document Information

- **Version**: 1.0.0
- **Generated**: 2026-01-07
- **Total Lines**: ~10,000+
- **Based on**: bot/index.ts (9,026 lines)

---

**End of Documentation**
