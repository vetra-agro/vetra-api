-- ============================================================
-- Vetra — Módulo de Câmbio (Forex)
-- 4 submenus: Operações, Exposição, Vínculo × Contrato, Simulação
-- ============================================================

DO $$ BEGIN
  CREATE TYPE forex_operation_type AS ENUM (
    'spot',        -- câmbio pronto (liquidação D+2)
    'forward',     -- NDF — Non-Deliverable Forward
    'ndf',         -- NDF explícito
    'export_acc',  -- ACC — Adiantamento sobre Contrato de Câmbio
    'ace',         -- ACE — Adiantamento sobre Cambiais Entregues
    'swap',        -- swap cambial
    'option_call', -- opção de compra
    'option_put'   -- opção de venda
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE forex_direction AS ENUM (
    'buy',  -- compra de moeda estrangeira
    'sell'  -- venda de moeda estrangeira (mais comum no agro)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE forex_status AS ENUM (
    'open',      -- em aberto
    'settled',   -- liquidado
    'cancelled', -- cancelado
    'expired'    -- vencido sem liquidação
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE forex_currency AS ENUM (
    'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ARS', 'CLP', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Operações de câmbio ───────────────────────────────────────
CREATE TABLE forex_operations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id)              ON DELETE SET NULL,
  season_id         UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  partner_id        UUID REFERENCES partners(id)           ON DELETE SET NULL, -- banco/corretora

  -- Classificação
  operation_type    forex_operation_type NOT NULL DEFAULT 'spot',
  direction         forex_direction      NOT NULL DEFAULT 'sell',
  status            forex_status         NOT NULL DEFAULT 'open',

  -- Moeda e valores
  currency          forex_currency NOT NULL DEFAULT 'USD',
  foreign_amount    NUMERIC(16,4) NOT NULL,          -- valor em moeda estrangeira
  contracted_rate   NUMERIC(12,6) NOT NULL,           -- taxa contratada (BRL/USD)
  brl_amount        NUMERIC(16,2),                    -- valor em BRL (calculado)
  settlement_rate   NUMERIC(12,6),                    -- taxa na liquidação (real)
  settlement_brl    NUMERIC(16,2),                    -- BRL recebido na liquidação
  fx_result         NUMERIC(16,2),                    -- resultado cambial (ganho/perda)

  -- Datas
  contracted_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE NOT NULL,                    -- vencimento / liquidação prevista
  settlement_date   DATE,                             -- data de liquidação real

  -- Identificação
  contract_number   VARCHAR(100),                     -- número do contrato no banco
  bank_name         VARCHAR(200),                     -- banco operador
  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX forex_op_tenant_idx ON forex_operations (tenant_id);
CREATE INDEX forex_op_farm_idx   ON forex_operations (farm_id);
CREATE INDEX forex_op_season_idx ON forex_operations (season_id);
CREATE INDEX forex_op_status_idx ON forex_operations (tenant_id, status);
CREATE INDEX forex_op_due_idx    ON forex_operations (tenant_id, due_date);

CREATE TRIGGER trg_forex_op_updated_at
  BEFORE UPDATE ON forex_operations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: calcula brl_amount e fx_result automaticamente
CREATE OR REPLACE FUNCTION calc_forex_amounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Valor BRL contratado
  NEW.brl_amount = ROUND(NEW.foreign_amount * NEW.contracted_rate, 2);

  -- Resultado cambial (só quando liquidado)
  IF NEW.settlement_rate IS NOT NULL AND NEW.settlement_brl IS NOT NULL THEN
    -- Para venda: ganhou se taxa de liquidação > taxa contratada
    IF NEW.direction = 'sell' THEN
      NEW.fx_result = NEW.settlement_brl - NEW.brl_amount;
    ELSE
      NEW.fx_result = NEW.brl_amount - NEW.settlement_brl;
    END IF;
  END IF;

  -- Atualiza status se liquidado
  IF NEW.settlement_date IS NOT NULL AND NEW.status = 'open' THEN
    NEW.status = 'settled';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forex_amounts
  BEFORE INSERT OR UPDATE ON forex_operations
  FOR EACH ROW EXECUTE FUNCTION calc_forex_amounts();

ALTER TABLE forex_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY forex_op_rls ON forex_operations FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Contratos de venda vinculados ao câmbio ───────────────────
-- (CPR, contrato de fornecimento, nota de venda)
CREATE TABLE forex_contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id)              ON DELETE SET NULL,
  season_id         UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  partner_id        UUID REFERENCES partners(id)           ON DELETE SET NULL, -- comprador

  -- Identificação
  contract_number   VARCHAR(100),
  contract_type     VARCHAR(50) DEFAULT 'cpr',           -- cpr, forward_sale, spot_sale
  description       VARCHAR(300),

  -- Commodity e volume
  commodity         VARCHAR(100) DEFAULT 'Soja',
  quantity_sc       NUMERIC(12,2),                       -- sacas
  quantity_ton      NUMERIC(12,4),                       -- toneladas
  unit_price_usd    NUMERIC(10,4),                       -- preço unitário (USD)
  unit_price_brl    NUMERIC(10,4),                       -- preço unitário (BRL)
  total_usd         NUMERIC(16,2),                       -- valor total (USD)
  total_brl         NUMERIC(16,2),                       -- valor total (BRL)

  -- Câmbio de referência
  reference_rate    NUMERIC(12,6),                       -- taxa USD/BRL de referência
  currency          forex_currency NOT NULL DEFAULT 'USD',

  -- Datas
  signed_at         DATE,
  delivery_start    DATE,
  delivery_end      DATE,
  payment_date      DATE,

  -- Vínculo com operações de câmbio (array)
  -- Preenchido via forex_links
  hedged_usd        NUMERIC(16,2) DEFAULT 0,             -- valor já hedgeado (USD)
  hedged_pct        NUMERIC(5,2)  DEFAULT 0,             -- % do contrato hedgeado

  status            VARCHAR(20) DEFAULT 'open',           -- open, partial, fully_hedged, settled
  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX forex_ct_tenant_idx ON forex_contracts (tenant_id);
CREATE INDEX forex_ct_farm_idx   ON forex_contracts (farm_id);
CREATE INDEX forex_ct_season_idx ON forex_contracts (season_id);

CREATE TRIGGER trg_forex_ct_updated_at
  BEFORE UPDATE ON forex_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE forex_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY forex_ct_rls ON forex_contracts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Vínculo: operação de câmbio × contrato de venda ──────────
CREATE TABLE forex_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  operation_id    UUID NOT NULL REFERENCES forex_operations(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES forex_contracts(id)  ON DELETE CASCADE,
  linked_usd      NUMERIC(16,2) NOT NULL,    -- valor vinculado (USD)
  linked_brl      NUMERIC(16,2),             -- valor vinculado (BRL)
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (operation_id, contract_id)
);

CREATE INDEX forex_lk_op_idx  ON forex_links (operation_id);
CREATE INDEX forex_lk_ct_idx  ON forex_links (contract_id);

ALTER TABLE forex_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY forex_lk_rls ON forex_links FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- Trigger: atualiza hedged_usd e hedged_pct no contrato após link
CREATE OR REPLACE FUNCTION update_contract_hedge()
RETURNS TRIGGER AS $$
DECLARE
  v_contract_id UUID;
  v_total_usd   NUMERIC;
  v_hedged      NUMERIC;
BEGIN
  v_contract_id := COALESCE(NEW.contract_id, OLD.contract_id);

  SELECT total_usd INTO v_total_usd
  FROM forex_contracts WHERE id = v_contract_id;

  SELECT COALESCE(SUM(linked_usd), 0) INTO v_hedged
  FROM forex_links WHERE contract_id = v_contract_id;

  UPDATE forex_contracts SET
    hedged_usd = v_hedged,
    hedged_pct = CASE WHEN v_total_usd > 0
      THEN ROUND(v_hedged / v_total_usd * 100, 2)
      ELSE 0 END,
    status = CASE
      WHEN v_hedged <= 0 THEN 'open'
      WHEN v_total_usd > 0 AND v_hedged >= v_total_usd THEN 'fully_hedged'
      ELSE 'partial'
    END
  WHERE id = v_contract_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forex_link_hedge
  AFTER INSERT OR UPDATE OR DELETE ON forex_links
  FOR EACH ROW EXECUTE FUNCTION update_contract_hedge();

-- ── Views ─────────────────────────────────────────────────────
CREATE VIEW forex_operations_summary AS
SELECT
  fo.*,
  f.name  AS farm_name,
  s.name  AS season_name,
  s.crop  AS season_crop,
  p.name  AS partner_name,
  -- Dias para o vencimento
  fo.due_date - CURRENT_DATE AS days_to_due,
  -- Valor mark-to-market (requer taxa atual — placeholder)
  NULL::NUMERIC AS mtm_brl
FROM forex_operations fo
LEFT JOIN farms   f ON f.id = fo.farm_id
LEFT JOIN seasons s ON s.id = fo.season_id
LEFT JOIN partners p ON p.id = fo.partner_id;

CREATE VIEW forex_contracts_summary AS
SELECT
  fc.*,
  f.name  AS farm_name,
  s.name  AS season_name,
  s.crop  AS season_crop,
  p.name  AS partner_name,
  -- Exposição aberta (USD)
  COALESCE(fc.total_usd, 0) - COALESCE(fc.hedged_usd, 0) AS open_exposure_usd,
  -- Dias para entrega
  fc.delivery_start - CURRENT_DATE AS days_to_delivery,
  -- Número de operações vinculadas
  (SELECT COUNT(*) FROM forex_links fl WHERE fl.contract_id = fc.id) AS linked_operations
FROM forex_contracts fc
LEFT JOIN farms    f ON f.id = fc.farm_id
LEFT JOIN seasons  s ON s.id = fc.season_id
LEFT JOIN partners p ON p.id = fc.partner_id;

-- Vista de exposição cambial consolidada por safra/fazenda
CREATE VIEW forex_exposure_summary AS
SELECT
  fc.tenant_id,
  fc.farm_id,
  f.name AS farm_name,
  fc.season_id,
  s.name AS season_name,
  s.crop,
  fc.currency,
  -- Contratos
  COUNT(DISTINCT fc.id)                           AS contract_count,
  SUM(fc.total_usd)                               AS total_contracted_usd,
  SUM(fc.hedged_usd)                              AS total_hedged_usd,
  SUM(COALESCE(fc.total_usd,0) - COALESCE(fc.hedged_usd,0)) AS total_open_usd,
  -- % média de hedge
  CASE WHEN SUM(fc.total_usd) > 0
    THEN ROUND(SUM(fc.hedged_usd) / SUM(fc.total_usd) * 100, 1)
    ELSE 0
  END AS avg_hedge_pct,
  -- Operações de câmbio abertas
  COUNT(DISTINCT fo.id) FILTER (WHERE fo.status = 'open') AS open_operations,
  SUM(fo.foreign_amount) FILTER (WHERE fo.status = 'open') AS hedged_open_usd,
  -- Taxa média ponderada das operações abertas
  CASE WHEN SUM(fo.foreign_amount) FILTER (WHERE fo.status = 'open') > 0
    THEN ROUND(
      SUM(fo.foreign_amount * fo.contracted_rate) FILTER (WHERE fo.status = 'open') /
      SUM(fo.foreign_amount) FILTER (WHERE fo.status = 'open'), 4)
    ELSE NULL
  END AS avg_contracted_rate
FROM forex_contracts fc
LEFT JOIN forex_links fl   ON fl.contract_id  = fc.id
LEFT JOIN forex_operations fo ON fo.id        = fl.operation_id
LEFT JOIN farms   f ON f.id = fc.farm_id
LEFT JOIN seasons s ON s.id = fc.season_id
GROUP BY fc.tenant_id, fc.farm_id, f.name, fc.season_id, s.name, s.crop, fc.currency;
