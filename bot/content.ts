import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../server/utils/logger.js";

/**
 * Extended command reference for multi-message display
 * Each element is a separate message to be sent sequentially
 */
export const EXTENDED_COMMANDS: readonly string[] = [
  // Message 1: Overview and User Moderation
  `📚 <b>Firewall Command Reference</b>

Use <code>!</code> or <code>.</code> prefix for all commands.
<i>Example: <code>!ban</code> or <code>.mute</code></i>

━━━━━━━━━━━━━━━━━━━━

<b>👤 USER MODERATION</b>

<code>!ban [hours]</code>
Ban a user. Reply to their message.
<i>Example: <code>!ban 24</code> = 24 hours</i>

<code>!mute [hours]</code>
Mute a user. Reply to their message.
<i>Example: <code>!mute 2</code> = 2 hours</i>

<code>!unmute</code>
Remove all restrictions from a user.

<code>!reset</code>
Reset user's warning count to zero.

<code>!kick</code>
Kick user from group (can rejoin).`,

  // Message 2: Content Locks
  `<b>🔒 CONTENT LOCKS</b>

<code>!lock [type]</code> — Enable restriction
<code>!unlock [type]</code> — Disable restriction

<b>Available lock types:</b>

<b>Links & URLs:</b>
• <code>link</code> — Telegram links
• <code>url</code> / <code>site</code> — External URLs
• <code>mention</code> / <code>id</code> — @usernames

<b>Media:</b>
• <code>photo</code> — Images
• <code>video</code> — Videos
• <code>sticker</code> — Stickers
• <code>gif</code> — Animations
• <code>voice</code> — Voice messages
• <code>audio</code> — Audio files
• <code>file</code> — Documents

<b>Content:</b>
• <code>forward</code> — Forwarded messages
• <code>poll</code> — Polls
• <code>game</code> — Games
• <code>bot</code> — Bot messages
• <code>inline</code> — Inline keyboards
• <code>slash</code> — /commands

<b>Text:</b>
• <code>hashtag</code> — #hashtags
• <code>emoji</code> — Emojis
• <code>emojionly</code> — Emoji-only messages
• <code>nocaption</code> — Media without caption

<b>Languages:</b>
• <code>english</code> — Latin text
• <code>persian</code> — Persian/Arabic
• <code>russian</code> — Cyrillic
• <code>chinese</code> — Chinese`,

  // Message 3: Filters and Quiet Hours
  `<b>📝 WORD FILTER</b>

<code>!filter [word]</code>
Add word to blacklist.
<i>Example: <code>!filter spam</code></i>

<code>!unfilter [word]</code>
Remove word from blacklist.

<code>!filters</code>
Show all filtered words.

━━━━━━━━━━━━━━━━━━━━

<b>🌙 QUIET HOURS</b>

Set times when only admins can message.

<code>!silence1 from HH:MM to HH:MM</code>
<i>Example: <code>!silence1 from 23:00 to 08:00</code></i>

<code>!silence1 off</code>
Disable quiet hours.

<code>!silence2</code> / <code>!silence3</code>
Additional quiet windows (Premium).

<code>!clearsilence</code>
Disable all quiet windows.`,

  // Message 4: Settings and Limits
  `<b>⚙️ SETTINGS</b>

<code>!welcome on/off</code>
Toggle welcome messages.

<code>!warning on/off</code>
Toggle violation warnings.

<code>!autowarning on/off</code>
Toggle automatic warning system.

<code>!warnthreshold [count]</code>
Set max warnings before action.
<i>Example: <code>!warnthreshold 3</code></i>

<code>!autodelete on/off</code>
Toggle auto-delete bot messages.

<code>!autodeletedelay [seconds]</code>
Set auto-delete delay.

<code>!joinleave on/off</code>
Toggle join/leave message removal.

━━━━━━━━━━━━━━━━━━━━

<b>📊 MESSAGE LIMITS</b>

<code>!msglimit [count]</code>
Max messages per time window.
<i>Example: <code>!msglimit 5</code></i>

<code>!msgwindow [minutes]</code>
Time window for rate limit.

<code>!duplicate [count]</code>
Max duplicate messages allowed.

<code>!minwords [count]</code>
Minimum words per message.

<code>!maxwords [count]</code>
Maximum words per message.`,

  // Message 5: Group Control and Whitelist
  `<b>🛡️ GROUP CONTROL</b>

<code>!lockgroup</code>
Emergency lock — only admins can send.

<code>!unlockgroup</code>
Remove emergency lock.

<code>!purge [count]</code>
Delete recent messages.
<i>Example: <code>!purge 50</code></i>

━━━━━━━━━━━━━━━━━━━━

<b>👥 WHITELIST</b>

Whitelisted users bypass all restrictions.

<code>!whitelist</code>
Add user to whitelist (reply).

<code>!unwhitelist</code>
Remove user from whitelist (reply).

<code>!clearwhitelist</code>
Remove all users from whitelist.

━━━━━━━━━━━━━━━━━━━━

<b>👥 MANDATORY MEMBERSHIP</b>

<code>!invite [count]</code>
Require users to invite others.
<i>Example: <code>!invite 3</code></i>

<code>!join @channel</code>
Require channel membership.
<i>Example: <code>!join @mychannel</code></i>

━━━━━━━━━━━━━━━━━━━━

💡 <b>Pro Tip:</b> Use the Mini App for visual controls and advanced settings!`,
];

export interface BotContent {
  buttons: {
    addToGroup: string;
    channel: string;
    commands: string;
    info: string;
    inlinePanel: string;
    managementPanel: string;
    miniApp: string;
  };
  messages: {
    channel: string;
    commands: string;
    info: string;
    inlinePanel: string;
    managementPanel: string;
    managementQuestion: string;
    start: string;        // ← added
    welcome: string;
  };
}

const fallbackContent: BotContent = {
  messages: {
    start: [
      "Welcome, {user}! 👋",
      "",
      "<b>Firewall</b> is your <b>complete group security solution</b> — designed for <i>smart</i>, <i>fast</i>, and <i>secure</i> community management.",
      "",
      "✨ <b>What Firewall does:</b>",
      "• 🛡️ <b>Automated spam protection</b> — Block unwanted content instantly",
      "• 🔒 <b>Smart content filtering</b> — Keep your group clean and safe",
      "• 📊 <b>Real-time analytics</b> — Track member activity and engagement",
      "• ⚡ <b>Instant moderation</b> — Automated warnings and restrictions",
      "",
      "<b>Getting started is easy:</b>",
      "1️⃣ Add Firewall to your supergroup",
      "2️⃣ Grant admin permissions",
      "3️⃣ Configure your settings in the Mini App",
      "",
      "<b>Firewall — Your community, protected.</b> 🔥"
    ].join("\n"),
    welcome: "Welcome to <b>{group}</b>, {user}! 👋\n\nWe're excited to have you here. Please take a moment to read our group rules and enjoy your stay!\n\n💡 <i>This group is protected by Firewall for your safety.</i>",
    managementPanel: "⚙️ <b>Management Dashboard</b>\n\n<b>Your command center for group management.</b>\n\n✨ <b>What you can do:</b>\n• 📊 View real-time analytics and insights\n• 🔒 Configure content locks and filters\n• ⚡ Monitor automated actions\n• 📈 Track member growth and engagement\n\n<i>Open the Mini App to access your full dashboard.</i>",
    managementQuestion: "<b>Choose Your Management Style</b>\n\nHow would you like to manage your group?\n\n🧩 <b>Mini App Dashboard</b>\n• Full visual interface\n• Detailed analytics and insights\n• Advanced settings and controls\n• Real-time monitoring\n\n⌨️ <b>Inline Panel</b> (Coming Soon)\n• Quick actions in chat\n• Lightweight controls\n• Fast access to essentials\n\n💡 <i>We recommend the Mini App for the complete experience!</i>",
    channel: "📢 <b>Join Our Official Channel</b>\n\n<b>Stay ahead with Firewall updates!</b>\n\n✨ <b>What you'll get:</b>\n• 🚀 New feature announcements\n• 🔐 Security tips and best practices\n• 🐛 Bug fixes and improvements\n• 💡 Pro tips for better moderation\n\n<i>Never miss an important update — join now!</i>",
    commands: "📚 <b>Firewall Command Reference</b>\n\nUse <code>!</code> or <code>.</code> prefix for commands.\n\n<b>👤 User Moderation</b>\n<code>!ban [hours]</code> — Ban user (reply)\n<code>!mute [hours]</code> — Mute user (reply)\n<code>!unmute</code> — Unmute user (reply)\n<code>!reset</code> — Reset warnings (reply)\n\n<b>🔒 Content Locks</b>\n<code>!lock [type]</code> — Lock content type\n<code>!unlock [type]</code> — Unlock content type\n\n<i>Types: link, url, photo, video, sticker, voice, file, gif, poll, forward, emoji, hashtag, mention, game, bot</i>\n\n<b>📝 Word Filter</b>\n<code>!filter [word]</code> — Add to blacklist\n<code>!unfilter [word]</code> — Remove from blacklist\n<code>!filters</code> — Show filter list\n\n<b>🌙 Quiet Hours</b>\n<code>!silence1 from HH:MM to HH:MM</code>\n<code>!silence1 off</code> — Disable\n\n<b>⚙️ Settings</b>\n<code>!welcome on/off</code>\n<code>!warning on/off</code>\n<code>!autodelete on/off</code>\n<code>!joinleave on/off</code>\n\n<b>🛡️ Group Control</b>\n<code>!lockgroup</code> — Emergency lock\n<code>!unlockgroup</code> — Unlock group\n<code>!purge [count]</code> — Delete messages\n\n<b>📊 Limits</b>\n<code>!msglimit [count]</code> — Rate limit\n<code>!duplicate [count]</code> — Anti-spam\n\n<b>👥 Whitelist</b>\n<code>!whitelist</code> — Add user (reply)\n<code>!unwhitelist</code> — Remove (reply)\n\n💡 <b>Tip:</b> Use Mini App for visual controls!",
    info: "🚀 <b>About Firewall</b>\n\n<b>Firewall</b> is proudly developed and maintained by <b>@iamSeyyed</b> with dedication to making Telegram communities safer and better.\n\n🙏 <b>Special Thanks:</b>\n• Development team for continuous improvements\n• Beta testers and early adopters\n• Every user who reports bugs and suggests features\n• All community admins who trust Firewall\n\n💬 <b>Your feedback matters!</b>\nEvery suggestion helps us improve. Together, we're building the best moderation bot for Telegram.\n\n<b>Firewall — Built with care, powered by community.</b> 🔥",
    inlinePanel: "🛠 <b>Inline Panel</b>\n\n⏳ <b>Coming Soon!</b>\n\nWe're working on bringing lightweight inline controls directly to your chat.\n\n<b>For now, use the Mini App to:</b>\n• 📊 View detailed analytics\n• ⚙️ Configure all settings\n• 🔒 Manage content locks\n• 📈 Track performance\n\n<i>Stay tuned for updates!</i>"
  },
  buttons: {
    addToGroup: "➕ Add to Group",
    managementPanel: "⚙️ Management Panel",
    channel: "📢 Channel",
    commands: "📚 Commands",
    info: "💬 Info",
    miniApp: "🧩 Open Mini App",
    inlinePanel: "⌨️ Inline Panel"
  }
};



export function loadBotContent(): BotContent {
  const filePath = resolve(dirname(fileURLToPath(import.meta.url)), "content.json");

  try {
    const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Partial<BotContent>;

    return {
      messages: {
        ...fallbackContent.messages,
        ...(parsed.messages ?? {})
      },
      buttons: {
        ...fallbackContent.buttons,
        ...(parsed.buttons ?? {})
      }
    };
  } catch (error) {
    logger.warn("bot falling back to default content", { error });
    return fallbackContent;
  }
}
