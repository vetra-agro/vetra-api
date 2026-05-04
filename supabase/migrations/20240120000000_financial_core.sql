-- ============================================================
-- Vetra — Módulo Financeiro — Núcleo
-- Tabelas: bank_accounts, cost_centers, financial_transactions,
--          accounts_payable, accounts_receivable
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE account_type AS ENUM (
    'checking',   -- conta corrente
    'savings',    -- poupança
    'investment', -- investimento
    'cash'        -- caixa físico
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM (
    'pending',    -- pendente
    'paid',       -- pago/recebido
    'overdue',    -- vencido
    'cancelled',  -- cancelado
    'partial'     -- parcialmente pago
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'pix', 'ted', 'doc', 'boleto', 'check',
    'cash', 'credit_card', 'debit_card', 'transfer', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recurrence_type AS ENUM (
    'none', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Bancos e Contas Correntes ─────────────────────────────────
CREATE TABLE bank_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id) ON DELETE SET NULL,

  name            VARCHAR(200) NOT NULL,      -- ex: "BB Conta Principal"
  bank_name       VARCHAR(100),               -- Banco do Brasil, Itaú, etc.
  bank_code       VARCHAR(10),                -- código COMPE (001, 341...)
  agency          VARCHAR(20),                -- agência
  account_number  VARCHAR(30),                -- número da conta
  account_type    account_type NOT NULL DEFAULT 'checking',
  pix_key         VARCHAR(100),               -- chave PIX

  current_balance NUMERIC(14,2) DEFAULT 0,    -- saldo atual
  initial_balance NUMERIC(14,2) DEFAULT 0,    -- saldo inicial (na abertura)
  initial_date    DATE,                        -- data do saldo inicial

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ba_tenant_idx ON bank_accounts (tenant_id);
CREATE TRIGGER trg_ba_updated_at BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ba_rls ON bank_accounts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Centros de Custo / Lucro ───────────────────────────────────
CREATE TABLE cost_centers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id     UUID REFERENCES farms(id) ON DELETE SET NULL,
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(30),
  type        VARCHAR(20) DEFAULT 'cost',  -- 'cost' ou 'profit'
  parent_id   UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX cc_tenant_idx ON cost_centers (tenant_id);
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_rls ON cost_centers FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Categorias financeiras ─────────────────────────────────────
-- Seeds de categorias padrão são inseridos via application
CREATE TABLE financial_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global
  name        VARCHAR(200) NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('expense','income')),
  parent_id   UUID REFERENCES financial_categories(id) ON DELETE SET NULL,
  color       VARCHAR(7),
  icon        VARCHAR(50),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX fc_tenant_idx ON financial_categories (tenant_id);
ALTER TABLE financial_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY fc_rls ON financial_categories FOR ALL USING (
  tenant_id IS NULL OR
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Contas a Pagar ────────────────────────────────────────────
CREATE TABLE accounts_payable (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id) ON DELETE SET NULL,
  cost_center_id    UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  category_id       UUID REFERENCES financial_categories(id) ON DELETE SET NULL,
  bank_account_id   UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  partner_id        UUID REFERENCES partners(id) ON DELETE SET NULL, -- fornecedor
  season_id         UUID REFERENCES seasons(id) ON DELETE SET NULL,

  -- Identificação
  description       VARCHAR(500) NOT NULL,
  document_number   VARCHAR(100),            -- NF, boleto, contrato
  document_type     VARCHAR(50),             -- 'nf', 'boleto', 'contrato', 'other'

  -- Valores
  amount            NUMERIC(14,2) NOT NULL,  -- valor original
  discount          NUMERIC(14,2) DEFAULT 0,
  interest          NUMERIC(14,2) DEFAULT 0,
  fine              NUMERIC(14,2) DEFAULT 0,
  amount_paid       NUMERIC(14,2) DEFAULT 0, -- total pago
  amount_remaining  NUMERIC(14,2),           -- calculado por trigger

  -- Datas
  issue_date        DATE,                    -- data de emissão
  due_date          DATE NOT NULL,           -- vencimento
  payment_date      DATE,                    -- data do pagamento real
  competence_date   DATE,                    -- competência contábil

  -- Status e pagamento
  status            transaction_status NOT NULL DEFAULT 'pending',
  payment_method    payment_method,

  -- Recorrência
  recurrence        recurrence_type NOT NULL DEFAULT 'none',
  recurrence_end    DATE,
  parent_id         UUID REFERENCES accounts_payable(id) ON DELETE SET NULL, -- origem se recorrente

  -- Rateio entre fazendas/centros de custo (JSONB)
  -- [{ "farm_id": "...", "cost_center_id": "...", "amount": 500.00, "pct": 50 }]
  apportionment     JSONB DEFAULT '[]',

  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',
  attachments       TEXT[] DEFAULT '{}',     -- URLs de documentos

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ap_tenant_idx    ON accounts_payable (tenant_id);
CREATE INDEX ap_due_idx       ON accounts_payable (tenant_id, due_date);
CREATE INDEX ap_status_idx    ON accounts_payable (tenant_id, status);
CREATE INDEX ap_partner_idx   ON accounts_payable (partner_id);
CREATE INDEX ap_season_idx    ON accounts_payable (season_id);
CREATE INDEX ap_farm_idx      ON accounts_payable (farm_id);

CREATE TRIGGER trg_ap_updated_at BEFORE UPDATE ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
CREATE POLICY ap_rls ON accounts_payable FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- Trigger: calcular amount_remaining e status automático
CREATE OR REPLACE FUNCTION calc_payable_remaining()
RETURNS TRIGGER AS $$
BEGIN
  NEW.amount_remaining = GREATEST(0,
    NEW.amount + COALESCE(NEW.interest,0) + COALESCE(NEW.fine,0)
    - COALESCE(NEW.discount,0) - COALESCE(NEW.amount_paid,0)
  );
  -- Status automático
  IF NEW.amount_paid >= (NEW.amount + COALESCE(NEW.interest,0) + COALESCE(NEW.fine,0) - COALESCE(NEW.discount,0))
    AND NEW.amount_paid > 0 THEN
    NEW.status = 'paid';
  ELSIF NEW.amount_paid > 0 THEN
    NEW.status = 'partial';
  ELSIF NEW.due_date < CURRENT_DATE AND NEW.status = 'pending' THEN
    NEW.status = 'overdue';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ap_remaining BEFORE INSERT OR UPDATE ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION calc_payable_remaining();

-- ── Contas a Receber ──────────────────────────────────────────
CREATE TABLE accounts_receivable (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id) ON DELETE SET NULL,
  cost_center_id    UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  category_id       UUID REFERENCES financial_categories(id) ON DELETE SET NULL,
  bank_account_id   UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  partner_id        UUID REFERENCES partners(id) ON DELETE SET NULL, -- cliente/comprador
  season_id         UUID REFERENCES seasons(id) ON DELETE SET NULL,

  description       VARCHAR(500) NOT NULL,
  document_number   VARCHAR(100),
  document_type     VARCHAR(50),

  amount            NUMERIC(14,2) NOT NULL,
  discount          NUMERIC(14,2) DEFAULT 0,
  interest          NUMERIC(14,2) DEFAULT 0,
  fine              NUMERIC(14,2) DEFAULT 0,
  amount_received   NUMERIC(14,2) DEFAULT 0,
  amount_remaining  NUMERIC(14,2),

  issue_date        DATE,
  due_date          DATE NOT NULL,
  receipt_date      DATE,
  competence_date   DATE,

  status            transaction_status NOT NULL DEFAULT 'pending',
  payment_method    payment_method,

  recurrence        recurrence_type NOT NULL DEFAULT 'none',
  recurrence_end    DATE,
  parent_id         UUID REFERENCES accounts_receivable(id) ON DELETE SET NULL,

  apportionment     JSONB DEFAULT '[]',
  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',
  attachments       TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ar_tenant_idx  ON accounts_receivable (tenant_id);
CREATE INDEX ar_due_idx     ON accounts_receivable (tenant_id, due_date);
CREATE INDEX ar_status_idx  ON accounts_receivable (tenant_id, status);
CREATE INDEX ar_partner_idx ON accounts_receivable (partner_id);
CREATE INDEX ar_season_idx  ON accounts_receivable (season_id);
CREATE INDEX ar_farm_idx    ON accounts_receivable (farm_id);

CREATE TRIGGER trg_ar_updated_at BEFORE UPDATE ON accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
CREATE POLICY ar_rls ON accounts_receivable FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

CREATE OR REPLACE FUNCTION calc_receivable_remaining()
RETURNS TRIGGER AS $$
BEGIN
  NEW.amount_remaining = GREATEST(0,
    NEW.amount + COALESCE(NEW.interest,0) + COALESCE(NEW.fine,0)
    - COALESCE(NEW.discount,0) - COALESCE(NEW.amount_received,0)
  );
  IF NEW.amount_received >= (NEW.amount + COALESCE(NEW.interest,0) + COALESCE(NEW.fine,0) - COALESCE(NEW.discount,0))
    AND NEW.amount_received > 0 THEN
    NEW.status = 'paid';
  ELSIF NEW.amount_received > 0 THEN
    NEW.status = 'partial';
  ELSIF NEW.due_date < CURRENT_DATE AND NEW.status = 'pending' THEN
    NEW.status = 'overdue';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ar_remaining BEFORE INSERT OR UPDATE ON accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION calc_receivable_remaining();

-- ── Views consolidadas ────────────────────────────────────────
CREATE VIEW payable_summary AS
SELECT
  ap.*,
  f.name    AS farm_name,
  p.name    AS partner_name,
  p.types   AS partner_type,
  cc.name   AS cost_center_name,
  s.name    AS season_name,
  s.crop    AS season_crop,
  ba.name   AS bank_account_name,
  -- Dias em atraso (positivo = atrasado)
  CASE WHEN ap.status IN ('pending','partial') THEN CURRENT_DATE - ap.due_date ELSE NULL END AS days_overdue
FROM accounts_payable ap
JOIN tenants t ON t.id = ap.tenant_id
LEFT JOIN farms f     ON f.id  = ap.farm_id
LEFT JOIN partners p  ON p.id  = ap.partner_id
LEFT JOIN cost_centers cc ON cc.id = ap.cost_center_id
LEFT JOIN seasons s   ON s.id  = ap.season_id
LEFT JOIN bank_accounts ba ON ba.id = ap.bank_account_id;

CREATE VIEW receivable_summary AS
SELECT
  ar.*,
  f.name    AS farm_name,
  p.name    AS partner_name,
  p.types   AS partner_type,
  cc.name   AS cost_center_name,
  s.name    AS season_name,
  s.crop    AS season_crop,
  ba.name   AS bank_account_name,
  CASE WHEN ar.status IN ('pending','partial') THEN CURRENT_DATE - ar.due_date ELSE NULL END AS days_overdue
FROM accounts_receivable ar
JOIN tenants t ON t.id = ar.tenant_id
LEFT JOIN farms f     ON f.id  = ar.farm_id
LEFT JOIN partners p  ON p.id  = ar.partner_id
LEFT JOIN cost_centers cc ON cc.id = ar.cost_center_id
LEFT JOIN seasons s   ON s.id  = ar.season_id
LEFT JOIN bank_accounts ba ON ba.id = ar.bank_account_id;

-- ── Seeds: categorias padrão para agronegócio ─────────────────
INSERT INTO financial_categories (id, tenant_id, name, type, color) VALUES
  -- Despesas
  (uuid_generate_v4(), NULL, 'Insumos agrícolas',    'expense', '#F44336'),
  (uuid_generate_v4(), NULL, 'Defensivos / Agroquímicos', 'expense', '#E91E63'),
  (uuid_generate_v4(), NULL, 'Sementes',              'expense', '#9C27B0'),
  (uuid_generate_v4(), NULL, 'Fertilizantes',         'expense', '#673AB7'),
  (uuid_generate_v4(), NULL, 'Combustíveis',          'expense', '#FF5722'),
  (uuid_generate_v4(), NULL, 'Manutenção de máquinas','expense', '#795548'),
  (uuid_generate_v4(), NULL, 'Mão de obra',           'expense', '#607D8B'),
  (uuid_generate_v4(), NULL, 'Arrendamento',          'expense', '#FF9800'),
  (uuid_generate_v4(), NULL, 'Frete / Logística',     'expense', '#FFC107'),
  (uuid_generate_v4(), NULL, 'Impostos e taxas',      'expense', '#F44336'),
  (uuid_generate_v4(), NULL, 'Seguro rural',          'expense', '#2196F3'),
  (uuid_generate_v4(), NULL, 'Energia elétrica',      'expense', '#FFEB3B'),
  (uuid_generate_v4(), NULL, 'Despesas administrativas','expense','#9E9E9E'),
  -- Receitas
  (uuid_generate_v4(), NULL, 'Venda de grãos',        'income',  '#4CAF50'),
  (uuid_generate_v4(), NULL, 'Venda de algodão',      'income',  '#8BC34A'),
  (uuid_generate_v4(), NULL, 'Venda de cana',         'income',  '#CDDC39'),
  (uuid_generate_v4(), NULL, 'Prestação de serviços', 'income',  '#00BCD4'),
  (uuid_generate_v4(), NULL, 'Arrendamento recebido', 'income',  '#009688'),
  (uuid_generate_v4(), NULL, 'Subsídios / Programas', 'income',  '#3F51B5'),
  (uuid_generate_v4(), NULL, 'Outras receitas',       'income',  '#607D8B')
ON CONFLICT DO NOTHING;
