-- ============================================================
-- Vetra — Parceiros de negócio (multi-tipo, single table)
-- ============================================================

-- ── Enum de tipos de parceiro ─────────────────────────────────
CREATE TYPE partner_type AS ENUM (
  'client',         -- Cliente
  'supplier',       -- Fornecedor
  'carrier',        -- Transportadora
  'sharecropper',   -- Meeiro / parceiro rural
  'cooperative',    -- Cooperativa
  'trading',        -- Trading
  'broker',         -- Corretor
  'warehouse',      -- Armazém / Cerealista
  'service',        -- Prestador de serviço
  'financial'       -- Instituição financeira
);

-- ── Enum de tipo de pessoa ────────────────────────────────────
CREATE TYPE person_type AS ENUM (
  'legal',    -- Pessoa jurídica (CNPJ)
  'natural'   -- Pessoa física (CPF)
);

-- ── Enum de status ────────────────────────────────────────────
CREATE TYPE partner_status AS ENUM (
  'active',
  'inactive',
  'blocked'
);

-- ── Tabela principal de parceiros ─────────────────────────────
CREATE TABLE partners (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,

  -- Classificação
  types           partner_type[]  NOT NULL DEFAULT '{}',  -- multi-tipo
  person_type     person_type     NOT NULL DEFAULT 'legal',
  status          partner_status  NOT NULL DEFAULT 'active',

  -- Identificação
  name            VARCHAR(300) NOT NULL,   -- Razão social ou nome
  trade_name      VARCHAR(300),            -- Nome fantasia
  document        VARCHAR(20)  UNIQUE,     -- CNPJ ou CPF (único no sistema)
  state_reg       VARCHAR(20),             -- Inscrição estadual
  municipal_reg   VARCHAR(20),             -- Inscrição municipal

  -- Contato principal
  email           VARCHAR(200),
  phone           VARCHAR(20),
  phone2          VARCHAR(20),
  website         VARCHAR(200),
  contact_name    VARCHAR(200),            -- Nome do contato principal

  -- Endereço
  zip_code        VARCHAR(9),
  street          VARCHAR(300),
  number          VARCHAR(20),
  complement      VARCHAR(100),
  neighborhood    VARCHAR(100),
  city            VARCHAR(100),
  state           CHAR(2),
  country         VARCHAR(50) DEFAULT 'Brasil',

  -- Dados bancários (apenas para pagamentos recorrentes)
  bank_name       VARCHAR(100),
  bank_agency     VARCHAR(10),
  bank_account    VARCHAR(20),
  bank_pix_key    VARCHAR(200),

  -- Campos específicos por tipo
  -- Transportadora
  antt_code       VARCHAR(20),             -- Código ANTT/RNTRC
  vehicle_types   TEXT[],                  -- ['truck','van','train']

  -- Meeiro
  farm_ids        UUID[],                  -- fazendas vinculadas
  sharecrop_pct   NUMERIC(5,2),           -- % do meeiro na produção

  -- Instituição financeira
  bank_code       VARCHAR(5),             -- código BACEN
  swift_code      VARCHAR(11),            -- código SWIFT

  -- Observações
  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',     -- tags livres para filtragem

  -- Auditoria
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX partners_tenant_idx    ON partners (tenant_id);
CREATE INDEX partners_status_idx    ON partners (status);
CREATE INDEX partners_types_idx     ON partners USING GIN (types);
CREATE INDEX partners_tags_idx      ON partners USING GIN (tags);
CREATE INDEX partners_name_idx      ON partners USING GIN (to_tsvector('portuguese', name));
CREATE INDEX partners_document_idx  ON partners (document);

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Tabela de contatos adicionais ─────────────────────────────
CREATE TABLE partner_contacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id  UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  role        VARCHAR(100),              -- ex: 'Gerente comercial', 'Financeiro'
  email       VARCHAR(200),
  phone       VARCHAR(20),
  is_primary  BOOLEAN DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX partner_contacts_partner_idx ON partner_contacts (partner_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE partners          ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_contacts  ENABLE ROW LEVEL SECURITY;

-- Usuário acessa parceiros do próprio tenant
CREATE POLICY partners_tenant ON partners
  FOR ALL USING (
    tenant_id IN (
      SELECT l.tenant_id FROM licenses l
      JOIN profiles p ON p.id = auth.uid()
      WHERE l.status IN ('active','trial')
    )
  );

CREATE POLICY partner_contacts_tenant ON partner_contacts
  FOR ALL USING (
    partner_id IN (SELECT id FROM partners)
  );

-- ── View: parceiros com contagem de contatos ──────────────────
CREATE VIEW partners_summary AS
SELECT
  p.*,
  COUNT(pc.id) AS contacts_count
FROM partners p
LEFT JOIN partner_contacts pc ON pc.partner_id = p.id
GROUP BY p.id;
