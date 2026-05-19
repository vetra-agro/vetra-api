-- ============================================================
-- Vetra — Módulo de Inventário (Estoque)
-- Itens, localizações, saldos, movimentações, lotes, qualidade
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE move_type AS ENUM (
    'entry',        -- entrada (recebimento, produção, ajuste +)
    'exit',         -- saída (expedição, consumo, ajuste -)
    'transfer',     -- transferência entre locais
    'adjustment',   -- ajuste de inventário
    'return'        -- devolução
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE move_status AS ENUM (
    'draft', 'confirmed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE item_category AS ENUM (
    'input',        -- insumo agrícola
    'pesticide',    -- defensivo
    'fertilizer',   -- fertilizante
    'seed',         -- semente
    'fuel',         -- combustível / lubrificante
    'spare_part',   -- peça de reposição
    'packaging',    -- embalagem
    'finished',     -- produto acabado (grão, fibra)
    'service',      -- serviço (sem estoque físico)
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE location_type AS ENUM (
    'silo',         -- silo graneleiro
    'warehouse',    -- armazém / galpão
    'cold_room',    -- câmara fria
    'shed',         -- barracão
    'field',        -- campo (insumos em uso)
    'transit',      -- em trânsito
    'external'      -- armazém externo / cooperativa
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lot_status AS ENUM (
    'active', 'quarantine', 'consumed', 'expired', 'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quality_result AS ENUM (
    'approved', 'rejected', 'conditionally_approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Catálogo de Itens (Insumos, Defensivos, etc.) ─────────────
CREATE TABLE IF NOT EXISTS stock_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id)         ON DELETE SET NULL,

  code            VARCHAR(50),
  name            VARCHAR(300) NOT NULL,
  description     TEXT,
  category        item_category NOT NULL DEFAULT 'input',
  unit            VARCHAR(20)  NOT NULL DEFAULT 'un',
  unit_secondary  VARCHAR(20),               -- unidade secundária (ex: L → mL)
  conversion_factor NUMERIC(12,6) DEFAULT 1, -- 1 unit = X unit_secondary

  -- Dados agronômicos
  active_ingredient TEXT,                    -- ingrediente ativo (defensivos)
  formulation       VARCHAR(100),            -- formulação (EC, SC, WP...)
  toxicity_class    SMALLINT,                -- classe toxicológica 1-4
  anvisa_reg        VARCHAR(50),             -- registro ANVISA
  mapa_reg          VARCHAR(50),             -- registro MAPA
  pre_harvest_days  INTEGER,                 -- carência em dias

  -- Fornecedor preferencial
  supplier_id     UUID REFERENCES partners(id) ON DELETE SET NULL,

  -- Custo médio (atualizado a cada entrada)
  avg_cost        NUMERIC(14,4) DEFAULT 0,
  last_cost       NUMERIC(14,4) DEFAULT 0,

  -- Controle
  manages_lot     BOOLEAN DEFAULT FALSE,     -- controla por lote
  manages_expiry  BOOLEAN DEFAULT FALSE,     -- controla vencimento
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS si_tenant_idx   ON stock_items (tenant_id);
CREATE INDEX IF NOT EXISTS si_category_idx ON stock_items (tenant_id, category);
CREATE INDEX IF NOT EXISTS si_code_idx     ON stock_items (tenant_id, code);

CREATE OR REPLACE TRIGGER trg_si_updated_at
  BEFORE UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS si_rls ON stock_items;
CREATE POLICY si_rls ON stock_items FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Localizações (Silos / Armazéns) ──────────────────────────
CREATE TABLE IF NOT EXISTS stock_locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)            ON DELETE SET NULL,

  code            VARCHAR(30),
  name            VARCHAR(200) NOT NULL,
  location_type   location_type NOT NULL DEFAULT 'warehouse',

  -- Capacidade
  capacity        NUMERIC(14,2),
  capacity_unit   VARCHAR(20) DEFAULT 'sc',

  -- Dados físicos
  address         TEXT,
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),

  -- Armazém externo
  partner_id      UUID REFERENCES partners(id) ON DELETE SET NULL, -- cooperativa/terceiro
  external_code   VARCHAR(50),                -- código no armazém externo

  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sl_tenant_idx ON stock_locations (tenant_id);
CREATE INDEX IF NOT EXISTS sl_farm_idx   ON stock_locations (farm_id);

CREATE OR REPLACE TRIGGER trg_sl_updated_at
  BEFORE UPDATE ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sl_rls ON stock_locations;
CREATE POLICY sl_rls ON stock_locations FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Saldos por Item × Localização ────────────────────────────
-- Tabela denormalizada de saldo atual — atualizada por trigger nas movimentações
CREATE TABLE IF NOT EXISTS stock_balances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES stock_items(id)    ON DELETE CASCADE,
  location_id     UUID REFERENCES stock_locations(id)         ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)                 ON DELETE SET NULL,

  qty_on_hand     NUMERIC(14,4) NOT NULL DEFAULT 0,  -- saldo atual
  qty_reserved    NUMERIC(14,4) NOT NULL DEFAULT 0,  -- reservado (pedidos confirmados)
  qty_available   NUMERIC(14,4) GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED,
  qty_min         NUMERIC(14,4) DEFAULT 0,           -- estoque mínimo
  qty_reorder     NUMERIC(14,4) DEFAULT 0,           -- ponto de pedido
  qty_max         NUMERIC(14,4),                     -- estoque máximo

  avg_cost        NUMERIC(14,4) DEFAULT 0,           -- custo médio ponderado
  total_value     NUMERIC(16,2) GENERATED ALWAYS AS (qty_on_hand * avg_cost) STORED,

  last_move_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, item_id, location_id)
);

CREATE INDEX IF NOT EXISTS sb_tenant_idx   ON stock_balances (tenant_id);
CREATE INDEX IF NOT EXISTS sb_item_idx     ON stock_balances (item_id);
CREATE INDEX IF NOT EXISTS sb_location_idx ON stock_balances (location_id);
CREATE INDEX IF NOT EXISTS sb_below_min    ON stock_balances (tenant_id)
  WHERE qty_on_hand < qty_min AND qty_min > 0;

ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sb_rls ON stock_balances;
CREATE POLICY sb_rls ON stock_balances FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Movimentações ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_moves (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES stock_items(id)    ON DELETE RESTRICT,
  location_id     UUID REFERENCES stock_locations(id)         ON DELETE SET NULL,
  location_dest_id UUID REFERENCES stock_locations(id)        ON DELETE SET NULL, -- destino (transfer)
  lot_id          UUID,                                        -- FK após criar lots
  farm_id         UUID REFERENCES farms(id)                   ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)                 ON DELETE SET NULL,
  cost_center_id  UUID REFERENCES cost_centers(id)            ON DELETE SET NULL,

  -- Vínculos com outros módulos
  purchase_order_id UUID REFERENCES purchase_orders(id)       ON DELETE SET NULL,
  sale_contract_id  UUID REFERENCES agro_sale_contracts(id)   ON DELETE SET NULL,

  move_number     VARCHAR(30),
  move_type       move_type    NOT NULL,
  status          move_status  NOT NULL DEFAULT 'draft',

  move_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  document_ref    VARCHAR(100),               -- NF, romaneio, etc.

  qty             NUMERIC(14,4) NOT NULL,
  unit            VARCHAR(20)   NOT NULL,
  unit_cost       NUMERIC(14,4) DEFAULT 0,
  total_cost      NUMERIC(16,2) GENERATED ALWAYS AS (qty * unit_cost) STORED,

  -- Para ajuste de inventário
  qty_before      NUMERIC(14,4),
  qty_after       NUMERIC(14,4),

  reason          TEXT,
  notes           TEXT,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    VARCHAR(200),
  cancel_reason   TEXT,

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sm_tenant_idx ON stock_moves (tenant_id);
CREATE INDEX IF NOT EXISTS sm_item_idx   ON stock_moves (item_id);
CREATE INDEX IF NOT EXISTS sm_date_idx   ON stock_moves (tenant_id, move_date DESC);
CREATE INDEX IF NOT EXISTS sm_status_idx ON stock_moves (tenant_id, status);
CREATE INDEX IF NOT EXISTS sm_type_idx   ON stock_moves (tenant_id, move_type);

CREATE OR REPLACE TRIGGER trg_sm_updated_at
  BEFORE UPDATE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: atualiza stock_balances ao confirmar movimentação
CREATE OR REPLACE FUNCTION update_stock_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_delta  NUMERIC;
  v_old_qty NUMERIC;
  v_old_cost NUMERIC;
  v_new_avg  NUMERIC;
BEGIN
  -- Só processa ao confirmar
  IF NEW.status = 'confirmed' AND OLD.status != 'confirmed' THEN
    v_delta := CASE
      WHEN NEW.move_type IN ('entry','return','adjustment') THEN NEW.qty
      WHEN NEW.move_type = 'exit' THEN -NEW.qty
      WHEN NEW.move_type = 'transfer' THEN 0  -- tratado separado
      ELSE 0
    END;

    -- Garante registro de saldo
    INSERT INTO stock_balances (tenant_id, item_id, location_id, season_id, qty_on_hand, avg_cost, last_move_at)
    VALUES (NEW.tenant_id, NEW.item_id, NEW.location_id, NEW.season_id, 0, 0, NOW())
    ON CONFLICT (tenant_id, item_id, location_id) DO NOTHING;

    -- Atualiza custo médio ponderado (só em entradas)
    IF NEW.move_type IN ('entry','return') AND NEW.unit_cost > 0 THEN
      SELECT qty_on_hand, avg_cost INTO v_old_qty, v_old_cost
      FROM stock_balances WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id
        AND (location_id = NEW.location_id OR (location_id IS NULL AND NEW.location_id IS NULL));

      IF (v_old_qty + NEW.qty) > 0 THEN
        v_new_avg := ((v_old_qty * COALESCE(v_old_cost,0)) + (NEW.qty * NEW.unit_cost))
                     / (v_old_qty + NEW.qty);
      ELSE v_new_avg := NEW.unit_cost; END IF;
    END IF;

    UPDATE stock_balances SET
      qty_on_hand  = qty_on_hand + v_delta,
      avg_cost     = COALESCE(v_new_avg, avg_cost),
      last_move_at = NOW(),
      updated_at   = NOW()
    WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id
      AND (location_id = NEW.location_id OR (location_id IS NULL AND NEW.location_id IS NULL));

    -- Transfer: debita origem e credita destino
    IF NEW.move_type = 'transfer' AND NEW.location_dest_id IS NOT NULL THEN
      UPDATE stock_balances SET qty_on_hand = qty_on_hand - NEW.qty, last_move_at = NOW()
      WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id AND location_id = NEW.location_id;

      INSERT INTO stock_balances (tenant_id, item_id, location_id, qty_on_hand, avg_cost, last_move_at)
      VALUES (NEW.tenant_id, NEW.item_id, NEW.location_dest_id, NEW.qty, NEW.unit_cost, NOW())
      ON CONFLICT (tenant_id, item_id, location_id)
      DO UPDATE SET qty_on_hand = stock_balances.qty_on_hand + NEW.qty, last_move_at = NOW();
    END IF;

    -- Cancela: reverte
  ELSIF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
    v_delta := CASE
      WHEN OLD.move_type IN ('entry','return') THEN -OLD.qty
      WHEN OLD.move_type = 'exit' THEN OLD.qty
      ELSE 0
    END;
    UPDATE stock_balances SET qty_on_hand = qty_on_hand + v_delta, last_move_at = NOW()
    WHERE tenant_id = OLD.tenant_id AND item_id = OLD.item_id
      AND (location_id = OLD.location_id OR (location_id IS NULL AND OLD.location_id IS NULL));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sm_balance ON stock_moves;
CREATE TRIGGER trg_sm_balance
  AFTER UPDATE ON stock_moves
  FOR EACH ROW EXECUTE FUNCTION update_stock_balance();

ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_rls ON stock_moves;
CREATE POLICY sm_rls ON stock_moves FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Lotes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_lots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES stock_items(id)  ON DELETE CASCADE,
  location_id     UUID REFERENCES stock_locations(id)       ON DELETE SET NULL,
  supplier_id     UUID REFERENCES partners(id)              ON DELETE SET NULL,

  lot_number      VARCHAR(100) NOT NULL,
  status          lot_status NOT NULL DEFAULT 'active',

  manufacture_date DATE,
  expiry_date      DATE,
  entry_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  qty_received    NUMERIC(14,4) NOT NULL,
  qty_on_hand     NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit            VARCHAR(20),

  unit_cost       NUMERIC(14,4),
  nf_number       VARCHAR(50),
  document_ref    VARCHAR(100),

  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lot_tenant_idx ON stock_lots (tenant_id);
CREATE INDEX IF NOT EXISTS lot_item_idx   ON stock_lots (item_id);
CREATE INDEX IF NOT EXISTS lot_expiry_idx ON stock_lots (expiry_date);
CREATE INDEX IF NOT EXISTS lot_number_idx ON stock_lots (tenant_id, lot_number);

-- Adiciona FK de stock_moves → stock_lots agora que lots existe
ALTER TABLE stock_moves
  ADD CONSTRAINT fk_sm_lot FOREIGN KEY (lot_id) REFERENCES stock_lots(id) ON DELETE SET NULL;

CREATE OR REPLACE TRIGGER trg_lot_updated_at
  BEFORE UPDATE ON stock_lots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lot_rls ON stock_lots;
CREATE POLICY lot_rls ON stock_lots FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Controle de Qualidade ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_quality (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES stock_items(id)  ON DELETE CASCADE,
  lot_id          UUID REFERENCES stock_lots(id)            ON DELETE SET NULL,
  location_id     UUID REFERENCES stock_locations(id)       ON DELETE SET NULL,
  move_id         UUID REFERENCES stock_moves(id)           ON DELETE SET NULL,

  analysis_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  analyst         VARCHAR(200),
  result          quality_result NOT NULL DEFAULT 'approved',

  -- Parâmetros (grãos)
  moisture_pct    NUMERIC(6,3),      -- % umidade
  impurity_pct    NUMERIC(6,3),      -- % impureza
  damaged_pct     NUMERIC(6,3),      -- % avariados
  broken_pct      NUMERIC(6,3),      -- % quebrados
  greenish_pct    NUMERIC(6,3),      -- % esverdeados
  weight_1000     NUMERIC(8,2),      -- peso de 1000 grãos (g)

  -- Parâmetros (defensivos)
  ph_value        NUMERIC(6,3),
  density         NUMERIC(8,4),

  -- Resultado personalizado (JSONB)
  custom_params   JSONB DEFAULT '{}',

  discount_pct    NUMERIC(6,3) DEFAULT 0,   -- % desconto por qualidade
  classification  VARCHAR(100),              -- Tipo 1, 2, USDA #2...
  notes           TEXT,
  report_url      TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sq_tenant_idx ON stock_quality (tenant_id);
CREATE INDEX IF NOT EXISTS sq_item_idx   ON stock_quality (item_id);
CREATE INDEX IF NOT EXISTS sq_lot_idx    ON stock_quality (lot_id);
CREATE INDEX IF NOT EXISTS sq_date_idx   ON stock_quality (tenant_id, analysis_date DESC);

CREATE OR REPLACE TRIGGER trg_sq_updated_at
  BEFORE UPDATE ON stock_quality
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE stock_quality ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sq_rls ON stock_quality;
CREATE POLICY sq_rls ON stock_quality FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Views ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS stock_balances_summary;
CREATE VIEW stock_balances_summary AS
SELECT
  sb.*,
  si.code           AS item_code,
  si.name           AS item_name,
  si.category       AS item_category,
  si.unit           AS item_unit,
  si.manages_lot,
  sl.name           AS location_name,
  sl.location_type,
  f.name            AS farm_name,
  CASE WHEN sb.qty_min > 0 AND sb.qty_on_hand < sb.qty_min THEN TRUE ELSE FALSE END AS below_min,
  CASE WHEN sb.qty_reorder > 0 AND sb.qty_on_hand <= sb.qty_reorder THEN TRUE ELSE FALSE END AS at_reorder
FROM stock_balances sb
JOIN  stock_items     si ON si.id = sb.item_id
LEFT JOIN stock_locations sl ON sl.id = sb.location_id
LEFT JOIN farms           f  ON f.id  = sl.farm_id;

DROP VIEW IF EXISTS stock_moves_detail;
CREATE VIEW stock_moves_detail AS
SELECT
  sm.*,
  si.name       AS item_name,
  si.code       AS item_code,
  si.unit       AS item_unit,
  sl.name       AS location_name,
  ld.name       AS location_dest_name,
  lo.lot_number,
  f.name        AS farm_name,
  s.name        AS season_name,
  po.id         AS po_ref,
  asc2.contract_number AS sale_contract_ref
FROM stock_moves sm
JOIN  stock_items     si   ON si.id   = sm.item_id
LEFT JOIN stock_locations sl   ON sl.id   = sm.location_id
LEFT JOIN stock_locations ld   ON ld.id   = sm.location_dest_id
LEFT JOIN stock_lots      lo   ON lo.id   = sm.lot_id
LEFT JOIN farms           f    ON f.id    = sm.farm_id
LEFT JOIN seasons         s    ON s.id    = sm.season_id
LEFT JOIN purchase_orders po   ON po.id   = sm.purchase_order_id
LEFT JOIN agro_sale_contracts asc2 ON asc2.id = sm.sale_contract_id;
