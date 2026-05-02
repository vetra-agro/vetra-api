-- ============================================================
-- Vetra — Veículos de terceiros por fazenda
-- Para abastecimentos de prestadores, empreiteiros, etc.
-- ============================================================

CREATE TABLE third_party_vehicles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id       UUID NOT NULL REFERENCES farms(id)   ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,     -- ex: "Caminhão Colheita - Transportes Silva"
  license_plate VARCHAR(20),
  owner_name    VARCHAR(200),              -- nome do proprietário / empresa
  owner_doc     VARCHAR(30),              -- CPF / CNPJ
  fuel_type     fuel_supply_type NOT NULL DEFAULT 'diesel',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_third_party_vehicles_updated_at
  BEFORE UPDATE ON third_party_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE third_party_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpv_rls ON third_party_vehicles FOR ALL USING (
  tenant_id IN (
    SELECT ut.tenant_id FROM user_tenants ut
    WHERE ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- Adiciona colunas de vínculo na tabela fuel_supplies
-- (se já não existirem — migration segura)
ALTER TABLE fuel_supplies
  ADD COLUMN IF NOT EXISTS third_party_vehicle_id UUID REFERENCES third_party_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_third_party BOOLEAN NOT NULL DEFAULT FALSE;

-- Atualiza a view fuel_supplies_summary
DROP VIEW IF EXISTS fuel_supplies_summary;
CREATE VIEW fuel_supplies_summary AS
SELECT
  fs.*,
  f.name        AS farm_name,
  m.name        AS machinery_name,
  m.fleet_number,
  m.type        AS machinery_type,
  m.brand       AS machinery_brand,
  m.model       AS machinery_model,
  tpv.name      AS third_party_vehicle_name,
  tpv.license_plate AS third_party_plate,
  tpv.owner_name AS third_party_owner,
  t.name        AS tank_name,
  t.current_l   AS tank_current_l,
  t.capacity_l  AS tank_capacity_l,
  s.name        AS season_name
FROM fuel_supplies fs
JOIN  farms    f   ON f.id   = fs.farm_id
LEFT JOIN machinery m ON m.id = fs.machinery_id
LEFT JOIN third_party_vehicles tpv ON tpv.id = fs.third_party_vehicle_id
LEFT JOIN fuel_tanks t ON t.id  = fs.tank_id
LEFT JOIN seasons    s ON s.id  = fs.season_id;
