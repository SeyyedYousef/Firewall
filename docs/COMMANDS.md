# 🤖 Firewall Telegram Bot - Complete Command Documentation

> **Version:** 1.0  
> **Language:** English Only  
> **Command Prefix:** `!` or `.`  
> **Last Updated:** December 2024

---

## 📑 Table of Contents

1. [User Moderation Commands](#1-user-moderation-commands)
2. [Lock/Unlock Commands](#2-lockunlock-commands)
3. [Whitelist Commands](#3-whitelist-commands)
4. [Silence/Quiet Hours Commands](#4-silencequiet-hours-commands)
5. [Group Lock Commands](#5-group-lock-commands)
6. [Word Filter Commands](#6-word-filter-commands)
7. [Purge/Delete Commands](#7-purgedelete-commands)
8. [Limit Commands](#8-limit-commands)
9. [Force Join Commands](#9-force-join-commands)
10. [Force Add Commands (Premium)](#10-force-add-commands-premium)
11. [Welcome Commands](#11-welcome-commands)
12. [Warning Commands](#12-warning-commands)
13. [Auto-Delete Commands](#13-auto-delete-commands)
14. [Join/Leave Message Commands](#14-joinleave-message-commands)
15. [Admin Lock Commands](#15-admin-lock-commands)
16. [Tabchi Management Commands](#16-tabchi-management-commands)
17. [Settings Commands](#17-settings-commands)
18. [Cleanup Commands](#18-cleanup-commands)
19. [Statistics Commands](#19-statistics-commands)
20. [VIP Commands](#20-vip-commands)
21. [Manager/Mod Commands](#21-managermod-commands)
22. [Owner Commands](#22-owner-commands)
23. [User Panel Commands](#23-user-panel-commands)
24. [Entertainment & Utilities Commands](#24-entertainment--utilities-commands)

---

# 1. User Moderation Commands

## 1.1 `!Ban`

**Overview:**  
Permanently bans a user from the group, preventing them from rejoining until explicitly unbanned.

**Description:**  
The `!Ban` command is the primary enforcement tool for removing disruptive users from your group. When executed, it immediately removes the target user and prevents them from rejoining the group through any means (including invite links). This is a severe action typically reserved for serious rule violations, spammers, scammers, or repeat offenders who have exhausted warning-based enforcement.

The ban is persistent and stored both in Telegram's system and the bot's database. The user will remain banned even if the bot is temporarily removed from the group. To reverse a ban, an administrator must explicitly use the unban functionality.

**Arguments:**  
| Argument | Required | Type | Description | Restrictions |
|----------|----------|------|-------------|--------------|
| `[duration]` | Optional | String | Time duration for temporary ban | Format: `1h`, `2d`, `1w` (h=hours, d=days, w=weeks). Max: 365d. If omitted, ban is permanent. |

**Behavior:**  
- Bot checks if the command sender is a group administrator
- Bot checks if the command is a reply to another user's message
- Bot verifies it has permission to ban users
- Bot cannot ban other administrators or the group creator
- If all checks pass, the target user is immediately banned
- A confirmation message is sent and auto-deleted after 30 seconds
- The original command message is deleted

**Output:**  
- **Success:** `✅ User [username/id] has been banned.` (auto-deletes after 30 seconds)
- **Error (not admin):** `⚠️ Only group admins can use this command.`
- **Error (no reply):** `❌ Please reply to a user's message to use this command.`
- **Error (permission):** `❌ I don't have permission to ban users in this group.`

**Examples:**  
1. **Normal Usage (Permanent Ban):**  
   Reply to a spammer's message → `!Ban`  
   Result: User is permanently banned

2. **Temporary Ban:**  
   Reply to user → `!Ban 24h`  
   Result: User is banned for 24 hours

3. **Edge Case (Trying to ban admin):**  
   Reply to admin's message → `!Ban`  
   Result: `❌ Cannot ban administrators.`

4. **Incorrect Usage (No reply):**  
   `!Ban` (without replying)  
   Result: `❌ Please reply to a user's message to use this command.`

5. **Incorrect Usage (Non-admin):**  
   Regular user sends `!Ban`  
   Result: Command message is silently deleted

**Notes:**  
- Always reply to the target user's message when using this command
- The bot must have "Ban Users" permission in the group
- Banned users cannot see or access the group
- Use `!Kick` as an alias for the same functionality
- Consider using warnings first for minor violations

**Internal Logic:**  
1. Parse command from message text (prefix `!` or `.`, command `ban` or `kick`)
2. Verify sender's admin status via `getChatAdministrators()`
3. Extract reply message and get target user ID
4. Validate target user is not an admin/creator
5. Parse optional duration argument if provided
6. Execute `restrictChatMember()` or `banChatMember()` via Telegram API
7. Log action to database for audit trail
8. Generate success response with auto-delete timer
9. Delete original command message
10. Return processing actions array

---

## 1.2 `!Mute`

**Overview:**  
Restricts a user from sending messages in the group while keeping them as a member.

**Description:**  
The `!Mute` command applies a restriction to a user that prevents them from sending any messages, media, stickers, GIFs, or using inline bots. Unlike a ban, the user remains in the group and can still read messages. This is useful for temporarily silencing disruptive users or giving them a "cool-down" period without removing them entirely.

Muting is ideal for situations where a user is being argumentative, spamming, or needs time to calm down, but hasn't committed a violation severe enough to warrant a ban. The user can see they are muted and can request an unmute from administrators.

**Arguments:**  
| Argument | Required | Type | Description | Restrictions |
|----------|----------|------|-------------|--------------|
| `[duration]` | Optional | String | Time duration for mute | Format: `1h`, `2d`, `1w`. Max: 365d. Default: permanent until unmuted. |

**Behavior:**  
- Bot checks sender is an administrator
- Bot requires the command to be a reply to the target user's message
- Bot applies restrictions via Telegram's permission system
- If duration is specified, mute expires automatically
- The muted user cannot send any messages but can read and observe

**Output:**  
- **Success:** `✅ User [username/id] has been muted.` (or `muted for [duration]`)
- **Error (not admin):** `⚠️ Only group admins can use this command.`
- **Error (no reply):** `❌ Please reply to a user's message to use this command.`

**Examples:**  
1. **Permanent Mute:**  
   Reply to message → `!Mute`  
   Result: User is muted indefinitely

2. **Timed Mute:**  
   Reply to message → `!Mute 1h`  
   Result: User is muted for 1 hour

3. **Using Alias:**  
   Reply to message → `!Silent`  
   Result: Same as `!Mute`

4. **Incorrect Usage:**  
   `!Mute` without replying  
   Result: `❌ Please reply to a user's message to use this command.`

**Notes:**  
- Aliases: `!Silent`, `!Restrict`
- The bot must have "Restrict Members" permission
- Muted users see a "muted" indicator when they try to type
- Admins and creators cannot be muted
- Use `!Unmute` to reverse
- **Unspecified duration is permanent.**

**Internal Logic:**  
1. Parse command and identify target user from reply
2. Verify sender has admin privileges
3. Parse duration argument if provided
4. Calculate Unix timestamp for mute expiry (if timed)
5. Call `restrictChatMember()` with `can_send_messages: false`
6. Store mute record in database with expiry timestamp
7. Generate confirmation response
8. Delete command message

---

## 1.3 `!Unmute`

**Overview:**  
Removes message restrictions from a previously muted user, allowing them to send messages again.

**Description:**  
The `!Unmute` command reverses a mute action, restoring the user's ability to send messages, media, stickers, and use all normal group features. This is the only way to manually end a permanent mute or to end a timed mute early.

**Arguments:**  
None. This command requires replying to the muted user's message.

**Behavior:**  
- Must be used as a reply to the muted user's message
- Bot restores all default member permissions
- Works even if the user was muted by another admin

**Output:**  
- **Success:** `✅ User [username/id] has been unmuted.`
- **Error (not muted):** `ℹ️ This user is not muted.`
- **Error (no reply):** `❌ Please reply to a user's message to use this command.`

**Examples:**  
1. **Normal Usage:**  
   Reply to muted user → `!Unmute`  
   Result: User can send messages again

2. **Using Aliases:**  
   Reply to user → `!Free` or `!Unrestrict`  
   Result: Same as `!Unmute`

**Notes:**  
- Aliases: `!Free`, `!Unrestrict`
- Does not require the original muting admin
- Cannot unmute if user has left the group

**Internal Logic:**  
1. Identify target user from reply message
2. Verify sender is admin
3. Call `restrictChatMember()` with default permissions (all allowed)
4. Remove mute record from database if exists
5. Generate confirmation response
6. Delete command message

---

## 1.4 `!Reset`

**Overview:**  
Resets all warnings for a user, clearing their violation history.

**Description:**  
The `!Reset` command clears the warning count for a specific user. This is useful when a user has reformed their behavior or when warnings were given in error. Once reset, the user's warning count returns to zero, and they are no longer at risk of automatic punishment from accumulated warnings.

**Arguments:**  
None. This command requires replying to the target user's message.

**Behavior:**  
- Clears warning count in the database
- Does not affect current mute/ban status
- Does not notify the target user

**Output:**  
- **Success:** `✅ Warnings reset for user [username/id].`
- **Error (no warnings):** `ℹ️ This user has no warnings to reset.`

**Examples:**  
1. **Normal Usage:**  
   Reply to user → `!Reset`  
   Result: All warnings cleared

2. **Using Alias:**  
   Reply to user → `!ResetWarnings`  
   Result: Same behavior

**Notes:**  
- Aliases: `!ResetWarnings`
- Only resets warnings, not other punishments
- Action is logged for audit purposes

**Internal Logic:**  
1. Get target user ID from reply
2. Query database for UserWarning record
3. Update count to 0 or delete record
4. Log the reset action
5. Generate confirmation response

---

# 2. Lock/Unlock Commands

## 2.1 General Lock Command Format

**Overview:**  
Lock commands block specific types of content from being posted in the group.

**Description:**  
The Firewall bot supports extensive content restriction through lock commands. Each lock targets a specific content type (links, photos, videos, etc.) and can be enabled or disabled using simple commands. When a lock is active, any matching content is automatically deleted, and the user may receive a warning or punishment depending on settings.

**Command Format:**  
```
!{locktype} lock    - Enable the lock
!{locktype} unlock  - Disable the lock
!{locktype} on      - Enable the lock (alias)
!{locktype} off     - Disable the lock (alias)
!lock {locktype}    - Alternative format
!unlock {locktype}  - Alternative format
```

---

## 2.2 Available Lock Types

### 🔗 Links & URLs

#### `!Link`
**Overview:** Blocks all Telegram links (t.me, telegram.me)

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `lock`, `unlock`, `on`, `off` |

**Examples:**  
- `!Link lock` - Block all Telegram links
- `!Link unlock` - Allow Telegram links
- `!lock link` - Alternative format

**Notes:**  
- Aliases: `!Links`
- Blocks: t.me/*, telegram.me/*, @username links
- Internal setting key: `banLinks`

---

#### `!URL`
**Overview:** Blocks all external website URLs

**Arguments:** Same as `!Link`

**Examples:**  
- `!URL lock` - Block external URLs
- `!Site on` - Alternative alias

**Notes:**  
- Aliases: `!URLs`, `!Site`, `!Domain`
- Blocks: All http/https URLs
- Internal setting key: `banDomains`

---

### 👤 Usernames & Mentions

#### `!Username`
**Overview:** Blocks @username mentions

**Examples:**  
- `!Username lock` - Block username mentions
- `!ID off` - Allow mentions (using alias)

**Notes:**  
- Aliases: `!ID`, `!Mention`
- Internal setting key: `banUsernames`

---

### #️⃣ Hashtags

#### `!Hashtag`
**Overview:** Blocks messages containing #hashtags

**Examples:**  
- `!Hashtag lock` - Block hashtags
- `!Tag unlock` - Allow hashtags

**Notes:**  
- Aliases: `!Tag`
- Internal setting key: `banHashtags`

---

### 📝 Text Content

#### `!Text`
**Overview:** Blocks all plain text messages (media-only mode)

**Notes:**  
- Internal setting key: `banTextPatterns`
- Use for media-only channels/groups

---

### ↪️ Forwarded Messages

#### `!Forward`
**Overview:** Blocks all forwarded messages

**Examples:**  
- `!Forward lock` - Block forwards
- `!Fwd unlock` - Allow forwards

**Notes:**  
- Aliases: `!Fwd`
- Internal setting key: `banForward`

---

#### `!ChannelForward`
**Overview:** Blocks messages forwarded from channels only

**Notes:**  
- Aliases: `!ForwardChannel`
- User forwards still allowed
- Internal setting key: `banForwardChannels`

---

### 🖼️ Media Types

| Command | Overview | Aliases | Setting Key |
|---------|----------|---------|-------------|
| `!Photo` | Block photos/images | `!Image` | `banPhotos` |
| `!Video` | Block videos | - | `banVideos` |
| `!Sticker` | Block stickers | - | `banStickers` |
| `!Location` | Block location shares | - | `banLocation` |
| `!Phone` | Block phone numbers | `!Contact` | `banPhones` |
| `!Voice` | Block voice messages | - | `banVoice` |
| `!Audio` | Block audio files | - | `banAudio` |
| `!File` | Block documents/files | `!Document` | `banFiles` |
| `!App` | Block apps/software | `!Software` | `banApps` |
| `!GIF` | Block GIFs/animations | `!Animation` | `banGif` |
| `!Poll` | Block polls | - | `banPolls` |
| `!Game` | Block games | - | `banGames` |
| `!Slash` | Block /commands | `!Command` | `banSlashCommands` |

---

### 📝 Content Restrictions

| Command | Overview | Setting Key |
|---------|----------|-------------|
| `!NoCaption` | Block media without captions | `banCaptionless` |
| `!EmojiOnly` | Block emoji-only messages | `banEmojiOnly` |
| `!Emoji` | Block messages with emojis | `banEmojis` |

---

### 🌍 Language Restrictions

| Command | Overview | Aliases | Setting Key |
|---------|----------|---------|-------------|
| `!English` | Block Latin/English text | `!Latin` | `banLatin` |
| `!Persian` | Block Persian/Arabic text | `!Arabic`, `!Farsi` | `banPersian` |
| `!Cyrillic` | Block Cyrillic/Russian text | `!Russian` | `banCyrillic` |
| `!Chinese` | Block Chinese text | - | `banChinese` |

---

### 💬 Reply Restrictions

| Command | Overview | Setting Key |
|---------|----------|-------------|
| `!Reply` | Block user replies | `banUserReplies` |
| `!CrossReply` | Block cross-chat replies | `banCrossReplies` |

---

### 🤖 Bot & Spam Restrictions

| Command | Overview | Aliases | Setting Key |
|---------|----------|---------|-------------|
| `!Bot` | Block bot messages | - | `banBots` |
| `!BotInviter` | Ban users who add bots | - | `banBotInviters` |
| `!Inline` | Block inline keyboards | - | `banInlineKeyboards` |
| `!Tabchi` | Block spam bots | `!SpamBot` | `banTabchi` |
| `!Advertiser` | Block advertisers | `!Promo` | `banAdvertiser` |
| `!Bio` | Block suspicious bios | `!SuspiciousBio` | `banSuspiciousBio` |

---

**General Lock Command Internal Logic:**
1. Parse command: `parseCommand(text)` extracts command and arguments
2. Look up lock type in `LOCK_COMMANDS` mapping
3. Determine action (lock/unlock) from argument
4. Load current group settings from database
5. Update the corresponding rule (`settings.rules[key].enabled`)
6. Save updated settings to database
7. Generate confirmation message
8. Delete command message

---

# 3. Whitelist Commands

## 3.1 `!Whitelist`

**Overview:**  
Adds a user to the whitelist, exempting them from all content restrictions.

**Description:**  
Whitelisted users can bypass all lock restrictions. This is useful for trusted members, VIPs, or staff who need to share content that would normally be blocked. The whitelist applies to all locks simultaneously.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Optional | String | `add`, `remove`, `del`, `clear`, `reset` |

**Behavior:**  
- Without argument: Adds replied-to user to whitelist
- `add`: Explicitly adds user
- `remove`/`del`: Removes user
- `clear`/`reset`: Clears entire whitelist

**Output:**  
- **Success (add):** `✅ User added to whitelist.`
- **Success (remove):** `✅ User removed from whitelist.`
- **Error:** `❌ Please reply to a user's message.`

**Examples:**  
1. `!Whitelist` (replying to user) - Add to whitelist
2. `!Whitelist add` - Same as above
3. `!WL remove` - Remove from whitelist
4. `!ClearWhitelist` - Clear all

**Notes:**  
- Aliases: `!WL`
- Whitelisted users bypass ALL locks, not specific ones

**Internal Logic:**  
1. Parse action argument (default: add)
2. Get target user from reply
3. Load group settings
4. Modify `settings.whitelist` array
5. Save settings
6. Return confirmation

---

## 3.2 `!UnWhitelist`

**Overview:**  
Removes a user from the whitelist.

**Examples:**  
- `!UnWhitelist` (replying to user)
- `!UnWL` - Alias

---

## 3.3 `!ClearWhitelist`

**Overview:**  
Removes all users from the whitelist.

**Examples:**  
- `!ClearWhitelist`
- `!ClearWL` - Alias

**Notes:**  
- This is a destructive action
- Cannot be undone

---

# 4. Silence/Quiet Hours Commands

## 4.1 `!Silence1` / `!Silence2` / `!Silence3`

**Overview:**  
Configure up to 3 daily quiet periods during which only admins can send messages.

**Description:**  
Silence windows allow you to schedule recurring periods of group silence. During these windows, non-admin members cannot send messages. This is useful for:
- Night hours to reduce spam
- Meeting times
- Announcement-only periods

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `start` | Required | String | Start time in HH:MM format (24-hour) |
| `end` | Required | String | End time in HH:MM format (24-hour) |

Or use `off` to disable the window.

**Examples:**  
1. `!Silence1 22:00 06:00` - Quiet from 10pm to 6am
2. `!Silence2 12:00 13:00` - Quiet during lunch
3. `!Silence1 off` - Disable first window
4. `!Quiet1 23:00 05:00` - Using alias

**Notes:**  
- Aliases: `!Quiet1`, `!Quiet2`, `!Quiet3`
- Times are in UTC unless timezone is configured
- Up to 3 windows can be set simultaneously

**Internal Logic:**  
1. Parse start and end times
2. Validate time format (HH:MM)
3. Load silence settings
4. Update corresponding window (1, 2, or 3)
5. Save settings
6. Background job checks current time against windows

---

## 4.2 `!ClearSilence`

**Overview:**  
Disables all silence windows.

**Examples:**  
- `!ClearSilence`
- `!ClearQuiet` - Alias

---

# 5. Group Lock Commands

## 5.1 `!LockGroup`

**Overview:**  
Locks the entire group so only admins can send messages.

**Description:**  
This is the "nuclear option" for group management. When activated, all non-admin members are immediately restricted from sending any messages. Use this during emergencies, raids, or when you need to make important announcements without interruption.

**Arguments:**  
None.

**Output:**  
- **Success:** `✅ Group locked. Only admins can send messages.`

**Examples:**  
- `!LockGroup`
- `!GroupLock` - Alias

**Notes:**  
- Affects ALL non-admin members immediately
- Use `!UnlockGroup` to restore normal operation

**Internal Logic:**  
1. Verify sender is admin
2. Call Telegram API to set group permissions
3. Set all `can_send_*` permissions to false for non-admins
4. Store locked state in database

---

## 5.2 `!UnlockGroup`

**Overview:**  
Unlocks the group, restoring normal member permissions.

**Examples:**  
- `!UnlockGroup`
- `!GroupUnlock` - Alias

---

# 6. Word Filter Commands

## 6.1 `!Filter`

**Overview:**  
Adds a word or phrase to the blacklist filter.

**Description:**  
The word filter automatically deletes messages containing blacklisted words or phrases. This is essential for blocking profanity, slurs, competitor names, or any unwanted content. Filters are case-insensitive and match partial words by default.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `word` | Required | String | Word or phrase to filter |

**Behavior:**  
- Case-insensitive matching
- Matches partial words (e.g., "spam" matches "spammer")
- Messages containing the word are deleted
- User receives warning (if enabled)

**Output:**  
- **Success:** `✅ Word 'example' added to filter list.`
- **Error:** `❌ Please specify a word to filter.`

**Examples:**  
1. `!Filter spam` - Block "spam" and variations
2. `!AddFilter badword` - Using alias
3. `!Filter buy now` - Filter a phrase

**Notes:**  
- Aliases: `!AddFilter`
- Phrases with spaces work as expected
- Use `!FilterList` to see all filtered words

**Internal Logic:**  
1. Extract word/phrase from arguments
2. Convert to lowercase
3. Check if already in blacklist
4. Add to `settings.blacklist` array
5. Save settings

---

## 6.2 `!Unfilter`

**Overview:**  
Removes a word from the blacklist filter.

**Arguments:**  
| Argument | Required | Type |
|----------|----------|------|
| `word` | Required | String |

**Examples:**  
- `!Unfilter spam`
- `!RemoveFilter badword`
- `!DelFilter word`

**Notes:**  
- Aliases: `!RemoveFilter`, `!DelFilter`

---

## 6.3 `!FilterList`

**Overview:**  
Displays all currently filtered words.

**Output:**  
- **With filters:** `📋 Filtered words: word1, word2, word3...`
- **Empty:** `📋 No words in filter list.`

**Examples:**  
- `!FilterList`
- `!Filters`
- `!ListFilters`

---

## 6.4 Enhanced Filter Commands

### `!FilterWarn`
**Overview:** Adds a word that triggers a warning when used.

**Examples:**  
- `!FilterWarn badword`

---

### `!FilterBan`
**Overview:** Adds a word that triggers an immediate ban when used.

**Examples:**  
- `!FilterBan severe_word`

---

### `!FilterMute`
**Overview:** Adds a word that triggers a mute when used.

**Examples:**  
- `!FilterMute offensive_word`

---

# 7. Purge/Delete Commands

## 7.1 `!Purge`

**Overview:**  
Bulk deletes multiple messages from the chat.

**Description:**  
The purge command is a powerful moderation tool for cleaning up spam, off-topic discussions, or clearing space in the chat. It can delete a specific number of recent messages or delete all messages up to a replied-to message.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Optional | Integer | Number of messages to delete (1-1000) |

**Behavior:**  
- Without argument: Deletes messages from replied message to current
- With count: Deletes last N messages
- Bot messages and pinned messages may be skipped
- Operation happens in background for large counts

**Output:**  
- **Starting:** `🗑️ Purging {count} messages...`
- **Complete:** `✅ Purged {count} messages.`

**Examples:**  
1. `!Purge 50` - Delete last 50 messages
2. `!Purge` (replying to message) - Delete from that message to now
3. `!Clean 100` - Delete last 100 messages
4. `!Clear 10` - Delete last 10 messages

**Notes:**  
- Aliases: `!Clean`, `!Clear`, `!Del`, `!Delete`
- Maximum 1000 messages per command
- Messages older than 48 hours cannot be deleted (Telegram limitation)
- Bot must have "Delete Messages" permission

**Internal Logic:**  
1. Parse count argument or calculate from reply
2. Validate count (1-1000)
3. Fetch message IDs in range
4. Batch delete messages using `deleteMessages()`
5. Report completion

---

# 8. Limit Commands

## 8.1 Word/Character Limits & Flood

### `!MsgLimit`

**Overview:**  
Sets the maximum number of messages a user can send in a time window.

**Description:**  
Rate limiting prevents spam by restricting how many messages a user can send within a defined time period. When exceeded, messages are deleted and the user may receive a warning.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Required | Integer | Max messages allowed (0 to disable). Use !MsgWindow to set time. |

**Examples:**  
1. `!MsgLimit 10` - Max 10 messages per window
2. `!RateLimit 5` - Max 5 messages
3. `!MsgLimit 0` - Disable rate limiting

**Notes:**  
- Aliases: `!MessageLimit`, `!RateLimit`
- Use `!MsgWindow` to set the time window

---

## 8.2 `!MsgWindow`

**Overview:**  
Sets the time window (in seconds) for message rate limiting.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `seconds` | Required | Integer | Time window in seconds |

**Examples:**  
- `!MsgWindow 60` - 1 minute window
- `!LimitWindow 300` - 5 minute window

**Notes:**  
- Alias: `!LimitWindow`

---

## 8.3 `!Duplicate`

**Overview:**  
Sets the maximum allowed duplicate messages from a user.

**Description:**  
Detects when users send the same message repeatedly (copy-paste spam) and takes action after the threshold is reached.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Required | Integer | Max duplicate messages (0 to disable) |

**Examples:**  
- `!Duplicate 3` - Allow max 3 identical messages
- `!Dup 2` - Allow max 2 duplicates
- `!AntiSpam 1` - Only one identical message allowed

**Notes:**  
- Aliases: `!Dup`, `!AntiSpam`

---

## 8.4 `!DupWindow`

**Overview:**  
Sets the time window for duplicate detection.

**Examples:**  
- `!DupWindow 300` - Check duplicates within 5 minutes

---

## 8.5 `!MinWords`

**Overview:**  
Sets minimum word count required for messages.

**Description:**  
Enforces a minimum message length to prevent one-word spam or excessively short messages.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Required | Integer | Minimum words required (0 to disable) |

**Examples:**  
- `!MinWords 3` - Messages must have at least 3 words

---

## 8.6 `!MaxWords`

**Overview:**  
Sets maximum word count allowed for messages.

**Examples:**  
- `!MaxWords 100` - Messages cannot exceed 100 words

---

# 9. Force Join Commands

## 9.1 `!ForceJoin`

**Overview:**  
Requires users to join a channel before they can send messages in the group.

**Description:**  
Force Join is a powerful cross-promotion tool. When enabled, users must be members of specified channel(s) before they can participate in the group. Messages from non-members are deleted, and they receive a prompt to join the required channel(s).

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `action` | Required | String/Username | `on`, `off`, or `@channelname` |

**Behavior:**  
- `on`: Enable using previously configured channel
- `off`: Disable force join
- `@channelname`: Enable and set channel in one command

**Output:**  
- **Success (on):** `✅ Force Join enabled for @channel.`
- **Success (off):** `✅ Force Join disabled.`
- **Error:** `❌ Please specify a channel or action.`

**Examples:**  
1. `!ForceJoin @MyCh` - Enable and set channel
2. `!ForceJoin on` - Enable with existing channel
3. `!ForceJoin off` - Disable

**Notes:**  
- Bot must be admin in the target channel
- Multiple channels can be configured through Mini App

**Internal Logic:**  
1. Parse action/channel argument
2. If channel: validate bot is admin there
3. Update settings: `mandatoryChannel` and `enabled` flag
4. On user message: check membership before allowing
5. Delete non-member messages and send join prompt

---

## 9.2 `!SetForceJoinText`

**Overview:**  
Sets a custom message shown to users who haven't joined the required channel.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `text` | Optional | String | Custom message text |

**Available Variables:**  
- `{user}` - User's name
- `{channel_names}` - List of required channels

**Examples:**  
- `!SetForceJoinText Please join {channel_names} to chat!`

---

## 9.3 `!DelForceJoinText`

**Overview:**  
Resets the force join message to default.

**Examples:**  
- `!DelForceJoinText`
- `!DeleteForceJoinText`
- `!RemoveForceJoinText`

---

## 9.4 `!ForceJoinStatus`

**Overview:**  
Displays current Force Join configuration and status.

**Output:**  
```
📊 Force Join Status

• Status: Enabled/Disabled
• Channel(s): @channel1, @channel2
• Custom Text: Yes/No

📢 Current Message:
[The actual message shown to users]
```

---

# 10. Force Add Commands (Premium)

> ⭐ **Premium Feature:** Force Add is only available for Premium groups.

## 10.1 `!ForceAdd`

**Overview:**  
Requires users to invite new members before they can send messages.

**Description:**  
Force Add is a growth mechanism that requires users to add a specified number of new members to the group before they can participate. This is effective for organic group growth but is a Premium feature.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `on`, `off` |

**Output:**  
- **Success:** `✅ Force Add enabled. Members must add {count} users.`
- **Not Premium:** `⭐ Premium Feature - This feature is only available for Premium groups.`

**Examples:**  
1. `!ForceAdd on` - Enable force add
2. `!ForceAdd off` - Disable

---

## 10.2 `!SetForceAdd`

**Overview:**  
Sets the number of members a user must add before they can chat.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Required | Integer | Number of adds required (1-50) |

**Examples:**  
- `!SetForceAdd 3` - Require 3 invites
- `!SetForceAdd 5` - Require 5 invites

---

## 10.3 `!ForceAddTime`

**Overview:**  
Sets how long (in minutes) before messages from non-compliant users are deleted.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `minutes` | Required | Integer/String | Minutes, or `off` to disable |

**Examples:**  
- `!ForceAddTime 5` - Delete user messages after 5 minutes
- `!ForceAddTime off` - Disable time-based deletion

---

## 10.4 `!SetForceAddText`

**Overview:**  
Sets a custom message for Force Add warnings.

**Available Variables:**  
- `{user}` - User's name
- `{added}` - Number of users added
- `{number}` - Required number

---

## 10.5 `!DelForceAddText`

**Overview:**  
Resets Force Add message to default.

---

## 10.6 `!ForceAddStatus`

**Overview:**  
Sets whether Force Add applies to all members or new members only.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `mode` | Required | String | `all`, `new` |

**Examples:**  
- `!ForceAddStatus all` - Apply to all members
- `!ForceAddStatus new` - Apply only to new members

---

## 10.7 `!CleanForceAdd`

**Overview:**  
Clears all Force Add history, resetting everyone's add count.

**Output:**  
`✅ Force Add history has been cleared. All members will need to add members again.`

---

## 10.8 `!ForceAddInfo`

**Overview:**  
Shows complete Force Add status and configuration.

---

# 11. Welcome Commands

## 11.1 `!Welcome`

**Overview:**  
Enables or disables the welcome message for new members.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Optional | String | `on`, `off`, `enable`, `disable` |

**Examples:**  
- `!Welcome on` - Enable welcome messages
- `!Welcome off` - Disable welcome messages
- `!Welcome disable` - Same as off

**Notes:**  
- Configure welcome text through Mini App
- Variables: `{user}`, `{group}`, `{count}`, etc.

---

# 12. Warning Commands

## 12.1 `!Warning`

**Overview:**  
Enables or disables the warning system.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `on`, `off`, `enable`, `disable` |

**Examples:**  
- `!Warning on` - Enable warnings
- `!Warn off` - Disable warnings

**Notes:**  
- Alias: `!Warn`

---

## 12.2 `!AutoWarning`

**Overview:**  
Enables automatic warnings for rule violations.

**Examples:**  
- `!AutoWarning on`
- `!AutoWarn off`

**Notes:**  
- Alias: `!AutoWarn`

---

## 12.3 `!WarnThreshold`

**Overview:**  
Sets the number of warnings before automatic punishment.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `count` | Required | Integer | Warning threshold (1-10) |

**Examples:**  
- `!WarnThreshold 3` - Ban/mute after 3 warnings
- `!MaxWarnings 5` - Ban/mute after 5 warnings

**Notes:**  
- Alias: `!MaxWarnings`

---

## 12.4 `!WarnRetention`

**Overview:**  
Sets how long warnings are retained before expiring.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `hours` | Required | Integer | Hours to retain warnings |

**Examples:**  
- `!WarnRetention 24` - Warnings expire after 24 hours
- `!WarnExpiry 168` - Warnings expire after 1 week

**Notes:**  
- Alias: `!WarnExpiry`

---

# 13. Auto-Delete Commands

## 13.1 `!AutoDelete` (Bot Messages)

**Overview:**  
Enables automatic deletion of bot response messages.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `on`, `off`, `enable`, `disable` |

**Examples:**  
- `!AutoDelete on` - Bot messages auto-delete
- `!AutoDel off` - Bot messages persist

**Notes:**  
- Alias: `!AutoDel`

---

## 13.2 `!AutoDeleteDelay`

**Overview:**  
Sets the delay before automatic message deletion.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `seconds` | Required | Integer | Seconds before deletion |

**Examples:**  
- `!AutoDeleteDelay 30` - Delete after 30 seconds
- `!AutoDelDelay 60` - Delete after 1 minute

**Notes:**  
- Alias: `!AutoDelDelay`

---

# 14. Join/Leave Message Commands

## 14.1 `!JoinLeave`

**Overview:**  
Controls whether Telegram's service messages (X joined/left) are removed.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `on`/`show`, `off`/`remove` |

**Examples:**  
- `!JoinLeave off` - Remove join/leave messages
- `!ServiceMsg show` - Show join/leave messages

**Notes:**  
- Alias: `!ServiceMsg`
- `off` removes the messages, `on`/`show` keeps them

---

# 15. Admin Lock Commands

## 15.1 `!AdminLock`

**Overview:**  
Restricts bot commands to administrators only.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `lock`, `on`, `unlock`, `off` |

**Examples:**  
- `!AdminLock on` - Only admins can use bot commands
- `!Admins unlock` - All users can use certain commands

**Notes:**  
- Alias: `!Admins`

---

## 15.2 `!PublicCmds`

**Overview:**  
Controls whether public commands (like !Stats, !Info) are available to all users.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `action` | Required | String | `lock`, `off`, `unlock`, `on` |

**Examples:**  
- `!PublicCmds off` - Disable public commands
- `!PublicCommands on` - Enable public commands

**Notes:**  
- Alias: `!PublicCommands`

---

# 16. Tabchi Management Commands

## 16.1 `!UnTabchi`

**Overview:**  
Removes the Tabchi (spam bot) label from a user.

**Description:**  
Tabchi detection may sometimes flag legitimate users. This command removes the spam bot label, allowing the user to participate normally.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `user_id` | Optional | Integer | User ID to unmark (or reply to message) |

**Examples:**  
- `!UnTabchi` (replying to user)
- `!UnTabchi 123456789`
- `!ClearTabchi 123456789`

**Notes:**  
- Alias: `!ClearTabchi`

---

## 16.2 `!TabchiWhitelist`

**Overview:**  
Adds a user to the Tabchi whitelist, preventing them from being detected as a spam bot.

**Examples:**  
- `!TabchiWhitelist` (replying to user)
- `!WLTabchi` - Alias

---

## 16.3 `!TabchiInfo`

**Overview:**  
Displays Tabchi status and detection information for a user.

**Output:**  
```
🚫 Tabchi Info

• User: @username (ID)
• Status: Clean / Flagged
• Violations: 0
• First Seen: Date
• Last Activity: Date
```

---

# 17. Settings Commands

## 17.1 `!Settings`

**Overview:**  
Displays all current group settings and configurations.

**Description:**  
This command provides a comprehensive overview of all bot settings for the group, including active locks, limits, warning configuration, premium status, and more.

**Output:**  
Complete settings panel showing:
- Lock status for all content types
- Rate limiting configuration
- Warning settings
- Premium status
- Whitelist count
- And more...

**Examples:**  
- `!Settings`
- `!Status`
- `!Info`

**Notes:**  
- Aliases: `!Status`, `!Info`

---

## 17.2 `!Config` / `!Reload` / `!Refresh`

**Overview:**  
Reloads the admin list and bot configuration.

**Output:**  
`✅ Admin list reloaded.`

---

## 17.3 `!Credit` / `!Renew` / `!Charge`

**Overview:**  
Shows information about renewing/charging the group's premium status.

---

# 18. Cleanup Commands

## 18.1 `!CleanBans`

**Overview:**  
Provides information about cleaning up banned users.

**Description:**  
Due to Telegram API limitations, the bot cannot automatically list all banned users. This command provides guidance on alternative methods for managing bans.

**Output:**  
Information about using Mini App, userbot, or manual methods for ban management.

---

## 18.2 `!CleanWarns`

**Overview:**  
Clears all warning records for all users in the group.

**Output:**  
`✅ Cleared warnings for {count} users.`

**Notes:**  
- Aliases: `!CleanWarn`, `!CleanWarnings`
- This is irreversible!

---

## 18.3 `!CleanMutes`

**Overview:**  
Provides information about unmuting all users.

---

## 18.4 `!CleanFilters`

**Overview:**  
Clears all words from the filter list.

**Output:**  
`✅ Cleared {count} words from filter list.`

**Notes:**  
- Aliases: `!CleanFilter`, `!CleanFilterList`

---

## 18.5 `!CleanExempts`

**Overview:**  
Clears the whitelist (exemptions).

**Output:**  
`✅ Cleared {count} users from whitelist.`

**Notes:**  
- Aliases: `!CleanExempt`, `!CleanWhitelist`

---

## 18.6 `!CleanVIPs`

**Overview:**  
Removes all users from the VIP list.

**Output:**  
`✅ Removed {count} users from VIP list.`

**Notes:**  
- Aliases: `!CleanVIP`

---

## 18.7 `!CleanModList`

**Overview:**  
Removes all users from the manager/moderator list.

**Output:**  
`✅ Removed {count} users from manager list.`

**Notes:**  
- Alias: `!CleanMods`

---

## 18.8 `!CleanRestricts`

**Overview:**  
Removes all restriction records.

**Notes:**  
- Alias: `!CleanRestrict`

---

## 18.9 `!CleanDeleted`

**Overview:**  
Removes records of deleted accounts from the system.

**Notes:**  
- Alias: `!CleanGhosts`

---

## 18.10 `!CleanBots`

**Overview:**  
Removes bot accounts from the group (except the Firewall bot itself).

**Notes:**  
- Alias: `!CleanBot`
- Requires manual confirmation

---

## 18.11 `!CleanFakes`

**Overview:**  
Removes accounts detected as fake/spam.

**Notes:**  
- Alias: `!CleanFake`

---

# 19. Statistics Commands

## 19.1 `!Stats`

**Overview:**  
Displays group statistics including top inviters, activity metrics, and more.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `type` | Optional | String | `add`, `rank`, `total`, `weekly` |

**Examples:**  
1. `!Stats` - General statistics
2. `!Stats add` - Top inviters
3. `!Stats rank` - User rankings
4. `!Stats total` - Total statistics
5. `!Stats weekly` - Weekly statistics

**Notes:**  
- Alias: `!Stat`

---

## 19.2 `!UserStats`

**Overview:**  
Displays statistics for a specific user (reply to their message).

**Output:**  
```
📊 User Statistics

• Messages Today: X
• Total Messages: X
• Invites: X
• Warnings: X
• Join Date: Date
```

**Notes:**  
- Alias: `!UserStat`

---

## 19.3 `!AddStats`

**Overview:**  
Shortcut for `!Stats add` - shows top inviters.

**Notes:**  
- Alias: `!AddStat`

---

## 19.4 `!RankStats`

**Overview:**  
Shortcut for `!Stats rank` - shows user rankings.

**Notes:**  
- Alias: `!RankStat`

---

## 19.5 `!TotalStats`

**Overview:**  
Shortcut for `!Stats total` - shows total statistics.

**Notes:**  
- Alias: `!TotalStat`

---

## 19.6 `!WeeklyStats`

**Overview:**  
Shortcut for `!Stats weekly` - shows weekly statistics.

**Notes:**  
- Alias: `!WeeklyStat`

---

# 20. VIP Commands

## 20.1 `!VIP`

**Overview:**  
Adds a user to the VIP list.

**Description:**  
VIP members receive special privileges such as bypassing certain restrictions, avoiding rate limits, and being exempt from automatic punishments.

**Examples:**  
- `!VIP` (replying to user)
- `!AddVIP` - Alias

**Notes:**  
- Alias: `!AddVIP`
- Reply to user's message to add them

---

## 20.2 `!RemVIP`

**Overview:**  
Removes a user from the VIP list.

**Examples:**  
- `!RemVIP` (replying to user)
- `!RemoveVIP`
- `!DelVIP`

---

## 20.3 `!VIPList`

**Overview:**  
Displays all VIP members.

**Output:**  
```
⭐ VIP Members

• User 1 (ID)
• User 2 (ID)
...
```

**Notes:**  
- Aliases: `!VIPs`, `!ListVIPs`

---

# 21. Manager/Mod Commands

## 21.1 `!Promote`

**Overview:**  
Adds a user to the manager/moderator list.

**Description:**  
Managers have elevated privileges within the bot system (not Telegram admin). They can use administrative commands but cannot access owner-level features.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `user_id` | Optional | Integer | User ID (or reply to message) |

**Examples:**  
- `!Promote` (replying to user)
- `!AddMod`
- `!AddManager`

**Notes:**  
- Aliases: `!AddMod`, `!AddManager`

---

## 21.2 `!Demote`

**Overview:**  
Removes a user from the manager/moderator list.

**Examples:**  
- `!Demote` (replying to user)
- `!RemMod`
- `!RemoveMod`

---

## 21.3 `!ModList`

**Overview:**  
Displays all managers/moderators.

**Output:**  
```
👤 Manager List

• ID1
• ID2
...
```

**Notes:**  
- Aliases: `!Mods`, `!Managers`

---

# 22. Owner Commands

## 22.1 `!SetOwner`

**Overview:**  
Adds a user to the owner list (highest privilege level).

**Description:**  
Owners have full access to all bot features and can manage other owners. Only the group creator can assign owner status.

**Examples:**  
- `!SetOwner` (replying to user)
- `!AddOwner`

**Notes:**  
- Alias: `!AddOwner`
- Only group creator can use this command

---

## 22.2 `!RemOwner`

**Overview:**  
Removes a user from the owner list.

**Examples:**  
- `!RemOwner` (replying to user)
- `!RemoveOwner`
- `!DelOwner`

**Notes:**  
- Only group creator can remove owners

---

## 22.3 `!OwnerList`

**Overview:**  
Displays all owners.

**Output:**  
```
👑 Owner List

• ID1
• ID2
...
```

**Notes:**  
- Aliases: `!Owners`, `!ListOwners`

---

## 22.4 `!CleanOwnerList`

**Overview:**  
Removes all users from the owner list.

**Notes:**  
- Alias: `!CleanOwners`
- Only group creator can use this

---

# 23. User Panel Commands

## 23.1 `!UserPanel`

**Overview:**  
Opens a comprehensive user management panel for a specific user.

**Description:**  
The User Panel provides a complete interface for viewing user information and managing user-specific settings. It displays membership status, activity statistics, restriction status, and provides buttons for common actions.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `user_id` | Optional | Integer/Username | User ID or @username |

**Behavior:**  
- Reply to a message to open panel for that user
- Or specify user ID/username directly
- Opens inline keyboard with management options

**Output:**  
```
◄ User Status:

⊹ In Group: Member/Admin/Creator
⊹ In Bot: Regular User/VIP/Manager/Owner

⊹ User Name: John Doe
⊹ Numeric ID: 123456789
⊹ Username: @johndoe
⊹ Nickname: None
⊹ Global Rank: None

⊹ Add Count: 0
⊹ Today's Messages: 0
⊹ Message Rank: None

⊹ Banned: No
⊹ Muted: No
⊹ Tabchi: No
⊹ Warning Count: 0

[Inline Keyboard with Options]
```

**Examples:**  
1. `!UserPanel` (replying to user) - Open panel for that user
2. `!UserPanel 123456789` - Open panel for specific ID
3. `!UP` - Alias
4. `!Panel` - Alias

**Notes:**  
- Aliases: `!UP`, `!Panel`
- The inline keyboard provides sub-menus for:
  - Locks & Restrictions
  - Punishments & Release
  - Promote & Demote

---

# 24. Entertainment & Utilities Commands

## 24.1 `!Font`

**Overview:**  
Converts text to various stylish and decorative fonts.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `text` | Required | String | Text to convert |

**Examples:**  
- `!Font Hello World`
- `.Font Testing`

---

## 24.2 `!Time`

**Overview:**  
Displays the current time based on configured timezone.

**Examples:**  
- `!Time`
- `.Time`

---

## 24.3 `!Echo`

**Overview:**  
Bot repeats the provided text.

**Arguments:**  
| Argument | Required | Type |
|----------|----------|------|
| `text` | Required | String |

**Examples:**  
- `!Echo Welcome everyone!`

---

## 24.4 `!News`

**Overview:**  
Fetches latest news headlines.

**Examples:**  
- `!News`
- `.News`

---

## 24.5 `!Fortune`

**Overview:**  
Displays a random fortune or horoscope.

**Examples:**  
- `!Fortune`

---

## 24.6 `!Bio`

**Overview:**  
View or set user biography.

**Sub-commands:**  
- `!Bio` - View your bio
- `!SetBio [text]` - Set your bio

**Examples:**  
- `!Bio`
- `!SetBio I love coding!`

---

## 24.7 `!Calendar` / `!Date`

**Overview:**  
Displays current date in multiple calendar formats.

**Examples:**
- `!Calendar`
- `!Date`

---

## 24.8 `!Sticker` / `!MakeSticker`

**Overview:**  
Creates a sticker from an image (reply to image).

**Examples:**
- `!Sticker` (reply to image)
- `!MakeSticker`

---

## 24.9 `!Azan` / `!PrayerTimes`

**Overview:**  
Displays Islamic prayer times.

**Examples:**
- `!Azan`
- `!PrayerTimes`

---

## 24.10 `!Joke`

**Overview:**  
Sends a random joke.

**Examples:**
- `!Joke`
- `.Joke`

---

## 24.11 `!Poetry` / `!Poem`

**Overview:**  
Sends a random poem or verse.

**Examples:**
- `!Poetry`
- `!Poem`

---

## 24.12 `!Translate` / `!Tr`

**Overview:**  
Translates text between languages.

**Arguments:**  
| Argument | Required | Type | Description |
|----------|----------|------|-------------|
| `lang` | Required | String | Target language code (en, fa, etc.) |
| `text` | Required | String | Text to translate |

**Examples:**  
- `!Translate en سلام`
- `!Tr fa Hello`

---

## 24.13 `!ID`

**Overview:**  
Displays user ID or chat ID.

**Aliases:** `!ID`, `.ID`

**Examples:**  
- `!ID` - Your ID and chat ID
- `!ID` (reply) - Target user's ID

---

## 24.14 `!Currency` / `!Rate`

**Overview:**  
Displays current currency exchange rates.

**Aliases:** `!Currency`, `!Rate`

---

## 24.15 `!Info` / `!WhoIs`

**Overview:**  
Displays detailed user information.

**Aliases:** `!Info`, `!WhoIs`

---

## 24.16 `!JoinDate` / `!Joined`

**Overview:**  
Shows when a user joined the group.

**Aliases:** `!JoinDate`, `!Joined`

---

## 24.17 `!Origin` / `!Source`

**Overview:**  
Shows how a user joined the group (invite link, added by user, etc.).

**Aliases:** `!Origin`, `!Source`

---

## 24.18 `!Tag`

**Overview:**  
Tags/mentions multiple users.

**Arguments:**  
| Argument | Required | Type | Values |
|----------|----------|------|--------|
| `target` | Required | String | `all`, `admins` |

**Examples:**  
- `!Tag all` - Tag all members
- `!Tag admins` - Tag admins only

---

## 24.19 `!SetNick` / `!Nick` / `!RemNick`

**Overview:**  
Manage user nicknames.

**Examples:**  
- `!SetNick Boss` (reply to user)
- `!Nick` - View nickname
- `!RemNick` - Remove nickname

---

## 24.20 `!Profile`

**Overview:**  
Displays comprehensive user profile card.

**Aliases:** `!Profile`, `.Profile`

---

## 24.21 `!Meaning` / `!Define`

**Overview:**  
Looks up dictionary definition of a word.

**Arguments:**  
| Argument | Required | Type |
|----------|----------|------|
| `word` | Required | String |

**Examples:**  
- `!Meaning serendipity`
- `!Define ephemeral`

---

## 24.22 `!Rules` / `!SetRules`

**Overview:**  
View or set group rules.

**Examples:**  
- `!Rules` - View rules
- `!SetRules [text]` - Set rules

---

## 24.23 `!Pin` / `!Unpin`

**Overview:**  
Pin or unpin messages.

**Examples:**  
- `!Pin` (reply to message)
- `!Unpin`

---

## 24.24 `!GetLink` / `!Link`

**Overview:**  
Get the group's invite link.

**Aliases:** `!GetLink`, `!Link` (Note: `!Link` is primarily for Link Lock, check usage context or use `!GetLink` to be safe)

---

## 24.25 `!Weather`

**Overview:**  
Displays weather for a city.

**Arguments:**  
| Argument | Required | Type |
|----------|----------|------|
| `city` | Required | String |

**Examples:**  
- `!Weather Tehran`
- `!Weather London`

---

## 24.26 `!SetPhoto` / `!SetGroupPhoto`

**Overview:**  
Sets the group photo (reply to an image).

**Aliases:** `!SetPhoto`, `!SetGroupPhoto`

---

# 📚 Appendix

## Command Prefix Rules

All commands can be prefixed with either:
- `!` (exclamation mark) - Primary prefix
- `.` (period) - Alternative prefix

Both prefixes work identically.

## Permission Levels

| Level | Description |
|-------|-------------|
| **Member** | Regular group member |
| **VIP** | Exempted from some restrictions |
| **Manager/Mod** | Can use administrative commands |
| **Owner** | Full bot access within group |
| **Creator** | Telegram group creator, highest authority |

## Common Error Messages

| Error | Meaning |
|-------|---------|
| `⚠️ Only group admins can use this command.` | You need admin rights |
| `❌ Please reply to a user's message.` | Command requires a reply |
| `❌ Failed to update setting. Please try again.` | Database error |
| `⭐ Premium Feature` | Feature requires Premium subscription |
| `❌ I don't have permission...` | Bot lacks required Telegram permissions |

---

**Document End**

*This documentation was generated for the Firewall Telegram Bot. For support, contact the bot administrators.*
