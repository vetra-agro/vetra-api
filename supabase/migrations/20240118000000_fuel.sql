-- ============================================================
-- Vetra — Abastecimento e Combustíveis
-- ============================================================

DO $$ BEGIN
  CREATE TYPE fuel_supply_type AS ENUM (
    'diesel',
    'gasoline',
    'ethanol',
    'biodiesel',
    'arla32',    -- arla/adblue
    'oil',       -- óleo lubrificante
    'grease',    -- graxa
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE supply_source AS ENUM (
    'farm_tank',    -- tanque da fazenda
    'supplier',     -- fornecedor externo
    'fuel_truck',   -- caminhão-tanque
    'gas_station'   -- posto externo
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela de tanques / reservatórios ─────────────────────────
CREATE TABLE fuel_tanks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id       UUID NOT NULL REFERENCES farms(id)   ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,       -- ex: "Tanque principal - Diesel"
  fuel_type     fuel_supply_type NOT NULL,
  capacity_l    NUMERIC(10,2),               -- capacidade total (L)
  current_l     NUMERIC(10,2) DEFAULT 0,     -- saldo atual (L)
  min_level_l   NUMERIC(10,2),               -- nível mínimo de alerta
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  location_desc VARCHAR(200),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_fuel_tanks_updated_at
  BEFORE UPDATE ON fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE fuel_tanks ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_tanks_rls ON fuel_tanks FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Tabela de abastecimentos ──────────────────────────────────
CREATE TABLE fuel_supplies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  farm_id         UUID NOT NULL REFERENCES farms(id)       ON DELETE CASCADE,
  tank_id         UUID REFERENCES fuel_tanks(id)           ON DELETE SET NULL,
  machinery_id    UUID REFERENCES machinery(id)            ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)              ON DELETE SET NULL,

  -- ── Tipo e fonte ──────────────────────────────────────────
  fuel_type       fuel_supply_type NOT NULL DEFAULT 'diesel',
  source          supply_source    NOT NULL DEFAULT 'farm_tank',

  -- ── Quando ───────────────────────────────────────────────
  supplied_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ── Quantidade e custo ────────────────────────────────────
  quantity_l      NUMERIC(10,3) NOT NULL,    -- litros abastecidos
  price_per_l     NUMERIC(8,4),              -- preço por litro (R$)
  total_cost      NUMERIC(12,2),             -- custo total (R$)

  -- ── Horímetro / Odômetro ──────────────────────────────────
  hourmeter       NUMERIC(10,1),             -- horímetro no momento
  odometer_km     NUMERIC(10,1),             -- odômetro no momento
  -- Consumo calculado em relação ao abastecimento anterior
  hours_since_last  NUMERIC(8,1),            -- horas desde último abastecimento
  km_since_last     NUMERIC(8,1),            -- km desde último abastecimento
  consumption_l_h   NUMERIC(6,3),            -- consumo (L/h) calculado
  consumption_l_km  NUMERIC(6,4),            -- consumo (L/km) calculado

  -- ── Quem abasteceu ────────────────────────────────────────
  operator_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  operator_name   VARCHAR(200),

  -- ── Fornecedor / nota fiscal ──────────────────────────────
  supplier_name   VARCHAR(200),
  invoice_number  VARCHAR(50),
  batch_number    VARCHAR(50),

  -- ── Extras ───────────────────────────────────────────────
  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',

  -- ── Auditoria ────────────────────────────────────────────
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX fs_tenant_idx    ON fuel_supplies (tenant_id);
CREATE INDEX fs_farm_idx      ON fuel_supplies (farm_id, supplied_at DESC);
CREATE INDEX fs_machinery_idx ON fuel_supplies (machinery_id, supplied_at DESC);
CREATE INDEX fs_tank_idx      ON fuel_supplies (tank_id);
CREATE INDEX fs_season_idx    ON fuel_supplies (season_id);
CREATE INDEX fs_date_idx      ON fuel_supplies (supplied_at DESC);

-- Trigger updated_at
CREATE TRIGGER trg_fuel_supplies_updated_at
  BEFORE UPDATE ON fuel_supplies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: calcular custo total e consumo
CREATE OR REPLACE FUNCTION calc_fuel_supply()
RETURNS TRIGGER AS $$
DECLARE
  prev RECORD;
BEGIN
  -- Custo total
  IF NEW.price_per_l IS NOT NULL THEN
    NEW.total_cost = ROUND(NEW.quantity_l * NEW.price_per_l, 2);
  END IF;

  -- Busca abastecimento anterior da mesma máquina
  IF NEW.machinery_id IS NOT NULL THEN
    SELECT hourmeter, odometer_km
    INTO prev
    FROM fuel_supplies
    WHERE machinery_id = NEW.machinery_id
      AND id != NEW.id
      AND supplied_at < NEW.supplied_at
    ORDER BY supplied_at DESC
    LIMIT 1;

    -- Calcular consumo por hora
    IF prev.hourmeter IS NOT NULL AND NEW.hourmeter IS NOT NULL AND NEW.hourmeter > prev.hourmeter THEN
      NEW.hours_since_last  = NEW.hourmeter - prev.hourmeter;
      NEW.consumption_l_h   = ROUND(NEW.quantity_l / NEW.hours_since_last, 3);
    END IF;

    -- Calcular consumo por km
    IF prev.odometer_km IS NOT NULL AND NEW.odometer_km IS NOT NULL AND NEW.odometer_km > prev.odometer_km THEN
      NEW.km_since_last     = NEW.odometer_km - prev.odometer_km;
      NEW.consumption_l_km  = ROUND(NEW.quantity_l / NEW.km_since_last, 4);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calc_fuel
  BEFORE INSERT OR UPDATE ON fuel_supplies
  FOR EACH ROW EXECUTE FUNCTION calc_fuel_supply();

-- Trigger: atualizar saldo do tanque
CREATE OR REPLACE FUNCTION update_tank_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tank_id IS NOT NULL THEN
    -- Recalcula saldo do tanque somando todos os abastecimentos
    -- (entrada = positivo quando source é externo, saída = negativo quando abastece máquina)
    -- Para simplificação no PoC: todo registro é saída do tanque
    UPDATE fuel_tanks
    SET current_l = (
      SELECT GREATEST(0, capacity_l - COALESCE(SUM(quantity_l), 0))
      FROM fuel_supplies
      WHERE tank_id = NEW.tank_id
    )
    WHERE id = NEW.tank_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tank_balance
  AFTER INSERT OR UPDATE OR DELETE ON fuel_supplies
  FOR EACH ROW EXECUTE FUNCTION update_tank_balance();

-- RLS
ALTER TABLE fuel_supplies ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_supplies_rls ON fuel_supplies FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- View com dados relacionados
CREATE VIEW fuel_supplies_summary AS
SELECT
  fs.*,
  f.name   AS farm_name,
  m.name   AS machinery_name,
  m.fleet_number,
  t.name   AS tank_name,
  t.current_l AS tank_current_l,
  t.capacity_l AS tank_capacity_l,
  s.name   AS season_name
FROM fuel_supplies fs
JOIN  farms     f ON f.id = fs.farm_id
LEFT JOIN machinery m ON m.id = fs.machinery_id
LEFT JOIN fuel_tanks t ON t.id = fs.tank_id
LEFT JOIN seasons   s ON s.id = fs.season_id;
