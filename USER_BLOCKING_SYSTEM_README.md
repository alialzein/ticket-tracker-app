# User Blocking System - Documentation

## Overview
The User Blocking System provides a two-tier warning and blocking system:
- **⚠️ Warning at 60 minutes**: Shows persistent warning banner
- **🚫 Blocking at 80 minutes**: Automatically blocks access to the system

This includes all break types: lunch, coffee, and personal breaks.

## Features

### 1. **60-Minute Warning** ⚠️
- Persistent banner appears at top of screen when break time reaches 60 minutes
- Shows current break time and time remaining until block (20 minutes countdown)
- Updates every minute with live countdown
- User can dismiss it by clicking the X button
- Warning will reappear on next check if user is still on break
- Bright orange/yellow gradient design with pulsing animation for visibility
- Positioned at top center of screen, cannot be ignored

### 2. **80-Minute Automatic Blocking** 🚫
- Monitors break time every minute
- Automatically blocks users when they exceed 80 minutes
- Shows a full-screen blocked page to the user
- Prevents access to the system until unblocked by admin
- Warning banner is hidden when user is blocked

### 3. **Admin Unblock Control**
- Admins see a 🔓 (unlock) button on blocked users in the team status
- One-click unblock functionality
- Visual indication: Blocked users have a red border and "🚫 Blocked" label

### 4. **User Experience**
- Full-screen blocking overlay
- Clear explanation of why they're blocked
- "Refresh Status" button to check if admin unblocked them
- "Logout" button to sign out

## Setup Instructions

### Step 1: Run the SQL Setup ⚠️ REQUIRED
Execute the SQL file in your Supabase SQL Editor:
```
ADD_user_blocking_system.sql
```

This will:
- Add `is_blocked`, `blocked_reason`, and `blocked_at` columns to the `attendance` table
- Create helper functions for calculating break time and unblocking users

### Step 2: Files Already Updated ✅

The following files have been updated automatically:

#### JavaScript Files:
1. **js/user-blocking.js** - Main blocking logic
   - Monitors break time every minute
   - Shows warning at 60 minutes
   - Blocks users at 80 minutes
   - Shows blocked page overlay
   - Handles admin unblock functionality

#### HTML Files:
2. **index.html** - Updated to include the user-blocking script

#### Modified Files:
3. **js/main.js**
   - Initializes the blocking system
   - Shows unblock button for admins in team status
   - Displays blocked user indicator

4. **js/schedule.js**
   - Fetches `is_blocked` fields from database
   - Updates attendance state with blocking information

## How It Works

### For Regular Users:

#### 1. **During Break (0-59 minutes):**
- User takes a break (lunch, coffee, or personal)
- System checks break duration every minute
- No warnings shown yet

#### 2. **Warning Phase (60-80 minutes):**
- **At 60 minutes**: Persistent warning banner appears at top of screen
- Banner shows:
  - "You have been on break for 60 minutes"
  - "You will be automatically blocked in 20 minutes"
  - Countdown updates every minute
- User can close the banner with X button
- **Banner reappears** on next check cycle if still on break (persistent until break ends)

#### 3. **Blocked (>80 minutes):**
- Full-screen overlay appears
- Message explains they exceeded 80 minutes
- User can:
  - Click "Refresh Status" to check if unblocked
  - Click "Logout" to sign out
- Cannot access the system

#### 4. **After Unblock:**
- Admin clicks the 🔓 button
- User clicks "Refresh Status"
- Access is restored
- Page reloads automatically

### For Admins:

1. **Viewing Blocked Users:**
   - Blocked users show "🚫 Blocked" label
   - Red border around their team status card
   - 🔓 (unlock) button appears

2. **Unblocking:**
   - Click the 🔓 button next to the blocked user
   - Confirmation notification appears
   - Page reloads automatically
   - User can now access the system

## Visual Examples

### Warning Banner (60 minutes):
```
┌────────────────────────────────────────────────────────┐
│ ⚠️  Break Time Warning                            [X]  │
│                                                         │
│ You have been on break for 60 minutes.                 │
│ You will be automatically blocked in 20 minutes        │
│ if you don't end your break.                           │
│                                                         │
│ Maximum allowed break time: 80 minutes.                │
│ Please end your break soon to avoid being locked out.  │
└────────────────────────────────────────────────────────┘
```

### Blocked Screen (>80 minutes):
```
┌─────────────────────────────────────┐
│     ⚠️  ACCESS BLOCKED              │
│                                      │
│  Your access has been blocked       │
│                                      │
│  Reason: Exceeded 80 minutes        │
│  total break time (85 minutes)      │
│                                      │
│  Contact administrator              │
│                                      │
│  [ Logout ]  [ Refresh Status ]     │
└─────────────────────────────────────┘
```

## Technical Details

### Database Schema
```sql
-- attendance table additions
is_blocked BOOLEAN DEFAULT FALSE
blocked_reason TEXT
blocked_at TIMESTAMP WITH TIME ZONE
```

### Break Time Thresholds
```javascript
const WARNING_BREAK_MINUTES = 60;  // Show warning
const MAX_BREAK_MINUTES = 80;      // Block user
```

### Warning Logic
- Warning shown when: `elapsedMinutes >= 60`
- Warning persists until: User ends break OR gets blocked
- Warning can be dismissed but will reappear on next check
- Check interval: Every 60 seconds

### Blocking Logic
```javascript
// Checked every minute
if (elapsedMinutes > 80) {
    blockUser();
    hideWarning();
    showBlockedPage();
}
```

### Unblocking
```sql
-- RPC function
CREATE FUNCTION unblock_user(p_attendance_id INTEGER)
RETURNS JSON
-- Sets is_blocked = FALSE, clears blocked_reason and blocked_at
```

## Configuration

### Change Warning Time (default: 60 minutes)
Edit `js/user-blocking.js`:
```javascript
const WARNING_BREAK_MINUTES = 60;  // Change this value
```

### Change Maximum Break Time (default: 80 minutes)
Edit `js/user-blocking.js`:
```javascript
const MAX_BREAK_MINUTES = 80;  // Change this value
```

### Change Check Interval (default: 1 minute)
Edit `js/user-blocking.js`:
```javascript
blockCheckInterval = setInterval(checkCurrentUserBreakTime, 60000); // milliseconds
```

## Testing

### Test the Warning System:

1. **Manual Test:**
   ```javascript
   // In browser console
   // Simulate a 61-minute break
   await _supabase.from('attendance')
       .update({
           lunch_start_time: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
           on_lunch: true
       })
       .eq('id', appState.currentShiftId);

   // Wait 1 minute for the check to run - warning should appear
   ```

2. **Test Blocking:**
   ```javascript
   // Simulate an 81-minute break
   await _supabase.from('attendance')
       .update({
           lunch_start_time: new Date(Date.now() - 81 * 60 * 1000).toISOString(),
           on_lunch: true
       })
       .eq('id', appState.currentShiftId);

   // Wait 1 minute for the check to run - should be blocked
   ```

3. **Test Unblock:**
   ```javascript
   // As admin, click the 🔓 button
   // Or via console:
   await window.userBlocking.unblockUser(ATTENDANCE_ID);
   ```

## Troubleshooting

### Warning Not Appearing:
- Check browser console for errors
- Verify `user-blocking.js` is loaded
- Check if break time is actually >= 60 minutes
- Ensure `appState.currentShiftId` is set
- Check if warning was dismissed (will reappear on next check)

### User Not Getting Blocked:
- Check browser console for errors
- Verify break time is actually > 80 minutes
- Check if `warningShown` flag is set correctly

### Unblock Button Not Showing:
- Verify user is admin: `appState.currentUserRole === 'admin'`
- Check if `is_blocked` is true in database
- Refresh the page

### Warning Persists After Break Ends:
- This is intentional - warning resets when user ends break
- If issue persists, check `on_lunch` status in database

## Timeline Example

```
0 min  ────────────────────────────────────────────
       User starts break
       ✅ No warnings

60 min ────────────────────────────────────────────
       ⚠️  WARNING APPEARS
       "You will be blocked in 20 minutes"
       User can dismiss but it will reappear

65 min ────────────────────────────────────────────
       ⚠️  WARNING UPDATES
       "You will be blocked in 15 minutes"

70 min ────────────────────────────────────────────
       ⚠️  WARNING UPDATES
       "You will be blocked in 10 minutes"

80 min ────────────────────────────────────────────
       🚫 USER BLOCKED
       Full-screen overlay appears
       Cannot access system

Admin  ────────────────────────────────────────────
       Clicks 🔓 button

User   ────────────────────────────────────────────
       Clicks "Refresh Status"
       ✅ Access restored
```

## Security Notes

1. **Database Functions:** Use `SECURITY DEFINER` for RLS bypass
2. **Admin Check:** Role verification happens client-side and server-side
3. **Real-time Updates:** System checks every minute, so there's up to 60s delay
4. **Warning Persistence:** Warning cannot be permanently dismissed while on break

## Future Enhancements

Potential improvements:
- [ ] Email notification to admin when user is blocked
- [ ] Sound alert at 60-minute warning
- [ ] More aggressive warnings at 75 minutes
- [ ] Historical log of blocks per user
- [ ] Configurable break time limits per user role
- [ ] Mobile app push notifications
- [ ] Break time analytics dashboard

## Support

For issues or questions:
1. Check browser console for errors
2. Verify SQL setup was completed
3. Check Supabase logs for RPC errors
4. Ensure all files are properly deployed
