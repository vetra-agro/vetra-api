-- ============================================================
-- Vetra — Contratos de Insumos Agrícolas
-- Tabela separada de purchase_contracts, com campos específicos
-- para defensivos, sementes, fertilizantes e outros insumos
-- ============================================================

DO $$ BEGIN
  CREATE TYPE agro_contract_status AS ENUM (
    'draft',    -- rascunho
    'active',   -- vigente
    'partial',  -- parcialmente entregue
    'complete', -- totalmente entregue
    'cancelled',-- cancelado
    'expired'   -- expirado sem uso total
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agro_input_category AS ENUM (
    'herbicide',    -- herbicida
    'fungicide',    -- fungicida
    'insecticide',  -- inseticida
    'adjuvant',     -- adjuvante
    'seed',         -- semente
    'fertilizer',   -- fertilizante
    'inoculant',    -- inoculante
    'corrective',   -- corretivo de solo
    'other'         -- outro
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Contratos de Insumos Agrícolas ────────────────────────────
CREATE TABLE agro_input_contracts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id          UUID REFERENCES farms(id)              ON DELETE SET NULL,
  season_id        UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  partner_id       UUID NOT NULL REFERENCES partners(id)  ON DELETE RESTRICT,

  -- Identificação
  contract_number  VARCHAR(50),
  status           agro_contract_status NOT NULL DEFAULT 'draft',
  title            VARCHAR(300) NOT NULL,
  description      TEXT,

  -- Datas
  signed_at        DATE,
  valid_from       DATE NOT NULL,
  valid_until      DATE NOT NULL,

  -- Condições de preço
  -- Moeda de referência (BRL ou USD — comum em soja/milho)
  currency         VARCHAR(3) DEFAULT 'BRL',
  -- Indexador (ex: CBOT+basis, dólar comercial, preço fixo)
  price_indexer    VARCHAR(100),
  -- Taxa de câmbio de referência (se USD)
  reference_rate   NUMERIC(10,4),

  -- Pagamento
  payment_terms    VARCHAR(200),
  -- Tipo: antecipado (cash), prazo, troca (barter com grãos)
  payment_type     VARCHAR(30) DEFAULT 'term',  -- cash, term, barter
  -- Se barter: quantidade de sacas e cultura
  barter_crop      VARCHAR(100),
  barter_qty_sc    NUMERIC(12,2),
  barter_price_sc  NUMERIC(10,4),

  -- Entrega
  delivery_start   DATE,
  delivery_end     DATE,
  delivery_address TEXT,
  delivery_parcels INTEGER DEFAULT 1,  -- número de parcelas de entrega

  -- Frete e impostos
  freight_type     VARCHAR(20) DEFAULT 'cif',  -- cif, fob
  includes_taxes   BOOLEAN DEFAULT TRUE,

  -- Cláusulas
  penalty_clause   TEXT,
  warranty_months  INTEGER,
  notes            TEXT,
  attachments      TEXT[] DEFAULT '{}',
  tags             TEXT[]  DEFAULT '{}',

  -- Totalizadores (calculados pelos itens)
  total_amount     NUMERIC(16,2) DEFAULT 0,
  total_delivered  NUMERIC(16,2) DEFAULT 0,
  balance_amount   NUMERIC(16,2) DEFAULT 0,

  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX aic_tenant_idx  ON agro_input_contracts (tenant_id);
CREATE INDEX aic_partner_idx ON agro_input_contracts (partner_id);
CREATE INDEX aic_season_idx  ON agro_input_contracts (season_id);
CREATE INDEX aic_status_idx  ON agro_input_contracts (tenant_id, status);
CREATE INDEX aic_dates_idx   ON agro_input_contracts (valid_from, valid_until);

CREATE TRIGGER trg_aic_updated_at BEFORE UPDATE ON agro_input_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE agro_input_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY aic_rls ON agro_input_contracts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Itens do contrato de insumos ──────────────────────────────
CREATE TABLE agro_input_contract_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID NOT NULL REFERENCES agro_input_contracts(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Produto
  input_category  agro_input_category NOT NULL DEFAULT 'other',
  product_name    VARCHAR(300) NOT NULL,
  active_ingredient VARCHAR(200),  -- ingrediente ativo (defensivos)
  brand           VARCHAR(200),
  sku             VARCHAR(100),
  registration_nr VARCHAR(50),     -- registro MAPA (defensivos)

  -- Quantidade e preço
  unit            VARCHAR(20) NOT NULL DEFAULT 'L',  -- L, kg, sc, t, un, caixa
  quantity        NUMERIC(14,4) NOT NULL,
  unit_price      NUMERIC(14,4) NOT NULL,
  total_price     NUMERIC(16,2),  -- calculado por trigger

  -- Entrega parcial
  qty_delivered   NUMERIC(14,4) DEFAULT 0,
  qty_pending     NUMERIC(14,4),  -- calculado por trigger

  -- Aplicação prevista
  area_ha         NUMERIC(10,2),     -- área de aplicação prevista
  dose_per_ha     NUMERIC(10,4),     -- dose/ha (L/ha, kg/ha)
  application_date DATE,             -- data prevista de aplicação

  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX aici_contract_idx ON agro_input_contract_items (contract_id);

-- Trigger: calcula total_price e qty_pending
CREATE OR REPLACE FUNCTION calc_agro_item_totals()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_price = ROUND(NEW.quantity * NEW.unit_price, 2);
  NEW.qty_pending = GREATEST(0, NEW.quantity - COALESCE(NEW.qty_delivered, 0));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_aici_totals BEFORE INSERT OR UPDATE ON agro_input_contract_items
  FOR EACH ROW EXECUTE FUNCTION calc_agro_item_totals();

-- Trigger: recalcula totais no contrato quando itens mudam
CREATE OR REPLACE FUNCTION update_agro_contract_totals()
RETURNS TRIGGER AS $$
DECLARE v_contract_id UUID;
BEGIN
  v_contract_id := COALESCE(NEW.contract_id, OLD.contract_id);
  UPDATE agro_input_contracts SET
    total_amount   = COALESCE((SELECT SUM(total_price)    FROM agro_input_contract_items WHERE contract_id = v_contract_id), 0),
    total_delivered= COALESCE((SELECT SUM(qty_delivered * unit_price) FROM agro_input_contract_items WHERE contract_id = v_contract_id), 0),
    balance_amount = COALESCE((SELECT SUM(total_price)    FROM agro_input_contract_items WHERE contract_id = v_contract_id), 0)
                   - COALESCE((SELECT SUM(qty_delivered * unit_price) FROM agro_input_contract_items WHERE contract_id = v_contract_id), 0)
  WHERE id = v_contract_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_aici_contract_totals
  AFTER INSERT OR UPDATE OR DELETE ON agro_input_contract_items
  FOR EACH ROW EXECUTE FUNCTION update_agro_contract_totals();

ALTER TABLE agro_input_contract_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY aici_rls ON agro_input_contract_items FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Entregas de insumos por contrato ─────────────────────────
CREATE TABLE agro_input_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID NOT NULL REFERENCES agro_input_contracts(id) ON DELETE CASCADE,
  contract_item_id UUID REFERENCES agro_input_contract_items(id)   ON DELETE SET NULL,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  delivery_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  qty_delivered   NUMERIC(14,4) NOT NULL,
  unit            VARCHAR(20),
  nf_number       VARCHAR(50),
  nf_value        NUMERIC(14,2),
  received_by     VARCHAR(200),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX aid_contract_idx ON agro_input_deliveries (contract_id);

-- Trigger: atualiza qty_delivered no item
CREATE OR REPLACE FUNCTION update_item_delivered()
RETURNS TRIGGER AS $$
DECLARE v_item_id UUID;
BEGIN
  v_item_id := COALESCE(NEW.contract_item_id, OLD.contract_item_id);
  IF v_item_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE agro_input_contract_items SET
    qty_delivered = COALESCE((
      SELECT SUM(qty_delivered) FROM agro_input_deliveries
      WHERE contract_item_id = v_item_id
    ), 0)
  WHERE id = v_item_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_aid_update_item
  AFTER INSERT OR UPDATE OR DELETE ON agro_input_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_item_delivered();

ALTER TABLE agro_input_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY aid_rls ON agro_input_deliveries FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── View consolidada ──────────────────────────────────────────
CREATE VIEW agro_input_contracts_summary AS
SELECT
  aic.*,
  p.name         AS partner_name,
  p.document     AS partner_document,
  f.name         AS farm_name,
  s.name         AS season_name,
  s.crop         AS season_crop,
  aic.valid_until - CURRENT_DATE AS days_to_expiry,
  CASE WHEN aic.total_amount > 0
    THEN ROUND(aic.total_delivered / aic.total_amount * 100, 1)
    ELSE 0
  END AS delivery_pct,
  (SELECT COUNT(*) FROM agro_input_contract_items aici WHERE aici.contract_id = aic.id) AS item_count,
  (SELECT COUNT(*) FROM agro_input_deliveries aid WHERE aid.contract_id = aic.id)       AS delivery_count
FROM agro_input_contracts aic
JOIN partners p ON p.id = aic.partner_id
LEFT JOIN farms   f ON f.id = aic.farm_id
LEFT JOIN seasons s ON s.id = aic.season_id;
