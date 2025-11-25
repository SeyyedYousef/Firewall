import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../server/utils/logger.js";

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
    commands: "📚 <b>Command Reference</b>\n\n<b>Essential commands to get started:</b>\n\n🔹 <code>/start</code> — Open the main menu\n🔹 <code>/panel</code> — Access management dashboard\n🔹 <code>/help</code> — Get help and support\n🔹 <code>/settings</code> — Configure group settings\n\n💡 <b>Pro tip:</b> Use the Mini App for the best experience with full visual controls and analytics.\n\n<i>More commands coming soon!</i>",
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
