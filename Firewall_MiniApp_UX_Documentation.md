# Firewall Mini App UX Documentation

This document details the User Experience (UX) and User Interface (UI) flows for the Firewall Telegram Mini App. It is designed to provide a comprehensive reference for the frontend implementation, separate from the bot command logic.

## 📱 Application Overview
The Mini App serves as a graphical dashboard for managing Telegram groups, offering a more intuitive and feature-rich interface compared to chat-based commands.

### Navigation Structure (Sitemap)

- **/** (Dashboard Page) - *Entry Point*
- **/groups/:groupId** (Group Dashboard)
  - **/analytics** (Group Analytics)
  - **/upgrade** (Premium Upgrade Page)
  - **/settings/general** (General Settings)
  - **/settings/bans** (Content Restrictions)
  - **/settings/limits** (Usage Limits)
  - **/settings/mute** (Quiet Hours)
  - **/settings/mandatory** (Mandatory Membership)
  - **/settings/texts** (Custom Messages)
- **/stars** (Stars Balance & Packages)
- **/giveaways** (Giveaways Dashboard)
  - **/create** (Create Giveaway)
  - **/:giveawayId** (Join Giveaway)
- **/promo-slides/manage** (Promo Slider Manager)

---

## 🖥️ Page-by-Page UX Details

### 1. Dashboard Page (`/`)
The landing page for users opening the Mini App.

*   **Header**: "My Groups" with total count.
*   **Promo Slider**: Dynamic sliding banners (if active promos exist) for feature highlights.
*   **Widgets Section**: Quick stats summary cards.
    *   **Premium**: Count of premium groups (Warning tone).
    *   **Free**: Count of free groups (Info tone).
    *   **Today's messages**: Total message volume (Primary tone).
    *   **New members**: Total new joins (Success tone).
*   **Toolbar**:
    *   **Filters**: Chips to filter list by `All`, `Active`, `⭐ Premium`, `🆓 Free`.
    *   **Search**: Text input to filter by group title (appears if > 6 groups).
    *   **Sort**: Dropdown to sort by `Soonest expiry`, `Alphabetical`, `Members`.
*   **Group List**:
    *   **Cards**: show Group Avatar, Title, Member count, Status (Protected, Basic, Expired, Inactive).
    *   **Badges**: `⭐ Premium` or `🆓 Free`.
    *   **Actions**:
        *   `⚙️ Manage`: Opens Group Dashboard.
        *   `⭐ Upgrade`: Opens Stars/Upgrade page (only for Free groups).
    *   **Warning**: specific styling for removed/inactive groups.
*   **Empty State**: "No groups found" with an Invite URL to add the bot to a new group.

### 2. General Settings (`/groups/:groupId/settings/general`)
Configuration of core group behaviors.

*   **Time Zone**: Dropdown with extensive global timezone support (UTC to Pacific). Affects all schedules.
*   **Welcome Message**: toggle switch + `Execution window` (Schedule).
*   **Vote to Mute** (🔒 Premium): Toggle to allow members to vote-mute violators. Locked for free groups.
*   **Warning Message**: Toggle to warn users before penalizing + `Execution window`.
*   **Auto-delete Bot Messages**: Toggle + Duration input (seconds).
*   **Track Admin Violations**: Toggle.
    *   *Sub-options*: "Only log violations" or "Delete the admin's message".
*   **Verify New Members**: Toggle + `Verification schedule`.
*   **Public Commands**: Toggle to disable commands like `/help` for non-admins + `Restriction window`.
*   **Hide Join/Leave Messages**: Toggle + `Message removal window`.
*   **Default System Penalty**: Select `Delete message`, `Mute`, or `Kick`.
*   **Automatic Warning Counter** (🔒 Premium):
    *   Toggle.
    *   **Threshold**: Number of allowed warnings (input).
    *   **Retention**: Days to keep warnings (input).
    *   **Penalty**: Action on threshold breach (Delete/Mute/Kick).
    *   **Schedule**: Execution window.
*   **Captcha Verification** (🔒 Premium):
    *   **Type**: `Disabled`, `Button click (Free)`, `Math challenge (Premium)`, `Image captcha (Premium)`.

### 3. Ban Settings / Content Restrictions (`/groups/:groupId/settings/bans`)
Detailed control over allowed content types.

*   **Categorized Accordions**:
    *   **Links & IDs**: Remove links, Block domains, usernames, bot inviters.
    *   **Text & Symbols**: Hashtags, Text patterns, Emojis, Phone numbers.
    *   **Media & Files**: Photos, Stickers, Audio, Voice, Files, GIFs.
    *   **Interactions**: Forwards, Channel forwards, Polls, Games, Inline keyboards, Slash commands.
    *   **Languages**: Latin, Persian/Arabic, Cyrillic, Chinese.
    *   **Advanced**: Captionless posts, User replies, Cross-chat replies.
*   **Rule Configuration**:
    *   Each rule has a **Toggle** (Enable/Disable).
    *   **Execution Window** (🔒 Premium): active `At all hours` vs `Only during specific hours` (Start/End time inputs).
*   **Keyword Lists**:
    *   **Banned Keywords**: Textarea for blacklisted words (newline separated).
    *   **Required Keywords**: Textarea for whitelisted words.
    *   **Actions**: `Import` (paste list), `Copy export` (copy to clipboard).

### 4. Navigation Drawer
A slide-out menu available on all settings pages for quick navigation.

*   **Items**:
    *   🏠 Dashboard
    *   ⚙️ General settings
    *   🛡️ Content restrictions (Bans)
    *   📏 Limits
    *   🔕 Quiet hours (Mute)
    *   📌 Mandatory membership
    *   💬 Custom messages
    *   📊 Analytics

### 5. Giveaways (`/giveaways`)
A complete module for running group giveaways using Telegram Stars.

*   **Create Giveaway Wizard** (`/giveaways/create`):
    *   **Step 1 - Reward**: Select a subscription plan duration (e.g., 30 days) and see the price per winner.
    *   **Step 2 - Host & Channels**: 
        *   Select the main Host Group.
        *   Add extra required channels (optional) with validation.
        *   Manage included channels list (remove tag).
    *   **Step 3 - Extra Links**: Add up to 10 external URLs that participants must visit (optional).
    *   **Step 4 - Timing & Winners**:
        *   **Duration**: Presets (e.g., 6 hours) or Custom (hours input).
        *   **Winners**: Number of winners (min 1).
    *   **Step 5 - Participant Rules**:
        *   **Premium Only**: Toggle (require Telegram Premium).
        *   **Chat Booster Only**: Toggle (require boosting host chat).
        *   **Invite Friend**: Toggle (require inviting 1 unique friend).
        *   **Notifications**: Toggle start/end announcements in the channel.
        *   **Title**: Optional custom title.
    *   **Step 6 - Summary**: Review Host, Reward, Winners, Duration, and **Total Cost** in Stars.
*   **Join Giveaway** (`/giveaways/:id`):
    *   User-facing page to check requirements, join, and view status.

### 6. Stars & Upgrades
*   **Balance**: View current Stars balance.
*   **Packages**: List of purchasable Star packages.
*   **Upgrade**: specific flow to spend Stars to upgrade a group to Premium.

---

## 💎 Premium Features UX
Features that trigger a "Premium Lock" UI if accessed by a Free group.

1.  **Visual Lock**: Sections valid only for Premium/Pro plans display a generic or styled lock icon (🔒 / ⭐).
2.  **Interaction**: Clicking a locked feature opens an upsell modal or navigates to the `/upgrade` page.
3.  **Specific Locked Features**:
    *   **Scheduling**: "Only during specific hours" mode in any schedule setting.
    *   **Vote to Mute**: Entire card locked.
    *   **Auto Warning Counter**: Entire card locked.
    *   **Advanced Captcha**: Math & Image types disabled in dropdown.
    *   **Webhook / Priority Processing**: Indicated as auto-enabled for Premium.

## 🧩 Common UI Patterns

*   **Loading State**: Spinning generic loader centered on screen.
*   **Empty State**: "No items found" placeholder with relevant action button (e.g., "Retry" or "Go Back").
*   **Toast Notifications**: Bottom snackbar for success/error messages (e.g., "Settings saved successfully ✅").
*   **Haptic Feedback**: Used on primary interactions (Manage button, Save, Toggle).
*   **Theme**: Adapts to Telegram's native color scheme (`var(--tg-theme-...)`).
