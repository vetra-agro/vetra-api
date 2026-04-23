-- ============================================================
-- Vetra — Tabela de perfis de usuário
-- Executar no Supabase SQL Editor após a migration inicial
-- ============================================================

-- ── Enum de perfis de acesso ─────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'owner',      -- dono da fazenda / conta principal
  'manager',    -- gerente (acesso completo exceto admin)
  'agronomist', -- agrônomo (acesso a módulos de fazenda)
  'accountant', -- contador (acesso financeiro/contábil)
  'operator',   -- operador de campo (somente apontamentos)
  'viewer'      -- visualizador (somente leitura)
);

-- ── Tabela profiles ──────────────────────────────────────────
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   VARCHAR(200)  NOT NULL,
  email       VARCHAR(300)  NOT NULL,
  role        user_role     NOT NULL DEFAULT 'viewer',
  phone       VARCHAR(20),
  avatar_url  TEXT,
  farm_ids    UUID[]        DEFAULT '{}',  -- fazendas que o usuário tem acesso
  active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Índices ──────────────────────────────────────────────────
CREATE INDEX profiles_email_idx  ON profiles (email);
CREATE INDEX profiles_role_idx   ON profiles (role);
CREATE INDEX profiles_active_idx ON profiles (active);

-- ── Trigger updated_at ───────────────────────────────────────
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: cria profile automaticamente ao criar usuário ───
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'viewer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas o próprio perfil
CREATE POLICY profiles_self_read ON profiles
  FOR SELECT USING (id = auth.uid());

-- Usuário edita apenas o próprio perfil
CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Admins (owner/manager) veem todos os profiles da conta
-- (service_role bypass RLS — operações admin vão pela API)

-- ── View auxiliar para a API admin ───────────────────────────
-- Une profiles com auth.users para retornar last_sign_in_at
CREATE VIEW admin_users_view AS
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
FROM profiles p
JOIN auth.users u ON u.id = p.id;
