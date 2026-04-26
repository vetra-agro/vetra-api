-- ============================================================
-- Vetra / Supabase
-- User Creation Diagnostic Script
--
-- Purpose:
-- 1) Validate trigger bindings used during auth user creation.
-- 2) Validate function definitions and execution context.
-- 3) Validate role enum compatibility for profile creation.
-- 4) Surface common causes of "Database error creating new user".
--
-- Run this script in Supabase SQL Editor.
-- ============================================================

-- 0) Runtime context
SELECT
  now() AS diagnostic_timestamp,
  current_database() AS database_name,
  current_user AS current_db_user,
  version() AS postgres_version;

-- 1) Confirm expected triggers on auth.users and public.profiles
SELECT
  t.tgname,
  ns_tbl.nspname AS table_schema,
  cls.relname AS table_name,
  t.tgenabled,
  ns_fn.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class cls ON cls.oid = t.tgrelid
JOIN pg_namespace ns_tbl ON ns_tbl.oid = cls.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace ns_fn ON ns_fn.oid = p.pronamespace
WHERE (ns_tbl.nspname = 'auth' AND cls.relname = 'users')
   OR (ns_tbl.nspname = 'public' AND cls.relname = 'profiles')
ORDER BY ns_tbl.nspname, cls.relname, t.tgname;

-- 2) Check function metadata (owner/security/language)
SELECT
  n.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS is_security_definer,
  l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname IN ('handle_new_user', 'audit_table_changes')
ORDER BY p.proname;

-- 3) Print current function bodies (ground truth)
SELECT pg_get_functiondef('public.handle_new_user'::regproc) AS handle_new_user_definition;
SELECT pg_get_functiondef('public.audit_table_changes'::regproc) AS audit_table_changes_definition;

-- 4) Validate enum values used by role casting logic
SELECT
  t.typname AS enum_name,
  e.enumsortorder,
  e.enumlabel
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname = 'user_role'
ORDER BY e.enumsortorder;

-- 5) Validate critical objects exist
SELECT
  to_regclass('public.profiles') IS NOT NULL AS profiles_exists,
  to_regclass('public.audit_logs') IS NOT NULL AS audit_logs_exists,
  to_regclass('auth.users') IS NOT NULL AS auth_users_exists;

-- 6) Quick profile consistency checks
SELECT
  COUNT(*) AS duplicate_profile_emails
FROM (
  SELECT lower(email) AS normalized_email
  FROM public.profiles
  GROUP BY lower(email)
  HAVING COUNT(*) > 1
) d;

SELECT
  COUNT(*) AS profiles_without_auth_user
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;

-- 7) Check for auth hook objects (older/newer projects may differ)
SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  c.relkind AS object_kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname ILIKE '%hook%'
ORDER BY c.relname;

-- 8) Focused view of the creation trigger only
SELECT
  t.tgname,
  t.tgenabled,
  ns_fn.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace ns_fn ON ns_fn.oid = p.pronamespace
WHERE t.tgrelid = 'auth.users'::regclass
  AND t.tgname = 'on_auth_user_created';

-- End of diagnostic
