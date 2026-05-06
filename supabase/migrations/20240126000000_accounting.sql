-- ============================================================
-- Vetra — Módulo Contábil
-- Plano de Contas, Lançamentos, Escrituração, Ativos
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE account_nature AS ENUM (
    'debit',   -- natureza devedora (ativo, despesa)
    'credit'   -- natureza credora (passivo, PL, receita)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE account_group AS ENUM (
    'asset',        -- ativo
    'liability',    -- passivo
    'equity',       -- patrimônio líquido
    'revenue',      -- receita
    'expense',      -- despesa
    'cost'          -- custo
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entry_status AS ENUM (
    'draft',     -- rascunho
    'posted',    -- lançado (escriturado)
    'reversed'   -- estornado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM (
    'active',      -- em uso
    'idle',        -- ocioso
    'maintenance', -- em manutenção
    'disposed',    -- baixado/alienado
    'fully_depreciated' -- totalmente depreciado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE depreciation_method AS ENUM (
    'straight_line',      -- linear
    'declining_balance',  -- saldos decrescentes
    'sum_of_years',       -- soma dos dígitos
    'units_of_production' -- unidades produzidas
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Plano de Contas ───────────────────────────────────────────
CREATE TABLE chart_of_accounts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global (padrão Vetra)
  parent_id     UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,

  code          VARCHAR(20) NOT NULL,       -- ex: 1.1.01.001
  name          VARCHAR(300) NOT NULL,
  description   TEXT,
  nature        account_nature NOT NULL,
  group_type    account_group  NOT NULL,
  level         SMALLINT NOT NULL DEFAULT 1, -- nível hierárquico
  is_analytic   BOOLEAN NOT NULL DEFAULT TRUE, -- analítica (aceita lançamentos) vs sintética
  accepts_entries BOOLEAN NOT NULL DEFAULT TRUE,
  dre_line      VARCHAR(100),               -- linha do DRE (receita_bruta, cogs, opex, etc.)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, code)
);

CREATE INDEX coa_tenant_idx  ON chart_of_accounts (tenant_id);
CREATE INDEX coa_parent_idx  ON chart_of_accounts (parent_id);
CREATE INDEX coa_group_idx   ON chart_of_accounts (group_type);
CREATE INDEX coa_code_idx    ON chart_of_accounts (code);

CREATE TRIGGER trg_coa_updated_at BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY coa_rls ON chart_of_accounts FOR ALL USING (
  tenant_id IS NULL OR
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Lançamentos contábeis (cabeçalho) ────────────────────────
CREATE TABLE accounting_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)            ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)          ON DELETE SET NULL,
  cost_center_id  UUID REFERENCES cost_centers(id)     ON DELETE SET NULL,

  entry_number    VARCHAR(30),              -- número sequencial do lançamento
  status          entry_status NOT NULL DEFAULT 'draft',
  entry_date      DATE NOT NULL,            -- data de competência
  posting_date    DATE,                     -- data de escrituração
  description     VARCHAR(500) NOT NULL,
  reference       VARCHAR(100),             -- NF, contrato, etc.
  reversal_of     UUID REFERENCES accounting_entries(id) ON DELETE SET NULL,

  -- Totais (validados por trigger — débitos = créditos)
  total_debit     NUMERIC(16,2) DEFAULT 0,
  total_credit    NUMERIC(16,2) DEFAULT 0,
  is_balanced     BOOLEAN DEFAULT FALSE,

  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  posted_by       UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ae_tenant_idx  ON accounting_entries (tenant_id);
CREATE INDEX ae_date_idx    ON accounting_entries (tenant_id, entry_date DESC);
CREATE INDEX ae_status_idx  ON accounting_entries (tenant_id, status);
CREATE INDEX ae_farm_idx    ON accounting_entries (farm_id);

CREATE TRIGGER trg_ae_updated_at BEFORE UPDATE ON accounting_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE accounting_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ae_rls ON accounting_entries FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Partidas do lançamento (linhas débito/crédito) ────────────
CREATE TABLE accounting_entry_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id      UUID NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES chart_of_accounts(id)  ON DELETE RESTRICT,
  sequence      SMALLINT NOT NULL DEFAULT 1,

  debit_amount  NUMERIC(16,2) DEFAULT 0,
  credit_amount NUMERIC(16,2) DEFAULT 0,
  description   VARCHAR(300),

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX aei_entry_idx   ON accounting_entry_items (entry_id);
CREATE INDEX aei_account_idx ON accounting_entry_items (account_id);

-- Trigger: recalcula totais e is_balanced no cabeçalho
CREATE OR REPLACE FUNCTION calc_entry_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_id UUID;
  v_debit    NUMERIC;
  v_credit   NUMERIC;
BEGIN
  v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);

  SELECT
    COALESCE(SUM(debit_amount),  0),
    COALESCE(SUM(credit_amount), 0)
  INTO v_debit, v_credit
  FROM accounting_entry_items
  WHERE entry_id = v_entry_id;

  UPDATE accounting_entries
  SET total_debit  = v_debit,
      total_credit = v_credit,
      is_balanced  = (ABS(v_debit - v_credit) < 0.01)
  WHERE id = v_entry_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_aei_totals
  AFTER INSERT OR UPDATE OR DELETE ON accounting_entry_items
  FOR EACH ROW EXECUTE FUNCTION calc_entry_totals();

ALTER TABLE accounting_entry_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY aei_rls ON accounting_entry_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM accounting_entries ae
    JOIN user_tenants ut ON ut.tenant_id = ae.tenant_id
    WHERE ae.id = accounting_entry_items.entry_id
      AND ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- ── Ativos imobilizados ───────────────────────────────────────
CREATE TABLE assets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)         ON DELETE CASCADE,
  farm_id             UUID REFERENCES farms(id)                    ON DELETE SET NULL,
  account_id          UUID REFERENCES chart_of_accounts(id)        ON DELETE SET NULL,
  machinery_id        UUID REFERENCES machinery(id)                ON DELETE SET NULL,

  code                VARCHAR(30),
  name                VARCHAR(300) NOT NULL,
  description         TEXT,
  category            VARCHAR(100),         -- imóvel, veículo, máquina, equipamento, etc.
  status              asset_status NOT NULL DEFAULT 'active',

  -- Aquisição
  acquisition_date    DATE NOT NULL,
  acquisition_value   NUMERIC(14,2) NOT NULL,
  supplier_name       VARCHAR(200),
  invoice_number      VARCHAR(50),

  -- Depreciação
  depreciation_method depreciation_method NOT NULL DEFAULT 'straight_line',
  useful_life_months  INTEGER NOT NULL DEFAULT 60,   -- vida útil em meses
  residual_value      NUMERIC(14,2) DEFAULT 0,        -- valor residual
  depreciation_rate   NUMERIC(8,6),                   -- taxa mensal calculada

  -- Acumulados
  accumulated_depreciation NUMERIC(14,2) DEFAULT 0,
  net_book_value           NUMERIC(14,2),             -- calculado por trigger

  -- Baixa
  disposal_date       DATE,
  disposal_value      NUMERIC(14,2),
  disposal_reason     TEXT,

  notes               TEXT,
  tags                TEXT[] DEFAULT '{}',

  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX assets_tenant_idx   ON assets (tenant_id);
CREATE INDEX assets_farm_idx     ON assets (farm_id);
CREATE INDEX assets_status_idx   ON assets (tenant_id, status);
CREATE INDEX assets_machinery_idx ON assets (machinery_id);

CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: calcula taxa e valor líquido
CREATE OR REPLACE FUNCTION calc_asset_values()
RETURNS TRIGGER AS $$
BEGIN
  -- Taxa de depreciação mensal (linear)
  IF NEW.depreciation_method = 'straight_line' AND NEW.useful_life_months > 0 THEN
    NEW.depreciation_rate = ROUND(
      (NEW.acquisition_value - COALESCE(NEW.residual_value,0)) / NEW.useful_life_months / NEW.acquisition_value,
      6
    );
  END IF;

  -- Valor líquido contábil
  NEW.net_book_value = GREATEST(
    COALESCE(NEW.residual_value, 0),
    NEW.acquisition_value - COALESCE(NEW.accumulated_depreciation, 0)
  );

  -- Status automático se totalmente depreciado
  IF NEW.net_book_value <= COALESCE(NEW.residual_value, 0) + 0.01
    AND NEW.status = 'active' THEN
    NEW.status = 'fully_depreciated';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_values BEFORE INSERT OR UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION calc_asset_values();

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY assets_rls ON assets FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Registros de depreciação mensais ─────────────────────────
CREATE TABLE asset_depreciations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id          UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_year       SMALLINT NOT NULL,
  period_month      SMALLINT NOT NULL,
  depreciation_amt  NUMERIC(14,2) NOT NULL,
  accumulated_after NUMERIC(14,2) NOT NULL,
  net_value_after   NUMERIC(14,2) NOT NULL,
  entry_id          UUID REFERENCES accounting_entries(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (asset_id, period_year, period_month)
);

CREATE INDEX adep_asset_idx  ON asset_depreciations (asset_id);
CREATE INDEX adep_period_idx ON asset_depreciations (tenant_id, period_year, period_month);

ALTER TABLE asset_depreciations ENABLE ROW LEVEL SECURITY;
CREATE POLICY adep_rls ON asset_depreciations FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Views ─────────────────────────────────────────────────────

-- DRE simplificado por período
CREATE OR REPLACE VIEW dre_by_period AS
SELECT
  ae.tenant_id,
  ae.farm_id,
  ae.season_id,
  DATE_TRUNC('month', ae.entry_date)::DATE AS period,
  coa.group_type,
  coa.dre_line,
  coa.name AS account_name,
  coa.code AS account_code,
  SUM(CASE WHEN coa.nature = 'credit' THEN aei.credit_amount - aei.debit_amount
           ELSE aei.debit_amount - aei.credit_amount END) AS amount
FROM accounting_entry_items aei
JOIN accounting_entries     ae  ON ae.id  = aei.entry_id
JOIN chart_of_accounts      coa ON coa.id = aei.account_id
WHERE ae.status = 'posted'
  AND coa.group_type IN ('revenue', 'expense', 'cost')
GROUP BY ae.tenant_id, ae.farm_id, ae.season_id,
         DATE_TRUNC('month', ae.entry_date), coa.group_type, coa.dre_line, coa.name, coa.code;

-- Saldo de cada conta contábil
CREATE OR REPLACE VIEW account_balances AS
SELECT
  ae.tenant_id,
  aei.account_id,
  coa.code,
  coa.name,
  coa.group_type,
  coa.nature,
  SUM(aei.debit_amount)  AS total_debit,
  SUM(aei.credit_amount) AS total_credit,
  CASE WHEN coa.nature = 'debit'
    THEN SUM(aei.debit_amount)  - SUM(aei.credit_amount)
    ELSE SUM(aei.credit_amount) - SUM(aei.debit_amount)
  END AS balance
FROM accounting_entry_items aei
JOIN accounting_entries ae  ON ae.id  = aei.entry_id
JOIN chart_of_accounts  coa ON coa.id = aei.account_id
WHERE ae.status = 'posted'
GROUP BY ae.tenant_id, aei.account_id, coa.code, coa.name, coa.group_type, coa.nature;

-- ── Seeds: plano de contas padrão simplificado (agronegócio) ──
INSERT INTO chart_of_accounts (id, tenant_id, code, name, nature, group_type, level, is_analytic, accepts_entries, dre_line) VALUES
-- ATIVO
(uuid_generate_v4(), NULL, '1',       'ATIVO',                           'debit', 'asset',   1, false, false, NULL),
(uuid_generate_v4(), NULL, '1.1',     'Ativo Circulante',                'debit', 'asset',   2, false, false, NULL),
(uuid_generate_v4(), NULL, '1.1.01',  'Caixa e Equivalentes',            'debit', 'asset',   3, false, false, NULL),
(uuid_generate_v4(), NULL, '1.1.01.001','Caixa',                         'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.1.01.002','Bancos Conta Corrente',         'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.1.02',  'Contas a Receber',                'debit', 'asset',   3, false, false, NULL),
(uuid_generate_v4(), NULL, '1.1.02.001','Clientes',                      'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.1.03',  'Estoques',                        'debit', 'asset',   3, false, false, NULL),
(uuid_generate_v4(), NULL, '1.1.03.001','Estoque de Insumos',            'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.1.03.002','Estoque de Produção',           'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2',     'Ativo Não Circulante',            'debit', 'asset',   2, false, false, NULL),
(uuid_generate_v4(), NULL, '1.2.01',  'Imobilizado',                     'debit', 'asset',   3, false, false, NULL),
(uuid_generate_v4(), NULL, '1.2.01.001','Máquinas e Equipamentos',       'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2.01.002','Veículos',                      'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2.01.003','Terrenos',                      'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2.01.004','Benfeitorias',                  'debit', 'asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2.02',  'Depreciação Acumulada',           'credit','asset',   3, false, false, NULL),
(uuid_generate_v4(), NULL, '1.2.02.001','(-) Dep. Acum. Máquinas',      'credit','asset',   4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '1.2.02.002','(-) Dep. Acum. Veículos',      'credit','asset',   4, true,  true,  NULL),
-- PASSIVO
(uuid_generate_v4(), NULL, '2',       'PASSIVO',                         'credit','liability',1, false, false, NULL),
(uuid_generate_v4(), NULL, '2.1',     'Passivo Circulante',              'credit','liability',2, false, false, NULL),
(uuid_generate_v4(), NULL, '2.1.01',  'Fornecedores',                    'credit','liability',3, false, false, NULL),
(uuid_generate_v4(), NULL, '2.1.01.001','Fornecedores Nacionais',        'credit','liability',4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '2.1.02',  'Obrigações Fiscais',              'credit','liability',3, false, false, NULL),
(uuid_generate_v4(), NULL, '2.1.02.001','Impostos a Recolher',           'credit','liability',4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '2.1.03',  'Empréstimos e Financiamentos',    'credit','liability',3, false, false, NULL),
(uuid_generate_v4(), NULL, '2.1.03.001','Financiamentos Rurais (CP)',    'credit','liability',4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '2.2',     'Passivo Não Circulante',          'credit','liability',2, false, false, NULL),
(uuid_generate_v4(), NULL, '2.2.01.001','Financiamentos Rurais (LP)',    'credit','liability',4, true,  true,  NULL),
-- PL
(uuid_generate_v4(), NULL, '3',       'PATRIMÔNIO LÍQUIDO',              'credit','equity',  1, false, false, NULL),
(uuid_generate_v4(), NULL, '3.1.01.001','Capital Social',                'credit','equity',  4, true,  true,  NULL),
(uuid_generate_v4(), NULL, '3.2.01.001','Lucros/Prejuízos Acumulados',   'credit','equity',  4, true,  true,  NULL),
-- RECEITAS
(uuid_generate_v4(), NULL, '4',       'RECEITAS',                        'credit','revenue', 1, false, false, NULL),
(uuid_generate_v4(), NULL, '4.1',     'Receita Operacional',             'credit','revenue', 2, false, false, NULL),
(uuid_generate_v4(), NULL, '4.1.01.001','Venda de Grãos',                'credit','revenue', 4, true,  true, 'receita_bruta'),
(uuid_generate_v4(), NULL, '4.1.01.002','Venda de Algodão',              'credit','revenue', 4, true,  true, 'receita_bruta'),
(uuid_generate_v4(), NULL, '4.1.01.003','Prestação de Serviços Agrícolas','credit','revenue',4, true,  true, 'receita_bruta'),
(uuid_generate_v4(), NULL, '4.1.02.001','(-) Devoluções e Abatimentos',  'debit', 'revenue', 4, true,  true, 'deducoes'),
-- CUSTOS
(uuid_generate_v4(), NULL, '5',       'CUSTOS',                          'debit', 'cost',    1, false, false, NULL),
(uuid_generate_v4(), NULL, '5.1.01.001','Custo dos Insumos',             'debit', 'cost',    4, true,  true, 'cogs'),
(uuid_generate_v4(), NULL, '5.1.01.002','Custo de Mão de Obra Rural',    'debit', 'cost',    4, true,  true, 'cogs'),
(uuid_generate_v4(), NULL, '5.1.01.003','Custo de Combustível',          'debit', 'cost',    4, true,  true, 'cogs'),
(uuid_generate_v4(), NULL, '5.1.01.004','Custo de Colheita',             'debit', 'cost',    4, true,  true, 'cogs'),
(uuid_generate_v4(), NULL, '5.1.01.005','Depreciação de Máquinas',       'debit', 'cost',    4, true,  true, 'cogs'),
-- DESPESAS
(uuid_generate_v4(), NULL, '6',       'DESPESAS',                        'debit', 'expense', 1, false, false, NULL),
(uuid_generate_v4(), NULL, '6.1.01.001','Despesas Administrativas',      'debit', 'expense', 4, true,  true, 'opex'),
(uuid_generate_v4(), NULL, '6.1.01.002','Despesas com Pessoal',          'debit', 'expense', 4, true,  true, 'opex'),
(uuid_generate_v4(), NULL, '6.1.01.003','Despesas Financeiras',          'debit', 'expense', 4, true,  true, 'financial'),
(uuid_generate_v4(), NULL, '6.1.01.004','Despesas com Arrendamento',     'debit', 'expense', 4, true,  true, 'opex'),
(uuid_generate_v4(), NULL, '6.1.01.005','Impostos e Taxas',              'debit', 'expense', 4, true,  true, 'opex')
ON CONFLICT DO NOTHING;
