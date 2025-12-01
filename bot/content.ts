import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../server/utils/logger.js";

/**
 * Extended command reference for multi-message display
 * Each element is a separate message to be sent sequentially
 */
export const EXTENDED_COMMANDS: readonly string[] = [
  // Message 1: Intro & Basic Locks
  `🔷 <b>Robot Configuration via Text Commands</b>

<b>🔷 Basic Explanation</b>
❗️ All admin commands must start with <code>!</code> or <code>.</code>
❗️ Commands should be sent as normal text messages in the group.

<b>🔷 User Moderation</b>
Reply to a user's message to execute these actions:
• <code>!ban 1</code> — Ban for 1 hour
• <code>!mute 24</code> — Mute for 24 hours
• <code>!unmute</code> — Unban/Unmute
• <code>!kick</code> — Kick user
• <code>!reset</code> — Reset warnings
💡 1 = 1 hour. 1000 = Permanent.

<b>🔷 Credit</b>
• <code>!charge</code> — Renew credit
• <code>!credit</code> — Check expiration

<b>🔷 Lock Types (Part 1)</b>
Enable/Disable restrictions:
• <code>!lock link</code> / <code>!unlock link</code> — Telegram links
• <code>!lock username</code> / <code>!unlock username</code> — @usernames
• <code>!lock site</code> / <code>!unlock site</code> — Web links
• <code>!lock porn</code> / <code>!unlock porn</code> — NSFW content
• <code>!lock hashtag</code> / <code>!unlock hashtag</code> — #hashtags
• <code>!lock text</code> / <code>!unlock text</code> — Text messages
• <code>!lock forward</code> / <code>!unlock forward</code> — Forwards
• <code>!lock channelforward</code> — Channel forwards
• <code>!lock photo</code> — Photos
• <code>!lock video</code> — Videos
• <code>!lock sticker</code> — Stickers
• <code>!lock location</code> — Locations
• <code>!lock phone</code> — Phone numbers
• <code>!lock voice</code> — Voice notes
• <code>!lock file</code> — Files
• <code>!lock app</code> — Applications/Software
• <code>!lock gif</code> — GIFs
• <code>!lock poll</code> — Polls
• <code>!lock slash</code> — Bot commands`,

  // Message 2: More Locks & Limits
  `<b>🔷 Lock Types (Part 2)</b>
• <code>!lock captionless</code> — Media without caption
• <code>!lock emojionly</code> — Emoji-only messages
• <code>!lock emoji</code> — Messages with emoji
• <code>!lock game</code> — Games
• <code>!lock english</code> — English text
• <code>!lock persian</code> — Persian/Arabic text
• <code>!lock reply</code> — User replies
• <code>!lock crossreply</code> — Replies to other chats

<b>🔷 Whitelist</b>
Exempt users from all rules:
• <code>!whitelist</code> — Add (Reply)
• <code>!unwhitelist</code> — Remove (Reply)
• <code>!clearwhitelist</code> — Clear all

<b>🔷 Message Limits</b>
Limit user activity:
• <code>!msglimit 5</code> — Max 5 messages
• <code>!msgwindow 60</code> — Per 60 minutes
• <code>!duplicate 3</code> — Max 3 duplicate messages
• <code>!dupwindow 60</code> — Per 60 minutes
• <code>!minwords 3</code> — Min words per message`,

  // Message 3: Membership & Control
  `<b>🔷 Word Limits</b>
• <code>!maxwords 10</code> — Max words per message

<b>🔷 Mandatory Membership</b>
Require users to invite others:
• <code>!invite 5</code> — Must invite 5 users
• <code>!invite off</code> — Disable

Require channel membership:
• <code>!join @channel</code> — Must join channel
• <code>!channel off</code> — Disable

<b>🔷 Bots & Spam</b>
• <code>!lock bot</code> — Auto-ban added bots
• <code>!lock botinviter</code> — Ban bot inviters

<b>🔷 Quiet Hours</b>
Silence group at specific times:
• <code>!silence1 from 23:00 to 08:00</code>
• <code>!silence1 off</code>
• <code>!silence2 ...</code> (Premium)
• <code>!silence3 ...</code> (Premium)
• <code>!clearsilence</code> — Remove all

<b>🔷 Group Lock</b>
Manual emergency lock:
• <code>!lockgroup</code> — Lock group
• <code>!unlockgroup</code> — Unlock group`,

  // Message 4: Filter & Settings
  `<b>🔷 Word Filter</b>
• <code>!filter word</code> — Filter a word
• <code>!unfilter word</code> — Unfilter a word
• <code>!filters</code> — Show list

<b>🔷 Cleanup</b>
• <code>!purge 100</code> — Delete last 100 messages

<b>🔷 Settings</b>
• <code>!welcome on</code> / <code>off</code> — Welcome messages
• <code>!warn on</code> / <code>off</code> — Warning messages
• <code>!autowarn on</code> / <code>off</code> — Auto-warning
• <code>!warnthreshold 3</code> — Max warnings
• <code>!warnretention 2</code> — Days to keep warns
• <code>!autodelete on</code> / <code>off</code> — Auto-delete bot messages
• <code>!autodeletedelay 2</code> — Delay in minutes
• <code>!joinleave on</code> — Hide join/leave messages
• <code>!joinleave off</code> — Show join/leave messages
• <code>!adminlock on</code> / <code>off</code> — Apply rules to admins`,

  // Message 5: Public & Panel
  `<b>🔷 Public Commands</b>
• <code>!publiccmds lock</code> — Disable public commands
• <code>!publiccmds unlock</code> — Enable public commands

<b>🔷 Management Panel</b>
For advanced settings, statistics, and easier configuration, use the Mini App:

Click the <b>Dashboard</b> button below to open the full management panel!`,
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
