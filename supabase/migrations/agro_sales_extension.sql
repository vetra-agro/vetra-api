-- ============================================================
-- Vetra — Vendas Agro: contratos, fixação e volumes
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agro_sale_contract_status AS ENUM (
    'draft', 'active', 'partial', 'complete', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agro_sale_contract_type AS ENUM (
    'cpr',         -- Cédula de Produto Rural
    'forward',     -- Contrato a termo
    'fixed',       -- Preço fixo
    'basis',       -- Basis (diferencial fixado, preço da bolsa em aberto)
    'pool'         -- Pool / cooperativa
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pricing_status AS ENUM (
    'open',      -- em aberto (preço da bolsa não fixado)
    'partial',   -- parcialmente fixado
    'fixed',     -- totalmente fixado
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_type AS ENUM (
    'fixed',
    'market',
    'formula'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Contratos de venda agrícola ───────────────────────────────
CREATE TABLE agro_sale_contracts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id          UUID REFERENCES farms(id)              ON DELETE SET NULL,
  season_id        UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  partner_id       UUID NOT NULL REFERENCES partners(id)  ON DELETE RESTRICT,

  contract_number  VARCHAR(50),
  contract_type    agro_sale_contract_type NOT NULL DEFAULT 'forward',
  status           agro_sale_contract_status NOT NULL DEFAULT 'draft',

  -- Produto
  crop             VARCHAR(100) NOT NULL,   -- Soja, Milho, Algodão...
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  unit             VARCHAR(20) NOT NULL DEFAULT 'sc',

  -- Quantidade
  qty_contracted   NUMERIC(14,4) NOT NULL,
  qty_delivered    NUMERIC(14,4) DEFAULT 0,
  qty_pending      NUMERIC(14,4),           -- calculado por trigger

  -- Preço
  price_type       price_type NOT NULL DEFAULT 'fixed',
  unit_price       NUMERIC(14,4),           -- R$/sc ou USD/sc (se fixo)
  currency         VARCHAR(3)  DEFAULT 'BRL',
  index_base       VARCHAR(50),             -- CBOT, B3, ESALQ
  basis            NUMERIC(10,4),           -- diferencial
  basis_unit       VARCHAR(10),             -- R$/sc, USD/bushel

  -- Totais
  total_amount     NUMERIC(16,2),
  delivered_amount NUMERIC(16,2) DEFAULT 0,

  -- Datas
  signed_at        DATE,
  delivery_start   DATE,
  delivery_end     DATE NOT NULL,

  -- CPR específico
  cpr_number       VARCHAR(50),             -- número da CPR registrada
  cpr_registry     VARCHAR(100),            -- cartório de registro
  cpr_value        NUMERIC(16,2),           -- valor da CPR

  -- Condições
  payment_terms    VARCHAR(200),
  delivery_address TEXT,
  quality_spec     TEXT,                    -- especificação de qualidade (umidade, avariados...)
  penalty_clause   TEXT,

  notes            TEXT,
  attachments      TEXT[] DEFAULT '{}',
  tags             TEXT[]  DEFAULT '{}',

  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX asc_tenant_idx  ON agro_sale_contracts (tenant_id);
CREATE INDEX asc_partner_idx ON agro_sale_contracts (partner_id);
CREATE INDEX asc_season_idx  ON agro_sale_contracts (season_id);
CREATE INDEX asc_status_idx  ON agro_sale_contracts (tenant_id, status);
CREATE INDEX asc_dates_idx   ON agro_sale_contracts (delivery_start, delivery_end);

CREATE TRIGGER trg_asc_updated_at BEFORE UPDATE ON agro_sale_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: calcula qty_pending e total_amount
CREATE OR REPLACE FUNCTION calc_agro_contract_totals()
RETURNS TRIGGER AS $$
BEGIN
  NEW.qty_pending    := GREATEST(0, NEW.qty_contracted - COALESCE(NEW.qty_delivered, 0));
  IF NEW.unit_price IS NOT NULL THEN
    NEW.total_amount     := ROUND(NEW.qty_contracted * NEW.unit_price, 2);
    NEW.delivered_amount := ROUND(COALESCE(NEW.qty_delivered, 0) * NEW.unit_price, 2);
  END IF;
  -- Status automático
  IF NEW.qty_pending <= 0.001 AND NEW.status = 'partial' THEN
    NEW.status := 'complete';
  ELSIF COALESCE(NEW.qty_delivered, 0) > 0 AND NEW.status = 'active' THEN
    NEW.status := 'partial';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asc_totals BEFORE INSERT OR UPDATE ON agro_sale_contracts
  FOR EACH ROW EXECUTE FUNCTION calc_agro_contract_totals();

ALTER TABLE agro_sale_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY asc_rls ON agro_sale_contracts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Entregas de contratos de venda ────────────────────────────
CREATE TABLE agro_sale_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID NOT NULL REFERENCES agro_sale_contracts(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id)             ON DELETE CASCADE,

  delivery_date   DATE NOT NULL,
  qty_delivered   NUMERIC(14,4) NOT NULL,
  unit            VARCHAR(20),
  unit_price      NUMERIC(14,4),           -- preço no momento da entrega (se mercado)
  total_value     NUMERIC(14,2),
  nf_number       VARCHAR(50),
  ticket_number   VARCHAR(50),             -- ticket de pesagem
  moisture_pct    NUMERIC(5,2),            -- % umidade no recebimento
  impurity_pct    NUMERIC(5,2),            -- % impureza
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX asd_contract_idx ON agro_sale_deliveries (contract_id);
CREATE INDEX asd_date_idx     ON agro_sale_deliveries (delivery_date);

-- Trigger: atualiza qty_delivered no contrato
CREATE OR REPLACE FUNCTION update_contract_delivered()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE agro_sale_contracts SET
    qty_delivered = COALESCE((
      SELECT SUM(qty_delivered) FROM agro_sale_deliveries
      WHERE contract_id = COALESCE(NEW.contract_id, OLD.contract_id)
    ), 0)
  WHERE id = COALESCE(NEW.contract_id, OLD.contract_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asd_update
  AFTER INSERT OR UPDATE OR DELETE ON agro_sale_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_contract_delivered();

ALTER TABLE agro_sale_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY asd_rls ON agro_sale_deliveries FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Fixação de preço de commodity ────────────────────────────
-- Registra travamentos parciais ou totais de contratos basis/aberto
CREATE TABLE commodity_pricings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)              ON DELETE CASCADE,
  contract_id     UUID REFERENCES agro_sale_contracts(id)           ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)                       ON DELETE SET NULL,

  crop            VARCHAR(100) NOT NULL,
  status          pricing_status NOT NULL DEFAULT 'open',

  -- Posição total a fixar
  total_qty       NUMERIC(14,4) NOT NULL,
  qty_fixed       NUMERIC(14,4) DEFAULT 0,
  qty_open        NUMERIC(14,4),           -- calculado por trigger
  unit            VARCHAR(20) DEFAULT 'sc',

  -- Índice de referência
  index_base      VARCHAR(50)  NOT NULL,   -- CBOT, B3, ESALQ
  basis           NUMERIC(10,4),
  basis_unit      VARCHAR(10)  DEFAULT 'R$/sc',
  currency        VARCHAR(3)   DEFAULT 'USD',

  -- Datas
  fix_deadline    DATE,                    -- prazo para fixar o preço
  season_ref      VARCHAR(20),             -- contrato da bolsa (ex: "NOV25", "MAR26")

  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX cp_tenant_idx   ON commodity_pricings (tenant_id);
CREATE INDEX cp_season_idx   ON commodity_pricings (season_id);
CREATE INDEX cp_status_idx   ON commodity_pricings (tenant_id, status);
CREATE INDEX cp_deadline_idx ON commodity_pricings (fix_deadline);

CREATE TRIGGER trg_cp_updated_at BEFORE UPDATE ON commodity_pricings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE commodity_pricings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_rls ON commodity_pricings FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Travamentos individuais (ordens de fixação) ───────────────
CREATE TABLE pricing_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pricing_id      UUID NOT NULL REFERENCES commodity_pricings(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,

  fixed_at        DATE NOT NULL,
  qty             NUMERIC(14,4) NOT NULL,
  price           NUMERIC(14,4) NOT NULL,   -- preço travado (ex: CBOT em USD/bushel)
  price_brl       NUMERIC(14,4),            -- equivalente em R$/sc
  exchange_rate   NUMERIC(10,4),            -- câmbio USD/BRL usado
  broker          VARCHAR(100),             -- corretora/broker
  order_ref       VARCHAR(50),              -- referência da ordem no broker
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX po_pricing_idx ON pricing_orders (pricing_id);

-- Trigger: atualiza qty_fixed e status
CREATE OR REPLACE FUNCTION update_pricing_fixed()
RETURNS TRIGGER AS $$
DECLARE v_pid UUID; v_total NUMERIC; v_fixed NUMERIC; v_open NUMERIC;
BEGIN
  v_pid := COALESCE(NEW.pricing_id, OLD.pricing_id);
  SELECT total_qty INTO v_total FROM commodity_pricings WHERE id = v_pid;
  SELECT COALESCE(SUM(qty), 0) INTO v_fixed FROM pricing_orders WHERE pricing_id = v_pid;
  v_open := GREATEST(0, v_total - v_fixed);

  UPDATE commodity_pricings SET
    qty_fixed = v_fixed, qty_open = v_open,
    status = CASE
      WHEN v_open <= 0.001 THEN 'fixed'
      WHEN v_fixed > 0     THEN 'partial'
      ELSE 'open'
    END
  WHERE id = v_pid;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_update
  AFTER INSERT OR UPDATE OR DELETE ON pricing_orders
  FOR EACH ROW EXECUTE FUNCTION update_pricing_fixed();

ALTER TABLE pricing_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY por_rls ON pricing_orders FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── View: volumes contratados vs entregues ────────────────────
CREATE OR REPLACE VIEW agro_volumes_summary AS
SELECT
  asc2.tenant_id,
  asc2.season_id,
  s.name              AS season_name,
  s.crop              AS season_crop,
  asc2.crop,
  asc2.contract_type,
  asc2.unit,
  COUNT(*)            AS contract_count,
  SUM(asc2.qty_contracted)  AS total_contracted,
  SUM(asc2.qty_delivered)   AS total_delivered,
  SUM(asc2.qty_pending)     AS total_pending,
  SUM(asc2.total_amount)    AS total_value,
  SUM(asc2.delivered_amount)AS delivered_value,
  CASE WHEN SUM(asc2.qty_contracted) > 0
    THEN ROUND(SUM(asc2.qty_delivered) / SUM(asc2.qty_contracted) * 100, 1)
    ELSE 0
  END                 AS delivery_pct
FROM agro_sale_contracts asc2
LEFT JOIN seasons s ON s.id = asc2.season_id
WHERE asc2.status NOT IN ('cancelled')
GROUP BY asc2.tenant_id, asc2.season_id, s.name, s.crop, asc2.crop, asc2.contract_type, asc2.unit;
