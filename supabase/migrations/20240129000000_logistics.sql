-- ============================================================
-- Vetra — Módulo de Logística (TMS)
-- Transportadoras, motoristas, veículos, fretes, romaneios
-- Suporte a transporte próprio, terceirizado e multimodal
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE transport_mode AS ENUM (
    'road',       -- rodoviário (caminhão)
    'rail',       -- ferroviário
    'waterway',   -- hidroviário (barcaça)
    'port',       -- operação portuária
    'pipeline'    -- dutoviário (grãos)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE freight_status AS ENUM (
    'draft',        -- rascunho
    'scheduled',    -- agendado
    'loading',      -- em carregamento
    'in_transit',   -- em trânsito
    'unloading',    -- em descarregamento
    'delivered',    -- entregue
    'cancelled'     -- cancelado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_type AS ENUM (
    'truck',        -- caminhão (próprio)
    'semi',         -- carreta/bitrem/rodotrem
    'wagon',        -- vagão ferroviário
    'barge',        -- barcaça
    'vessel',       -- navio
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE carrier_type AS ENUM (
    'own',          -- frota própria
    'third_party',  -- transportadora terceirizada
    'both'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cargo_type AS ENUM (
    'input',        -- insumos (compras → fazenda)
    'output',       -- produção (fazenda → destino)
    'transfer',     -- transferência entre fazendas/armazéns
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Transportadoras ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carriers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  partner_id      UUID REFERENCES partners(id)          ON DELETE SET NULL,

  name            VARCHAR(200) NOT NULL,
  document        VARCHAR(20),           -- CNPJ/CPF
  carrier_type    carrier_type NOT NULL DEFAULT 'third_party',
  antt_code       VARCHAR(20),           -- registro ANTT (RNTRC)
  active          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Contato
  contact_name    VARCHAR(200),
  phone           VARCHAR(30),
  email           VARCHAR(200),
  address         TEXT,

  -- Modais operados
  modes           transport_mode[] DEFAULT '{road}',

  -- Condições comerciais
  payment_terms   VARCHAR(200),
  notes           TEXT,
  tags            TEXT[]  DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS car_tenant_idx  ON carriers (tenant_id);
CREATE INDEX IF NOT EXISTS car_partner_idx ON carriers (partner_id);

CREATE OR REPLACE TRIGGER trg_car_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS car_rls ON carriers;
CREATE POLICY car_rls ON carriers FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Motoristas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drivers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  carrier_id      UUID REFERENCES carriers(id)          ON DELETE SET NULL,

  name            VARCHAR(200) NOT NULL,
  cpf             VARCHAR(14),
  cnh             VARCHAR(20),           -- número da habilitação
  cnh_category    VARCHAR(5),            -- A, B, C, D, E
  cnh_expiry      DATE,
  phone           VARCHAR(30),
  is_own          BOOLEAN DEFAULT FALSE, -- motorista próprio (CLT/PJ)
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drv_tenant_idx  ON drivers (tenant_id);
CREATE INDEX IF NOT EXISTS drv_carrier_idx ON drivers (carrier_id);

CREATE OR REPLACE TRIGGER trg_drv_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drv_rls ON drivers;
CREATE POLICY drv_rls ON drivers FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Veículos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  carrier_id      UUID REFERENCES carriers(id)          ON DELETE SET NULL,
  machinery_id    UUID REFERENCES machinery(id)         ON DELETE SET NULL,

  plate           VARCHAR(10),           -- placa (rodoviário)
  plate_trailer   VARCHAR(10),           -- placa da carreta
  vehicle_type    vehicle_type NOT NULL DEFAULT 'truck',
  brand           VARCHAR(100),
  model           VARCHAR(100),
  year            SMALLINT,
  color           VARCHAR(50),
  renavam         VARCHAR(15),
  tara_kg         NUMERIC(10,2),         -- tara em kg
  capacity_kg     NUMERIC(10,2),         -- capacidade em kg
  capacity_sc     NUMERIC(10,2),         -- capacidade em sacas
  antt_code       VARCHAR(20),           -- registro ANTT do veículo
  is_own          BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS veh_tenant_idx  ON vehicles (tenant_id);
CREATE INDEX IF NOT EXISTS veh_carrier_idx ON vehicles (carrier_id);
CREATE INDEX IF NOT EXISTS veh_plate_idx   ON vehicles (plate);

CREATE OR REPLACE TRIGGER trg_veh_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veh_rls ON vehicles;
CREATE POLICY veh_rls ON vehicles FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Ordem de Frete (OTM — Order de Transporte Multimodal) ────
CREATE TABLE IF NOT EXISTS freight_orders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  farm_id          UUID REFERENCES farms(id)                     ON DELETE SET NULL,
  season_id        UUID REFERENCES seasons(id)                   ON DELETE SET NULL,

  -- Vínculos com outros módulos
  purchase_order_id UUID REFERENCES purchase_orders(id)         ON DELETE SET NULL,
  sale_contract_id  UUID REFERENCES agro_sale_contracts(id)     ON DELETE SET NULL,
  sale_order_id     UUID REFERENCES sales_orders(id)            ON DELETE SET NULL,

  order_number     VARCHAR(30),
  status           freight_status NOT NULL DEFAULT 'draft',
  cargo_type       cargo_type NOT NULL DEFAULT 'output',

  -- Carga
  product_name     VARCHAR(200) NOT NULL,   -- descrição da carga
  unit             VARCHAR(20) DEFAULT 'sc',
  qty_planned      NUMERIC(14,4) NOT NULL,
  qty_loaded       NUMERIC(14,4) DEFAULT 0,
  qty_delivered    NUMERIC(14,4) DEFAULT 0,
  gross_weight_kg  NUMERIC(14,2),
  net_weight_kg    NUMERIC(14,2),

  -- Origem e destino
  origin_name      VARCHAR(300) NOT NULL,   -- ex: "Fazenda Santa Rita"
  origin_address   TEXT,
  origin_lat       NUMERIC(10,7),
  origin_lng       NUMERIC(10,7),
  dest_name        VARCHAR(300) NOT NULL,   -- ex: "Porto de Santos"
  dest_address     TEXT,
  dest_lat         NUMERIC(10,7),
  dest_lng         NUMERIC(10,7),

  -- Datas
  scheduled_date   DATE NOT NULL,
  loaded_at        TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  eta              TIMESTAMPTZ,            -- estimativa de chegada

  -- Custo do frete
  freight_value    NUMERIC(14,2),
  freight_currency VARCHAR(3) DEFAULT 'BRL',
  freight_unit     VARCHAR(20),            -- R$/sc, R$/t, R$/km

  -- CTE
  cte_number       VARCHAR(50),
  cte_key          VARCHAR(50),            -- chave de acesso do CT-e
  cte_value        NUMERIC(14,2),
  cte_issued_at    DATE,

  notes            TEXT,
  tags             TEXT[] DEFAULT '{}',

  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fo_tenant_idx  ON freight_orders (tenant_id);
CREATE INDEX IF NOT EXISTS fo_status_idx  ON freight_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS fo_farm_idx    ON freight_orders (farm_id);
CREATE INDEX IF NOT EXISTS fo_season_idx  ON freight_orders (season_id);
CREATE INDEX IF NOT EXISTS fo_date_idx    ON freight_orders (tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS fo_po_idx      ON freight_orders (purchase_order_id);
CREATE INDEX IF NOT EXISTS fo_sc_idx      ON freight_orders (sale_contract_id);

CREATE OR REPLACE TRIGGER trg_fo_updated_at
  BEFORE UPDATE ON freight_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE freight_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fo_rls ON freight_orders;
CREATE POLICY fo_rls ON freight_orders FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Pernas do frete (legs multimodal) ────────────────────────
-- Cada ordem pode ter N pernas (rodo → ferrovia → porto → navio)
CREATE TABLE IF NOT EXISTS freight_legs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  freight_order_id UUID NOT NULL REFERENCES freight_orders(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  carrier_id       UUID REFERENCES carriers(id)               ON DELETE SET NULL,
  driver_id        UUID REFERENCES drivers(id)                ON DELETE SET NULL,
  vehicle_id       UUID REFERENCES vehicles(id)               ON DELETE SET NULL,

  sequence         SMALLINT NOT NULL DEFAULT 1,
  mode             transport_mode NOT NULL DEFAULT 'road',
  status           freight_status NOT NULL DEFAULT 'scheduled',

  -- Origem e destino da perna
  origin_name      VARCHAR(300) NOT NULL,
  origin_address   TEXT,
  dest_name        VARCHAR(300) NOT NULL,
  dest_address     TEXT,

  -- Datas
  scheduled_date   DATE,
  departed_at      TIMESTAMPTZ,
  arrived_at       TIMESTAMPTZ,
  eta              TIMESTAMPTZ,

  -- Peso e volume
  qty              NUMERIC(14,4),
  gross_weight_kg  NUMERIC(14,2),
  net_weight_kg    NUMERIC(14,2),

  -- Custo desta perna
  freight_value    NUMERIC(14,2),

  -- Documentos
  cte_number       VARCHAR(50),
  cte_key          VARCHAR(50),
  ticket_number    VARCHAR(50),          -- ticket de pesagem
  seal_number      VARCHAR(50),          -- número do lacre

  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fl_order_idx   ON freight_legs (freight_order_id);
CREATE INDEX IF NOT EXISTS fl_carrier_idx ON freight_legs (carrier_id);
CREATE INDEX IF NOT EXISTS fl_driver_idx  ON freight_legs (driver_id);
CREATE INDEX IF NOT EXISTS fl_status_idx  ON freight_legs (tenant_id, status);

CREATE OR REPLACE TRIGGER trg_fl_updated_at
  BEFORE UPDATE ON freight_legs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE freight_legs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fl_rls ON freight_legs;
CREATE POLICY fl_rls ON freight_legs FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- Trigger: atualiza status do freight_order quando todas as pernas entregam
CREATE OR REPLACE FUNCTION update_freight_order_status()
RETURNS TRIGGER AS $$
DECLARE v_order_id UUID; v_all_delivered BOOLEAN;
BEGIN
  v_order_id := COALESCE(NEW.freight_order_id, OLD.freight_order_id);
  SELECT BOOL_AND(status = 'delivered')
  INTO v_all_delivered
  FROM freight_legs WHERE freight_order_id = v_order_id;

  IF v_all_delivered THEN
    UPDATE freight_orders SET status = 'delivered', delivered_at = NOW()
    WHERE id = v_order_id AND status != 'delivered';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fl_order_status ON freight_legs;
CREATE TRIGGER trg_fl_order_status
  AFTER UPDATE ON freight_legs
  FOR EACH ROW EXECUTE FUNCTION update_freight_order_status();

-- ── Tracking de posição ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS freight_tracking (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  freight_leg_id  UUID NOT NULL REFERENCES freight_legs(id)   ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,

  tracked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  speed_kmh       NUMERIC(6,2),
  event_type      VARCHAR(50),           -- departure, checkpoint, arrival, delay, breakdown
  event_desc      TEXT,
  source          VARCHAR(30) DEFAULT 'manual',  -- manual, gps, api

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ft_leg_idx  ON freight_tracking (freight_leg_id);
CREATE INDEX IF NOT EXISTS ft_time_idx ON freight_tracking (freight_leg_id, tracked_at DESC);

ALTER TABLE freight_tracking ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ft_rls ON freight_tracking;
CREATE POLICY ft_rls ON freight_tracking FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Romaneio de carga ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manifests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)              ON DELETE SET NULL,
  freight_order_id UUID REFERENCES freight_orders(id)   ON DELETE SET NULL,

  manifest_number VARCHAR(30),
  issued_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  product_name    VARCHAR(200) NOT NULL,
  unit            VARCHAR(20) DEFAULT 'sc',

  -- Itens do romaneio (cada caminhão/lote)
  -- [{ vehicle_plate, driver_name, qty, gross_kg, tare_kg, net_kg,
  --    ticket_number, moisture_pct, impurity_pct, notes }]
  items           JSONB NOT NULL DEFAULT '[]',

  total_qty       NUMERIC(14,4) DEFAULT 0,
  total_gross_kg  NUMERIC(14,2) DEFAULT 0,
  total_net_kg    NUMERIC(14,2) DEFAULT 0,

  origin_name     VARCHAR(300),
  dest_name       VARCHAR(300),
  notes           TEXT,

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS man_tenant_idx ON manifests (tenant_id);
CREATE INDEX IF NOT EXISTS man_farm_idx   ON manifests (farm_id);
CREATE INDEX IF NOT EXISTS man_date_idx   ON manifests (tenant_id, issued_at DESC);

CREATE OR REPLACE TRIGGER trg_man_updated_at
  BEFORE UPDATE ON manifests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: recalcula totais do romaneio
CREATE OR REPLACE FUNCTION calc_manifest_totals()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_qty      := COALESCE((SELECT SUM((item->>'qty')::NUMERIC)      FROM jsonb_array_elements(NEW.items) item), 0);
  NEW.total_gross_kg := COALESCE((SELECT SUM((item->>'gross_kg')::NUMERIC) FROM jsonb_array_elements(NEW.items) item), 0);
  NEW.total_net_kg   := COALESCE((SELECT SUM((item->>'net_kg')::NUMERIC)   FROM jsonb_array_elements(NEW.items) item), 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_man_totals ON manifests;
CREATE TRIGGER trg_man_totals
  BEFORE INSERT OR UPDATE ON manifests
  FOR EACH ROW EXECUTE FUNCTION calc_manifest_totals();

ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS man_rls ON manifests;
CREATE POLICY man_rls ON manifests FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Views ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS freight_orders_summary;
CREATE VIEW freight_orders_summary AS
SELECT
  fo.*,
  f.name                          AS farm_name,
  s.name                          AS season_name,
  -- Custo total (soma de todas as pernas)
  COALESCE((
    SELECT SUM(fl.freight_value)
    FROM freight_legs fl WHERE fl.freight_order_id = fo.id
  ), fo.freight_value, 0)          AS total_freight_cost,
  -- Número de pernas
  (SELECT COUNT(*) FROM freight_legs fl WHERE fl.freight_order_id = fo.id) AS leg_count,
  -- Dias em trânsito
  CASE WHEN fo.loaded_at IS NOT NULL AND fo.delivered_at IS NULL
    THEN EXTRACT(DAY FROM NOW() - fo.loaded_at)::INTEGER
    ELSE NULL
  END                              AS days_in_transit,
  -- Atraso
  CASE WHEN fo.eta < NOW() AND fo.status NOT IN ('delivered','cancelled')
    THEN EXTRACT(HOUR FROM NOW() - fo.eta)::INTEGER
    ELSE NULL
  END                              AS hours_late
FROM freight_orders fo
LEFT JOIN farms   f ON f.id = fo.farm_id
LEFT JOIN seasons s ON s.id = fo.season_id;

-- View: custo logístico por contrato de venda
DROP VIEW IF EXISTS logistics_cost_by_contract;
CREATE VIEW logistics_cost_by_contract AS
SELECT
  fo.tenant_id,
  fo.sale_contract_id,
  asc2.crop,
  asc2.contract_number,
  p.name                                AS buyer_name,
  COUNT(fo.id)                          AS freight_count,
  SUM(fo.qty_delivered)                 AS qty_delivered,
  asc2.unit,
  SUM(COALESCE(fo.freight_value, 0))    AS total_freight_cost,
  CASE WHEN SUM(fo.qty_delivered) > 0
    THEN ROUND(SUM(COALESCE(fo.freight_value,0)) / SUM(fo.qty_delivered), 2)
    ELSE NULL
  END                                   AS cost_per_unit,
  asc2.unit_price,
  CASE WHEN asc2.unit_price > 0 AND SUM(fo.qty_delivered) > 0
    THEN ROUND(
      SUM(COALESCE(fo.freight_value,0)) /
      (asc2.unit_price * SUM(fo.qty_delivered)) * 100, 2)
    ELSE NULL
  END                                   AS freight_pct_of_revenue
FROM freight_orders fo
JOIN agro_sale_contracts asc2 ON asc2.id = fo.sale_contract_id
JOIN partners p ON p.id = asc2.partner_id
WHERE fo.sale_contract_id IS NOT NULL
  AND fo.status NOT IN ('cancelled')
GROUP BY
  fo.tenant_id, fo.sale_contract_id,
  asc2.crop, asc2.contract_number, asc2.unit,
  asc2.unit_price, p.name;
