-- ============================================================
-- Vetra — Licenças multi-tenant
-- Executar após migration de menus e ACL
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE license_plan AS ENUM (
  'start',       -- Pequenas propriedades
  'growth',      -- Médio produtor
  'pro',         -- Grandes operações
  'enterprise'   -- Customizado
);

CREATE TYPE license_status AS ENUM (
  'active',     -- Ativa e dentro da validade
  'trial',      -- Período de avaliação
  'suspended',  -- Suspensa (inadimplência)
  'expired',    -- Vencida
  'cancelled'   -- Cancelada
);

-- ── Tabela de tenants (empresas/clientes) ────────────────────
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(200) NOT NULL,
  document      VARCHAR(20),            -- CNPJ ou CPF
  email         VARCHAR(200),           -- email do responsável
  phone         VARCHAR(20),
  address       TEXT,
  city          VARCHAR(100),
  state         CHAR(2),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Tabela de planos (configuração base) ─────────────────────
CREATE TABLE license_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan              license_plan NOT NULL UNIQUE,
  label             VARCHAR(100) NOT NULL,
  description       TEXT,
  max_users         INTEGER NOT NULL,     -- limite de usuários
  max_farms         INTEGER NOT NULL,     -- limite de fazendas (-1 = ilimitado)
  price_monthly     NUMERIC(10,2),        -- preço base mensal (BRL)
  price_annual      NUMERIC(10,2),        -- preço anual (BRL)
  modules           TEXT[] NOT NULL,      -- módulos inclusos (keys)
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabela de licenças por tenant ────────────────────────────
CREATE TABLE licenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan            license_plan  NOT NULL DEFAULT 'start',
  status          license_status NOT NULL DEFAULT 'trial',
  max_users       INTEGER NOT NULL,       -- pode ser customizado (enterprise)
  max_farms       INTEGER NOT NULL,
  modules         TEXT[] NOT NULL,        -- módulos ativos para este tenant
  starts_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at      DATE NOT NULL,
  trial_ends_at   DATE,                   -- fim do trial (se aplicável)
  cancelled_at    TIMESTAMPTZ,
  notes           TEXT,                   -- observações internas
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  -- Só uma licença ativa por tenant
  CONSTRAINT unique_active_license UNIQUE (tenant_id)
);

CREATE INDEX licenses_tenant_idx  ON licenses (tenant_id);
CREATE INDEX licenses_status_idx  ON licenses (status);
CREATE INDEX licenses_expires_idx ON licenses (expires_at);

CREATE TRIGGER trg_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Histórico de mudanças de plano ───────────────────────────
CREATE TABLE license_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id  UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event       VARCHAR(50) NOT NULL, -- 'created','upgraded','downgraded','suspended','renewed','cancelled'
  old_plan    license_plan,
  new_plan    license_plan,
  old_status  license_status,
  new_status  license_status,
  changed_by  UUID REFERENCES auth.users(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX license_history_tenant_idx ON license_history (tenant_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_history ENABLE ROW LEVEL SECURITY;
-- Gerido via service_role na API admin

-- ── Views ────────────────────────────────────────────────────

-- Status completo de cada tenant com licença
CREATE VIEW tenant_license_status AS
SELECT
  t.id              AS tenant_id,
  t.name            AS tenant_name,
  t.document,
  t.email,
  t.active          AS tenant_active,
  l.id              AS license_id,
  l.plan,
  l.status,
  l.max_users,
  l.max_farms,
  l.modules,
  l.starts_at,
  l.expires_at,
  l.trial_ends_at,
  l.notes,
  l.created_at      AS license_created_at,
  l.updated_at      AS license_updated_at,
  -- Dias restantes
  (l.expires_at - CURRENT_DATE) AS days_remaining,
  -- Flag de vencimento próximo (30 dias)
  (l.expires_at - CURRENT_DATE) <= 30 AS expiring_soon,
  -- Flag de trial ativo
  (l.status = 'trial' AND l.trial_ends_at >= CURRENT_DATE) AS trial_active
FROM tenants t
LEFT JOIN licenses l ON l.tenant_id = t.id
ORDER BY t.name;

-- Licenças vencendo nos próximos 30 dias
CREATE VIEW licenses_expiring_soon AS
SELECT * FROM tenant_license_status
WHERE expiring_soon = TRUE
  AND status IN ('active','trial')
ORDER BY days_remaining;

-- ── Função: verificar se tenant pode criar usuário ───────────
CREATE OR REPLACE FUNCTION tenant_can_add_user(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_max_users  INTEGER;
  v_curr_users INTEGER;
  v_status     license_status;
BEGIN
  SELECT max_users, status INTO v_max_users, v_status
  FROM licenses WHERE tenant_id = p_tenant_id;

  IF v_status NOT IN ('active','trial') THEN RETURN FALSE; END IF;

  SELECT COUNT(*) INTO v_curr_users
  FROM profiles WHERE active = TRUE; -- filtrar por tenant quando multi-tenant completo

  RETURN v_curr_users < v_max_users;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Função: verificar se tenant pode criar fazenda ────────────
CREATE OR REPLACE FUNCTION tenant_can_add_farm(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_max_farms  INTEGER;
  v_curr_farms INTEGER;
  v_status     license_status;
BEGIN
  SELECT max_farms, status INTO v_max_farms, v_status
  FROM licenses WHERE tenant_id = p_tenant_id;

  IF v_status NOT IN ('active','trial') THEN RETURN FALSE; END IF;
  IF v_max_farms = -1 THEN RETURN TRUE; END IF; -- ilimitado

  SELECT COUNT(*) INTO v_curr_farms FROM farms; -- filtrar por tenant

  RETURN v_curr_farms < v_max_farms;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- SEED: planos padrão do Vetra
-- ============================================================
INSERT INTO license_plans (plan, label, description, max_users, max_farms, price_monthly, price_annual, modules)
VALUES
  ('start', 'Start', 'Para pequenas propriedades que estão começando a digitalizar a gestão', 3, 1, 199.00, 1990.00,
   ARRAY['farm','inventory','financial','maintenance','fiscal']),

  ('growth', 'Growth', 'Para médio produtor com operação estruturada e equipe dedicada', 10, 3, 499.00, 4990.00,
   ARRAY['farm','inventory','financial','accounting','purchasing','sales','maintenance','fiscal','production','services','analytics']),

  ('pro', 'Pro', 'Para grandes operações e grupos agrícolas com múltiplas fazendas', 20, -1, 999.00, 9990.00,
   ARRAY['farm','inventory','financial','accounting','purchasing','sales','logistics','maintenance','fiscal','production','services','analytics','admin']),

  ('enterprise', 'Enterprise', 'Plano customizado com módulos, usuários e fazendas sob medida', 0, -1, 0.00, 0.00,
   ARRAY['farm','inventory','financial','accounting','purchasing','sales','logistics','maintenance','fiscal','production','services','analytics','admin']);
-- Nota: enterprise max_users=0 = definido por contrato no campo licenses.max_users
