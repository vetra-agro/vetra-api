-- ============================================================
-- Vetra — Vínculo usuário ↔ tenant (multi-tenant)
-- Executar após migration de licenças
-- ============================================================

-- ── Tabela de vínculo ────────────────────────────────────────
CREATE TABLE user_tenants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'viewer',  -- perfil neste tenant
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,          -- tenant padrão do usuário
  invited_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX user_tenants_user_idx   ON user_tenants (user_id);
CREATE INDEX user_tenants_tenant_idx ON user_tenants (tenant_id);

CREATE TRIGGER trg_user_tenants_updated_at
  BEFORE UPDATE ON user_tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas seus próprios vínculos
CREATE POLICY user_tenants_self ON user_tenants
  FOR SELECT USING (user_id = auth.uid());

-- ── View: tenants do usuário com status de licença ────────────
CREATE VIEW user_tenant_access AS
SELECT
  ut.user_id,
  ut.tenant_id,
  ut.role,
  ut.is_default,
  t.name          AS tenant_name,
  t.document,
  t.email         AS tenant_email,
  l.plan,
  l.status        AS license_status,
  l.modules,
  l.expires_at,
  l.max_users,
  l.max_farms,
  (l.expires_at - CURRENT_DATE) AS days_remaining
FROM user_tenants ut
JOIN tenants t        ON t.id = ut.tenant_id
JOIN licenses l       ON l.tenant_id = ut.tenant_id
WHERE l.status IN ('active', 'trial')
ORDER BY ut.is_default DESC, t.name;

-- ── Função: garantir somente um is_default por usuário ────────
CREATE OR REPLACE FUNCTION ensure_single_default_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE user_tenants
    SET is_default = FALSE
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND is_default = TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_default_tenant
  AFTER INSERT OR UPDATE OF is_default ON user_tenants
  FOR EACH ROW WHEN (NEW.is_default = TRUE)
  EXECUTE FUNCTION ensure_single_default_tenant();

-- ── Seed: para cada usuário existente, vincular ao primeiro tenant ativo
-- (migração de dados — em produção fazer vínculo explícito)
INSERT INTO user_tenants (user_id, tenant_id, role, is_default)
SELECT
  p.id                AS user_id,
  l.tenant_id,
  p.role,
  TRUE                AS is_default
FROM profiles p
CROSS JOIN LATERAL (
  SELECT tenant_id FROM licenses
  WHERE status IN ('active', 'trial')
  ORDER BY created_at LIMIT 1
) l
ON CONFLICT (user_id, tenant_id) DO NOTHING;
