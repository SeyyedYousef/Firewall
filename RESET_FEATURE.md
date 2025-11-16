# Bot Reset Feature Documentation

## Overview
The Bot Reset feature provides a complete reset functionality for the Firewall bot. This feature is exclusively available to the bot owner and allows for a complete wipe and restart of the bot to a fresh installation state.

## Features
- **Owner-only access**: Only the main bot owner can access this feature
- **Password protection**: Requires a specific password (`0706203830`) for security
- **Persian confirmation**: Requires typing "تایید می‌کنم" (I confirm) for final confirmation
- **Complete reset**: Leaves all groups, deletes all data, and resets bot state

## How to Use

### Step 1: Access Owner Panel
1. Send `/panel` command to the bot in a private chat
2. Ensure you are the bot owner (configured in environment variables)

### Step 2: Initiate Reset
1. Click on "🔴 Reset Bot Completely" button in the owner panel
2. You will see a warning message about what the reset will do

### Step 3: Enter Password
1. Type the password: `0706203830`
2. If correct, you'll see a final warning with group count

### Step 4: Final Confirmation
1. Type the confirmation phrase: `تایید می‌کنم`
2. The reset process will begin automatically

## What Happens During Reset

### 1. Leave Groups
- Bot will attempt to leave all groups it's currently in
- Failed attempts are logged but don't stop the process

### 2. Database Cleanup
- Deletes all group records
- Deletes all stars transactions
- Deletes all firewall rules
- Deletes all membership events
- Deletes all analytics events

### 3. State Reset
- Resets bot state to empty/default values
- Clears panel admins list
- Clears banned users list
- Resets all settings to defaults

## Security Features
- **Owner verification**: Only the configured bot owner can access
- **Password protection**: Requires correct password
- **Confirmation phrase**: Must type exact Persian confirmation
- **Multiple warnings**: Shows warnings at each step
- **Cancellation**: Can use `/panel` to cancel at any time

## Error Handling
- Invalid password: Shows error and allows retry
- Wrong confirmation: Shows error with exact phrase needed
- Database errors: Stops process and shows error message
- Network errors: Shows detailed error information

## Testing Steps

### Prerequisites
1. Bot must be running and accessible
2. You must be configured as the bot owner
3. Bot should be in at least one group for testing

### Test Procedure
1. **Access Test**: Send `/panel` and verify you can access owner panel
2. **Button Test**: Verify "🔴 Reset Bot Completely" button appears
3. **Password Test**: 
   - Try wrong password, verify error message
   - Try correct password, verify progression
4. **Confirmation Test**:
   - Try wrong confirmation, verify error
   - Try correct confirmation, verify reset starts
5. **Reset Verification**:
   - Check bot left all groups
   - Verify database is cleaned
   - Confirm bot state is reset
   - Test bot functionality after reset

### Expected Results
- Bot should leave all groups successfully
- All database records should be deleted
- Bot state should be reset to fresh installation
- Bot should be fully functional after reset
- Owner panel should work normally after reset

## API Endpoint
- **URL**: `POST /api/reset-bot`
- **Authentication**: Owner Telegram ID verification
- **Body**: `{ "ownerTelegramId": "...", "confirmationCode": "RESET_CONFIRMED" }`
- **Response**: `{ "success": true, "groupsLeft": N, "recordsDeleted": N, "message": "..." }`

## Files Modified
- `bot/state.ts` - Added new owner session states
- `bot/index.ts` - Added reset button and handlers
- `server/api/routes/admin.ts` - Created reset API endpoint
- `server/api/router.ts` - Added admin router

## Configuration
No additional configuration required. The feature uses existing:
- Owner Telegram ID from environment
- Database connection (Prisma)
- Telegram bot instance

## Troubleshooting

### Common Issues
1. **"Unauthorized" error**: Verify you're the configured bot owner
2. **"Invalid confirmation"**: Type exact phrase "تایید می‌کنم"
3. **Database errors**: Check database connection and permissions
4. **Network errors**: Verify bot can access Telegram API

### Recovery
If reset fails partially:
- Database may be partially cleaned
- Some groups may still have the bot
- Manual cleanup may be required
- Check logs for specific error details
