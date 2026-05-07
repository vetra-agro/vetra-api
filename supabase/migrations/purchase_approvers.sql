-- ============================================================
-- Vetra — Aprovadores e Alçadas de Compra
-- Complemento ao módulo de Compras
-- ============================================================

-- ── Perfis de quem pode criar requisições ────────────────────
-- (controle simples via lista de usuários autorizados)
CREATE TABLE IF NOT EXISTS purchase_requesters (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id     UUID REFERENCES farms(id)            ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id)       ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  email       VARCHAR(200),
  department  VARCHAR(100),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX prs_tenant_idx ON purchase_requesters (tenant_id);
ALTER TABLE purchase_requesters ENABLE ROW LEVEL SECURITY;
CREATE POLICY prs_rls ON purchase_requesters FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Aprovadores e alçadas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_approvers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)            ON DELETE SET NULL,

  -- Identificação do aprovador
  name            VARCHAR(200) NOT NULL,
  email           VARCHAR(200),
  role            VARCHAR(100),    -- cargo: Gestor de Fazenda, Gerente Financeiro, Diretor, etc.
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Alçada: faixa de valor que este aprovador pode autorizar
  level           SMALLINT NOT NULL DEFAULT 1,    -- nível hierárquico (1=menor, 3=maior)
  min_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  max_value       NUMERIC(14,2),                  -- NULL = sem limite superior

  -- Escopo
  -- NULL = aprova qualquer categoria; lista = só estas categorias
  categories      TEXT[] DEFAULT '{}',            -- ex: ['insumos','maquinário']
  approves_requests BOOLEAN DEFAULT TRUE,         -- aprova requisições
  approves_orders   BOOLEAN DEFAULT TRUE,         -- aprova pedidos

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pa_tenant_idx ON purchase_approvers (tenant_id);
CREATE INDEX pa_level_idx  ON purchase_approvers (tenant_id, level);
CREATE INDEX pa_farm_idx   ON purchase_approvers (farm_id);

CREATE TRIGGER trg_pa_updated_at BEFORE UPDATE ON purchase_approvers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_approvers ENABLE ROW LEVEL SECURITY;
CREATE POLICY pa_approvers_rls ON purchase_approvers FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── View: alçada necessária para um valor ────────────────────
-- Retorna o aprovador de menor nível que cobre o valor
CREATE OR REPLACE FUNCTION get_required_approver(
  p_tenant_id UUID,
  p_value     NUMERIC,
  p_farm_id   UUID DEFAULT NULL
)
RETURNS TABLE (
  approver_id UUID,
  approver_name VARCHAR,
  approver_email VARCHAR,
  approver_role VARCHAR,
  level SMALLINT,
  max_value NUMERIC
) AS $$
  SELECT id, name, email, role, purchase_approvers.level, purchase_approvers.max_value
  FROM purchase_approvers
  WHERE tenant_id = p_tenant_id
    AND active = TRUE
    AND approves_orders = TRUE
    AND min_value <= p_value
    AND (max_value IS NULL OR max_value >= p_value)
    AND (farm_id IS NULL OR farm_id = p_farm_id)
  ORDER BY purchase_approvers.level ASC
  LIMIT 1;
$$ LANGUAGE sql STABLE;
