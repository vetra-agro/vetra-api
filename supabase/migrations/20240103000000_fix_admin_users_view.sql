-- ============================================================
-- Fix admin_users_view: recriar com SECURITY DEFINER para
-- garantir acesso a auth.users via PostgREST (service_role)
-- ============================================================

DROP VIEW IF EXISTS admin_users_view;

CREATE OR REPLACE FUNCTION get_admin_users()
RETURNS TABLE (
  id                UUID,
  full_name         VARCHAR(200),
  email             VARCHAR(300),
  role              user_role,
  phone             VARCHAR(20),
  avatar_url        TEXT,
  farm_ids          UUID[],
  active            BOOLEAN,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  last_sign_in_at   TIMESTAMPTZ,
  email_confirmed_at TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.role,
    p.phone,
    p.avatar_url,
    p.farm_ids,
    p.active,
    p.created_at,
    p.updated_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.confirmed_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id;
$$;

GRANT EXECUTE ON FUNCTION get_admin_users() TO service_role, authenticated;

-- Recria a view apoiada na função SECURITY DEFINER
CREATE VIEW admin_users_view AS
  SELECT * FROM get_admin_users();

GRANT SELECT ON admin_users_view TO service_role, authenticated;
