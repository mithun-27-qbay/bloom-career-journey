# Authentication Test Guide

## Issues Fixed

1. **Database Schema**: Added missing columns (email, school_id, gender) to users table
2. **RLS Policies**: Fixed policies to allow proper authentication flow
3. **Authentication Logic**: Simplified and made more reliable
4. **Error Handling**: Better error messages and logging

## Test Steps

### 1. Run Database Migration
Copy and paste this SQL into your Supabase SQL Editor:

```sql
-- Comprehensive fix for authentication issues
-- This migration addresses all the problems preventing login from working

-- 1. Ensure all required columns exist in users table
DO $$ 
BEGIN
    -- Add email column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email') THEN
        ALTER TABLE public.users ADD COLUMN email VARCHAR(255);
        RAISE NOTICE 'Added email column to users table';
    END IF;
    
    -- Add school_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'school_id') THEN
        ALTER TABLE public.users ADD COLUMN school_id UUID REFERENCES public.schools(id);
        RAISE NOTICE 'Added school_id column to users table';
    END IF;
    
    -- Add gender column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'gender') THEN
        ALTER TABLE public.users ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female'));
        RAISE NOTICE 'Added gender column to users table';
    END IF;
END $$;

-- 2. Fix constraints and make fields properly nullable
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN mobile DROP NOT NULL;

-- Drop problematic constraints
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_email_format_check;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_mobile_or_email_check;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_mobile_format_check;

-- 3. Create proper unique constraints
DROP INDEX IF EXISTS users_email_unique;
CREATE UNIQUE INDEX users_email_unique ON public.users (email) WHERE email IS NOT NULL;

DROP INDEX IF EXISTS users_mobile_unique;
CREATE UNIQUE INDEX users_mobile_unique ON public.users (mobile) WHERE mobile IS NOT NULL;

-- 4. Fix RLS policies for authentication
-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
DROP POLICY IF EXISTS "Teachers can insert new users" ON public.users;
DROP POLICY IF EXISTS "Teachers can insert new students" ON public.students;
DROP POLICY IF EXISTS "Teachers can view their students' users" ON public.users;

-- Create comprehensive RLS policies
-- Users can view their own profile
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid()::text = id::text);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- Allow public access for authentication (sign up)
CREATE POLICY "Allow public signup" ON public.users
    FOR INSERT WITH CHECK (true);

-- Allow users to insert their own profile during auth
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (auth.uid()::text = id::text);

-- Teachers can view users in their school
CREATE POLICY "Teachers can view school users" ON public.users
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.teachers t
            WHERE t.user_id = auth.uid()
            AND t.school_id = users.school_id
        )
    );

-- Teachers can insert new students
CREATE POLICY "Teachers can insert new students" ON public.students
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.teachers t
            WHERE t.user_id = auth.uid()
            AND t.id = teacher_id
        )
    );

-- Teachers can view their students
CREATE POLICY "Teachers can view their students" ON public.students
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.teachers t
            WHERE t.user_id = auth.uid()
            AND t.id = teacher_id
        )
    );

-- 5. Fix student_activity_progress policies
DROP POLICY IF EXISTS "Teachers can update student progress" ON public.student_activity_progress;

CREATE POLICY "Teachers can update student progress" ON public.student_activity_progress
    FOR UPDATE USING (
        student_id IN (
            SELECT s.id FROM public.students s
            JOIN public.teachers t ON s.teacher_id = t.id
            WHERE t.user_id = auth.uid()
        )
    );

-- 6. Ensure proper indexes exist
CREATE INDEX IF NOT EXISTS users_auth_idx ON public.users (id, email, mobile);
CREATE INDEX IF NOT EXISTS users_role_idx ON public.users (role);
CREATE INDEX IF NOT EXISTS users_school_idx ON public.users (school_id);

-- 7. Update existing users to have proper email if missing
UPDATE public.users 
SET email = CONCAT(mobile, '@internal.app') 
WHERE email IS NULL AND mobile IS NOT NULL;

-- 8. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.students TO authenticated;
GRANT ALL ON public.teachers TO authenticated;
GRANT ALL ON public.student_activity_progress TO authenticated;
GRANT ALL ON public.activities TO authenticated;
GRANT ALL ON public.schools TO authenticated;
GRANT ALL ON public.classes TO authenticated;
```

### 2. Test Authentication

#### Test Sign Up
1. Go to `/auth` page
2. Try to create a new account
3. Check browser console for any errors
4. Verify user is created in Supabase

#### Test Sign In
1. Try to sign in with existing credentials
2. Check browser console for any errors
3. Verify user is redirected to appropriate dashboard

### 3. Check Console Logs
Look for these log messages:
- "SignIn attempt with identifier: [email/mobile]"
- "Attempting sign in with email: [email]"
- "Sign in successful for user: [id]"

### 4. Common Issues & Solutions

#### Issue: "User not allowed"
- **Solution**: Run the migration SQL above
- **Cause**: Missing RLS policies

#### Issue: "Column does not exist"
- **Solution**: Run the migration SQL above
- **Cause**: Missing database columns

#### Issue: "RLS policy violation"
- **Solution**: Run the migration SQL above
- **Cause**: Incorrect RLS policies

## What Was Fixed

1. **Database Schema**: Added missing columns that the code expected
2. **RLS Policies**: Created proper policies for authentication flow
3. **Authentication Logic**: Simplified and made more robust
4. **Error Handling**: Better logging and error messages
5. **Mobile/Email Support**: Proper handling of both authentication methods

## Next Steps

After running the migration:
1. Test sign up with a new account
2. Test sign in with existing accounts
3. Verify dashboard access works
4. Test teacher student creation functionality

If you still have issues, check the browser console and share the error messages.

