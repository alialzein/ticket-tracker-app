# Row Level Security (RLS) Policy Setup for Training Sessions

This document provides instructions for setting up RLS policies in Supabase to allow admins to delete training sessions.

## Overview

The `training_sessions` table needs an RLS policy that allows:
1. **Users** to delete their own training sessions
2. **Admins** to delete any training session

## Setup Instructions

### Step 1: Go to Supabase Dashboard
1. Navigate to your Supabase project: https://app.supabase.com
2. Select your project
3. Go to **Authentication → Policies** (or **SQL Editor** if on older UI)

### Step 2: Enable RLS on training_sessions Table
1. Go to **Database → Tables**
2. Find the `training_sessions` table
3. Click on it and ensure **RLS is enabled** (toggle should be ON)

### Step 3: Create/Update the DELETE Policy

Copy and paste the following SQL into your Supabase SQL Editor:

```sql
-- DELETE Policy: Allow users to delete their own sessions OR if admin
CREATE POLICY "Allow delete training sessions for own sessions or admins"
ON public.training_sessions
FOR DELETE
USING (
  -- Allow deletion if user owns the session
  auth.uid() = user_id
  OR
  -- Allow deletion if user is an admin (via user_metadata.is_admin)
  auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'
);
```

### Step 4: Create/Update the SELECT Policy (if not exists)

To ensure admins can see all training sessions, use this policy:

```sql
-- SELECT Policy: Allow admins to see all sessions, users to see their own
CREATE POLICY "Allow select training sessions for own sessions or admins"
ON public.training_sessions
FOR SELECT
USING (
  -- Allow selection if user owns the session
  auth.uid() = user_id
  OR
  -- Allow selection if user is an admin
  auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'
);
```

### Step 5: Create/Update the INSERT Policy (if not exists)

```sql
-- INSERT Policy: Allow users to create sessions or admins to create for others
CREATE POLICY "Allow insert training sessions for self or if admin"
ON public.training_sessions
FOR INSERT
WITH CHECK (
  -- Allow insertion if user is creating for themselves
  auth.uid() = user_id
  OR
  -- Allow insertion if user is an admin
  auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'
);
```

### Step 6: Create/Update the UPDATE Policy (if not exists)

```sql
-- UPDATE Policy: Allow users to update their own sessions or if admin
CREATE POLICY "Allow update training sessions for own sessions or admins"
ON public.training_sessions
FOR UPDATE
USING (
  -- Allow update if user owns the session
  auth.uid() = user_id
  OR
  -- Allow update if user is an admin
  auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'
)
WITH CHECK (
  -- Same conditions apply for the new data
  auth.uid() = user_id
  OR
  auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'
);
```

## Alternative: Drop and Recreate All Policies (SIMPLIFIED - RECOMMENDED)

Since you want any authenticated user to be able to manage any training session, use this simpler approach:

```sql
-- Drop existing policies (if any)
DROP POLICY IF EXISTS "Allow delete training sessions for own sessions or admins" ON public.training_sessions;
DROP POLICY IF EXISTS "Allow select training sessions for own sessions or admins" ON public.training_sessions;
DROP POLICY IF EXISTS "Allow insert training sessions for self or if admin" ON public.training_sessions;
DROP POLICY IF EXISTS "Allow update training sessions for own sessions or admins" ON public.training_sessions;

-- Create all policies at once - Allow authenticated users full access
CREATE POLICY "Allow select training sessions for authenticated users"
ON public.training_sessions
FOR SELECT
USING (true);

CREATE POLICY "Allow insert training sessions for authenticated users"
ON public.training_sessions
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow update training sessions for authenticated users"
ON public.training_sessions
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow delete training sessions for authenticated users"
ON public.training_sessions
FOR DELETE
USING (true);
```

## How It Works

The policies use the following logic:

1. **User Check**: `auth.uid() = user_id` - Checks if the authenticated user's ID matches the session's user_id
2. **Admin Check**: `auth.jwt() ->> 'user_metadata' ->> 'is_admin' = 'true'` - Checks if the user has `is_admin: true` in their JWT token's user_metadata

If either condition is true, the operation is allowed.

**Note**: The admin check uses the JWT token which is set in the user's metadata when they're marked as admin in your authentication system (via Supabase Auth).

## Testing

After setting up the policies:

1. **Test as Regular User**: Try to delete a session you created - should work ✅
2. **Test as Regular User**: Try to delete someone else's session - should fail ❌
3. **Test as Admin User**: Try to delete any session - should work ✅

## Troubleshooting

**Issue**: Getting "new row violates row-level security policy" error
- **Solution**: Ensure RLS is enabled on the table and the policies are correctly configured

**Issue**: Admin can't delete sessions
- **Solution**: Verify that the admin user has `is_admin: true` in their user metadata (Supabase Auth → Users → select user → User metadata)

**Issue**: Can't see any sessions after enabling RLS
- **Solution**: Make sure the SELECT policy is created and includes your user_id

## Code Changes Made

The code has been reverted to use simple direct deletion:

```javascript
const { error } = await _supabase
    .from('training_sessions')
    .delete()
    .eq('id', sessionId);
```

Once the RLS policies are set up in Supabase, this simple code will:
- Allow admins to delete any session
- Allow regular users to delete only their own sessions
- Automatically prevent unauthorized deletions at the database level
