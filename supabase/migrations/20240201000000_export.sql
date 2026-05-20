-- ============================================================
-- Vetra — Módulo de Exportação
-- Contratos, documentação, câmbio/hedge, logística internacional
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE export_contract_status AS ENUM (
    'draft','active','partial','complete','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incoterm AS ENUM (
    'FOB','CIF','CFR','EXW','FCA','CPT','CIP','DAP','DPU','DDP'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_type AS ENUM (
    're',           -- Registro de Exportação (SISCOMEX)
    'due',          -- Declaração Única de Exportação
    'bl',           -- Bill of Lading
    'awb',          -- Air Waybill
    'packing_list', -- Packing List
    'co',           -- Certificate of Origin
    'phyto',        -- Certificado Fitossanitário
    'invoice',      -- Commercial Invoice
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_status AS ENUM (
    'pending','issued','approved','rejected','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE forex_op_type AS ENUM (
    'spot',   -- câmbio pronto
    'ndf',    -- Non-Deliverable Forward
    'acc',    -- Adiantamento sobre Contrato de Câmbio
    'ace',    -- Adiantamento sobre Cambiais Entregues
    'option', -- opção de câmbio
    'swap'    -- swap cambial
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE forex_status AS ENUM (
    'open','partial','closed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'planned','booking','loading','in_transit','arrived','customs','delivered','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Contratos de Exportação ───────────────────────────────────
CREATE TABLE IF NOT EXISTS export_contracts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id)             ON DELETE SET NULL,
  season_id         UUID REFERENCES seasons(id)           ON DELETE SET NULL,
  partner_id        UUID REFERENCES partners(id)          ON DELETE SET NULL, -- trading company

  contract_number   VARCHAR(50),
  status            export_contract_status NOT NULL DEFAULT 'draft',

  -- Produto
  crop              VARCHAR(100) NOT NULL,
  product_desc      TEXT,
  unit              VARCHAR(20) DEFAULT 'mt', -- mt = metric ton, bu = bushel
  qty_contracted    NUMERIC(14,4) NOT NULL,
  qty_shipped       NUMERIC(14,4) DEFAULT 0,
  qty_pending       NUMERIC(14,4),

  -- Preço
  price_usd         NUMERIC(14,4),            -- USD/mt ou USD/bu
  price_brl         NUMERIC(14,4),            -- equivalente R$
  exchange_rate     NUMERIC(10,4),            -- câmbio contratado
  incoterm          incoterm DEFAULT 'FOB',
  port_origin       VARCHAR(200),             -- porto de origem (Santos, Paranaguá...)
  port_dest         VARCHAR(200),             -- porto de destino
  country_dest      VARCHAR(100),             -- país de destino

  -- Totais
  total_usd         NUMERIC(16,2),
  total_brl         NUMERIC(16,2),

  -- Datas
  signed_at         DATE,
  shipment_start    DATE,
  shipment_end      DATE NOT NULL,

  -- Trading company
  buyer_name        VARCHAR(300),             -- nome do comprador final
  buyer_country     VARCHAR(100),

  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',
  attachments       TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ec_tenant_idx  ON export_contracts (tenant_id);
CREATE INDEX IF NOT EXISTS ec_status_idx  ON export_contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS ec_season_idx  ON export_contracts (season_id);
CREATE INDEX IF NOT EXISTS ec_date_idx    ON export_contracts (tenant_id, shipment_end);

-- Trigger: calcula qty_pending e totais
CREATE OR REPLACE FUNCTION calc_export_contract()
RETURNS TRIGGER AS $$
BEGIN
  NEW.qty_pending := GREATEST(0, NEW.qty_contracted - COALESCE(NEW.qty_shipped, 0));
  IF NEW.price_usd IS NOT NULL THEN
    NEW.total_usd := ROUND(NEW.qty_contracted * NEW.price_usd, 2);
  END IF;
  IF NEW.price_brl IS NOT NULL THEN
    NEW.total_brl := ROUND(NEW.qty_contracted * NEW.price_brl, 2);
  ELSIF NEW.total_usd IS NOT NULL AND NEW.exchange_rate IS NOT NULL THEN
    NEW.total_brl := ROUND(NEW.total_usd * NEW.exchange_rate, 2);
  END IF;
  IF NEW.qty_pending <= 0.001 AND NEW.status = 'partial' THEN
    NEW.status := 'complete';
  ELSIF COALESCE(NEW.qty_shipped,0) > 0 AND NEW.status = 'active' THEN
    NEW.status := 'partial';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ec_calc ON export_contracts;
CREATE TRIGGER trg_ec_calc
  BEFORE INSERT OR UPDATE ON export_contracts
  FOR EACH ROW EXECUTE FUNCTION calc_export_contract();

CREATE OR REPLACE TRIGGER trg_ec_updated_at
  BEFORE UPDATE ON export_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE export_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ec_rls ON export_contracts;
CREATE POLICY ec_rls ON export_contracts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Documentação de Exportação ────────────────────────────────
CREATE TABLE IF NOT EXISTS export_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  contract_id       UUID REFERENCES export_contracts(id)          ON DELETE SET NULL,
  shipment_id       UUID,                                          -- FK after shipments

  doc_type          doc_type   NOT NULL,
  status            doc_status NOT NULL DEFAULT 'pending',
  doc_number        VARCHAR(100),
  doc_date          DATE,
  expiry_date       DATE,

  -- Dados específicos por tipo
  re_number         VARCHAR(50),    -- RE: número SISCOMEX
  due_number        VARCHAR(50),    -- DU-E: número
  bl_number         VARCHAR(50),    -- BL: número
  vessel_name       VARCHAR(200),   -- nome do navio
  voyage_number     VARCHAR(50),    -- número da viagem

  issuer            VARCHAR(200),   -- emissor do documento
  file_url          TEXT,           -- URL do arquivo no storage

  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ed_tenant_idx   ON export_documents (tenant_id);
CREATE INDEX IF NOT EXISTS ed_contract_idx ON export_documents (contract_id);
CREATE INDEX IF NOT EXISTS ed_type_idx     ON export_documents (tenant_id, doc_type);

CREATE OR REPLACE TRIGGER trg_ed_updated_at
  BEFORE UPDATE ON export_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE export_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ed_rls ON export_documents;
CREATE POLICY ed_rls ON export_documents FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Câmbio e Hedge Cambial ────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_forex (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  contract_id       UUID REFERENCES export_contracts(id)          ON DELETE SET NULL,
  bank_partner_id   UUID REFERENCES partners(id)                  ON DELETE SET NULL,

  op_type           forex_op_type NOT NULL DEFAULT 'acc',
  status            forex_status  NOT NULL DEFAULT 'open',

  -- Posição
  qty_usd           NUMERIC(16,2) NOT NULL,   -- volume em USD
  rate_contracted   NUMERIC(10,4) NOT NULL,   -- câmbio contratado
  rate_market       NUMERIC(10,4),            -- câmbio de mercado atual
  qty_brl           NUMERIC(16,2),            -- equivalente BRL contratado

  -- Datas
  contracted_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date       DATE NOT NULL,
  settled_at        DATE,

  -- ACC/ACE específico
  interest_rate     NUMERIC(8,4),             -- taxa de juros % a.a.
  advance_pct       NUMERIC(6,3),             -- % adiantado
  advance_usd       NUMERIC(16,2),            -- valor adiantado

  -- Resultado
  rate_settlement   NUMERIC(10,4),            -- câmbio na liquidação
  pnl_brl           NUMERIC(16,2),            -- resultado em BRL

  bank_ref          VARCHAR(100),             -- referência no banco
  notes             TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ef_tenant_idx   ON export_forex (tenant_id);
CREATE INDEX IF NOT EXISTS ef_contract_idx ON export_forex (contract_id);
CREATE INDEX IF NOT EXISTS ef_status_idx   ON export_forex (tenant_id, status);
CREATE INDEX IF NOT EXISTS ef_expiry_idx   ON export_forex (expiry_date);

CREATE OR REPLACE TRIGGER trg_ef_updated_at
  BEFORE UPDATE ON export_forex
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE export_forex ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ef_rls ON export_forex;
CREATE POLICY ef_rls ON export_forex FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Logística Internacional (Embarques) ───────────────────────
CREATE TABLE IF NOT EXISTS export_shipments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  contract_id       UUID REFERENCES export_contracts(id)          ON DELETE SET NULL,

  shipment_number   VARCHAR(50),
  status            shipment_status NOT NULL DEFAULT 'planned',

  -- Produto
  crop              VARCHAR(100) NOT NULL,
  qty_mt            NUMERIC(14,4) NOT NULL,   -- toneladas métricas
  qty_bu            NUMERIC(14,4),            -- bushels (se aplicável)

  -- Rota
  port_loading      VARCHAR(200) NOT NULL,    -- porto de embarque
  port_discharge    VARCHAR(200) NOT NULL,    -- porto de descarga
  country_dest      VARCHAR(100),
  incoterm          incoterm DEFAULT 'FOB',

  -- Navio
  vessel_name       VARCHAR(200),
  voyage_number     VARCHAR(50),
  flag              VARCHAR(50),              -- bandeira do navio
  agent             VARCHAR(200),             -- agente marítimo

  -- Container (se aplicável)
  container_count   INTEGER,
  container_type    VARCHAR(30),              -- 20DC, 40HC, bulk...

  -- Datas
  etd               DATE,                    -- Estimated Time of Departure
  eta               DATE,                    -- Estimated Time of Arrival
  ata               DATE,                    -- Actual Time of Arrival
  atd               DATE,                    -- Actual Time of Departure

  -- Custos
  freight_usd       NUMERIC(14,2),
  insurance_usd     NUMERIC(14,2),
  other_costs_usd   NUMERIC(14,2),
  total_cost_usd    NUMERIC(14,2),

  -- Documentos (BL number, etc.)
  bl_number         VARCHAR(100),
  bl_date           DATE,

  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Adiciona FK de export_documents → export_shipments
ALTER TABLE export_documents
  ADD CONSTRAINT fk_ed_shipment
  FOREIGN KEY (shipment_id) REFERENCES export_shipments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS es_tenant_idx   ON export_shipments (tenant_id);
CREATE INDEX IF NOT EXISTS es_contract_idx ON export_shipments (contract_id);
CREATE INDEX IF NOT EXISTS es_status_idx   ON export_shipments (tenant_id, status);
CREATE INDEX IF NOT EXISTS es_etd_idx      ON export_shipments (etd);

CREATE OR REPLACE TRIGGER trg_es_updated_at
  BEFORE UPDATE ON export_shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE export_shipments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS es_rls ON export_shipments;
CREATE POLICY es_rls ON export_shipments FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Views ─────────────────────────────────────────────────────
DROP VIEW IF EXISTS export_contracts_summary;
CREATE VIEW export_contracts_summary AS
SELECT
  ec.*,
  p.name          AS partner_name,
  f.name          AS farm_name,
  s.name          AS season_name,
  s.crop          AS season_crop,
  CASE WHEN ec.shipment_end < CURRENT_DATE
    AND ec.status NOT IN ('complete','cancelled')
    THEN CURRENT_DATE - ec.shipment_end ELSE NULL
  END             AS days_late,
  (SELECT COUNT(*) FROM export_documents ed WHERE ed.contract_id = ec.id)   AS doc_count,
  (SELECT COUNT(*) FROM export_shipments es WHERE es.contract_id = ec.id)   AS shipment_count,
  (SELECT COUNT(*) FROM export_forex ef    WHERE ef.contract_id  = ec.id)   AS forex_count
FROM export_contracts ec
LEFT JOIN partners p ON p.id = ec.partner_id
LEFT JOIN farms    f ON f.id = ec.farm_id
LEFT JOIN seasons  s ON s.id = ec.season_id;
